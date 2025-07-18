import { Task } from '@/lib/types/task'
import { ProcessManager } from './process-manager'
import { createWorktree, removeWorktree, commitChanges, cherryPickCommit, undoCherryPick, mergeWorktreeToMain } from './git'
import { gitLock } from './git-lock'
import { FileLock } from './file-lock'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { getPersistentState } from './persistent-state'
import { getPersistentLogger } from './persistent-logger'

class TaskStore {
  private tasks: Map<string, Task> = new Map()
  private processManagers: Map<string, ProcessManager> = new Map()
  private repoPath: string = ''
  private configPath: string = path.join(os.homedir(), '.claude-god-config.json')
  private dataDir: string = path.join(os.homedir(), '.claude-god-data')
  private tasksFile: string = path.join(os.homedir(), '.claude-god-data', 'tasks.json')
  private readonly MAX_CONCURRENT_TASKS = 10
  private saveDebounceTimer: NodeJS.Timeout | null = null
  private saveQueue: Promise<void> = Promise.resolve()
  private isInCriticalOperation: boolean = false
  private taskCreationQueue: Promise<void> = Promise.resolve()
  private pendingTaskAdditions: Map<string, Task> = new Map()
  private persistentState = getPersistentState()
  private persistentLogger = getPersistentLogger()

  constructor() {
    this.initializeDataDir()
    this.loadConfig()
    this.loadTasks()
  }

  private async initializeDataDir() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true })
    } catch (error) {
      console.error('Error creating data directory:', error)
    }
  }

  private async loadConfig() {
    try {
      const config = await fs.readFile(this.configPath, 'utf-8')
      const { repoPath } = JSON.parse(config)
      this.repoPath = repoPath
    } catch (error) {
      console.log('No config file found')
    }
  }

  private async loadTasks() {
    try {
      const tasksData = await fs.readFile(this.tasksFile, 'utf-8')
      const tasks = JSON.parse(tasksData)
      console.log(`Loaded ${tasks.length} tasks from disk`)
      
      for (const task of tasks) {
        // Restore Date objects
        task.createdAt = new Date(task.createdAt)
        
        this.tasks.set(task.id, task)
      }
    } catch (error) {
      console.log('No tasks file found or error loading tasks')
    }
  }

  private loadTasksSync() {
    try {
      const tasksData = require('fs').readFileSync(this.tasksFile, 'utf-8')
      const tasks = JSON.parse(tasksData)
      
      this.tasks.clear()
      for (const task of tasks) {
        // Restore Date objects
        task.createdAt = new Date(task.createdAt)
        
        this.tasks.set(task.id, task)
      }
    } catch (error) {
      // Silent fail - no tasks file yet
    }
  }

  private async saveConfig() {
    try {
      await fs.writeFile(this.configPath, JSON.stringify({ repoPath: this.repoPath }, null, 2))
    } catch (error) {
      console.error('Error saving config:', error)
    }
  }

  private async saveTasks() {
    await FileLock.withLock(this.tasksFile, async () => {
      try {
        // Create backup before overwriting
        try {
          const backupPath = this.tasksFile + '.backup'
          await fs.copyFile(this.tasksFile, backupPath)
        } catch (error) {
          // Ignore if file doesn't exist yet
        }
        
        // Apply any pending task additions before saving
        const pendingToApply = new Map(this.pendingTaskAdditions)
        if (pendingToApply.size > 0) {
          console.log(`[TaskStore] Applying ${pendingToApply.size} pending task additions before save`)
          for (const [taskId, task] of pendingToApply) {
            this.tasks.set(taskId, task)
          }
        }
        
        // Convert Map to array for JSON serialization
        const tasksArray = Array.from(this.tasks.values())
        console.log(`[TaskStore] Saving ${tasksArray.length} tasks to disk (Map size: ${this.tasks.size})`)
        await fs.writeFile(this.tasksFile, JSON.stringify(tasksArray, null, 2))
        
        // Only clear pending additions after successful write
        if (pendingToApply.size > 0) {
          this.pendingTaskAdditions.clear()
        }
        
        // Also save to persistent state
        for (const task of tasksArray) {
          await this.persistentState.saveTask(task)
        }
        
        // Log save event
        await this.persistentLogger.logSystemEvent('tasks-batch-saved', {
          count: tasksArray.length,
          taskIds: tasksArray.map(t => t.id)
        })
      } catch (error) {
        console.error('Error saving tasks:', error)
        await this.persistentLogger.logError(error as Error, { operation: 'saveTasks' })
        throw error
      }
    })
  }

  private debouncedSave() {
    if (this.isInCriticalOperation) {
      console.log('[TaskStore] Skipping save during critical operation')
      return
    }
    
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer)
    }
    
    this.saveDebounceTimer = setTimeout(() => {
      this.saveQueue = this.saveQueue.then(async () => {
        await this.saveTasks()
      }).catch(error => {
        console.error('Error in save queue:', error)
      })
    }, 1000)
  }

  setRepoPath(repoPath: string) {
    this.repoPath = repoPath
    this.saveConfig()
  }

  getRepoPath(): string {
    return this.repoPath
  }

  getTasks(): Task[] {
    this.loadTasksSync()
    
    const allTasks = new Map(this.tasks)
    for (const [id, task] of this.pendingTaskAdditions) {
      allTasks.set(id, task)
    }
    
    return Array.from(allTasks.values())
  }

  getTask(id: string): Task | undefined {
    this.loadTasksSync()
    return this.tasks.get(id) || this.pendingTaskAdditions.get(id)
  }

  async createTask(prompt: string, repoPath: string, mode?: string): Promise<Task> {
    return new Promise((resolve, reject) => {
      this.taskCreationQueue = this.taskCreationQueue.then(async () => {
        try {
          // Generate a unique task ID
          const taskId = Math.random().toString(36).substring(7)
          
          // Create worktree
          const worktree = await gitLock.withLock(repoPath, async () => {
            return await createWorktree(repoPath, taskId)
          })
          
          const task: Task = {
            id: taskId,
            prompt,
            createdAt: new Date(),
            worktree,
            repoPath,
            mode: mode as 'planning' | 'edit' | undefined,
            terminalTag: '' // Will be set by ProcessManager
          }
          
          // Add to pending additions immediately
          this.pendingTaskAdditions.set(task.id, task)
          this.tasks.set(task.id, task)
          
          await this.persistentLogger.logTaskEvent(task.id, 'task-created', {
            mode: mode || 'edit',
            worktree
          })
          
          // Save immediately
          await this.saveTasks()
          
          // Broadcast the new task
          
          resolve(task)
        } catch (error) {
          console.error('Error creating task:', error)
          reject(error)
        }
      })
    })
  }



  async startTask(taskId: string): Promise<void> {
    const task = this.getTask(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    // Create ProcessManager
    const processManager = new ProcessManager(task.id, task.worktree, task.repoPath)
    this.processManagers.set(task.id, processManager)
    
    // Set up event handlers
    processManager.on('terminalSpawned', (data: any) => {
      task.terminalTag = data.tag
      this.debouncedSave()
    })
    
    // Build the prompt with mode-specific instructions
    let finalPrompt = task.prompt
    if (task.mode === 'planning') {
      finalPrompt = this.buildPlanningPrompt(task.prompt)
    }
    
    // Start the process with the appropriate mode
    await processManager.start(finalPrompt, task.mode || 'edit')
    
    await this.persistentLogger.logTaskEvent(task.id, 'task-started', { mode: task.mode })
    
    this.debouncedSave()
  }

  async bringTaskToFront(taskId: string): Promise<void> {
    const processManager = this.processManagers.get(taskId)
    if (!processManager) {
      // Try to bring the terminal to front using the saved terminal tag
      const task = this.getTask(taskId)
      if (task && task.terminalTag) {
        // Create a temporary process manager just for bringing to front
        const pm = new ProcessManager(task.id, task.worktree, task.repoPath)
        pm.terminalTag = task.terminalTag
        pm.mode = task.mode || 'edit'
        pm.isActive = true // Assume it's active if we have a terminal tag
        
        // Store it for future use
        this.processManagers.set(taskId, pm)
        
        await pm.bringToFront()
      } else {
        throw new Error(`No terminal tag found for task ${taskId}`)
      }
    } else {
      await processManager.bringToFront()
    }
  }

  async commitTask(taskId: string, commitMessage: string): Promise<string> {
    const task = this.getTask(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    const commitHash = await gitLock.withLock(task.repoPath, async () => {
      return await commitChanges(task.worktree, commitMessage)
    })
    
    task.commitHash = commitHash
    
    await this.persistentLogger.logTaskEvent(taskId, 'task-committed', { commitHash })
    
    this.debouncedSave()
    
    return commitHash
  }


  private buildPlanningPrompt(userPrompt: string): string {
    let planningPrompt = userPrompt + "\n\n"
    planningPrompt += "Create a comprehensive plan that solves this and write it to an md file. "
    planningPrompt += "Then tell me a summary of what the plan is, and ask me any questions you might have about implementation. "
    planningPrompt += "Don't write any code yet. Then I will answer your questions and give you approval."
    
    return planningPrompt
  }


  async mergeTask(taskId: string): Promise<void> {
    const task = this.getTask(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    if (!task.commitHash) {
      throw new Error(`Task ${taskId} has no commit to merge`)
    }

    await gitLock.withLock(task.repoPath, async () => {
      await mergeWorktreeToMain(task.worktree, task.repoPath)
    })
    
    await this.persistentLogger.logTaskEvent(taskId, 'task-merged', {})
    
    this.debouncedSave()
    
    // Clean up worktree after merge
    await this.cleanupTask(taskId)
  }

  async cleanupTask(taskId: string): Promise<void> {
    const task = this.getTask(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    try {
      await gitLock.withLock(task.repoPath, async () => {
        await removeWorktree(task.repoPath, task.worktree)
      })
      
      const processManager = this.processManagers.get(taskId)
      if (processManager) {
        processManager.stopProcesses()
        this.processManagers.delete(taskId)
      }
      
      // Remove the task from the store
      this.tasks.delete(taskId)
      this.pendingTaskAdditions.delete(taskId)
      
      // Save the updated task list
      this.debouncedSave()
      
      await this.persistentLogger.logTaskEvent(taskId, 'task-cleaned-up', {})
    } catch (error) {
      console.error(`Error cleaning up task ${taskId}:`, error)
    }
  }

  async cleanupAllTasks(): Promise<void> {
    console.log('[TaskStore] Starting cleanup of all tasks...')
    
    for (const [taskId, processManager] of this.processManagers) {
      try {
        processManager.stopProcesses()
      } catch (error) {
        console.error(`Error stopping process for task ${taskId}:`, error)
      }
    }
    
    this.processManagers.clear()
    
    await this.persistentState.createSnapshot()
    await this.persistentLogger.logSystemEvent('all-tasks-cleaned-up', {
      taskCount: this.tasks.size
    })
    
    console.log('[TaskStore] Cleanup completed')
  }

  async clearAllProcessManagers(): Promise<number> {
    const count = this.processManagers.size
    this.processManagers.clear()
    
    await this.persistentLogger.logSystemEvent('process-managers-cleared', {
      count
    })
    
    return count
  }

  getActiveTerminalSessions(): Array<{ taskId: string; terminalTag: string; mode: string }> {
    const sessions: Array<{ taskId: string; terminalTag: string; mode: string }> = []
    
    for (const [taskId, pm] of this.processManagers) {
      if (pm.terminalTag && pm.isActive) {
        sessions.push({
          taskId,
          terminalTag: pm.terminalTag,
          mode: pm.mode
        })
      }
    }
    
    return sessions
  }
}

export const taskStore = new TaskStore()