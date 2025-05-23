import { Task, TaskOutput } from '@/lib/types/task'
import { ProcessManager } from './process-manager'
import { createWorktree, removeWorktree, commitChanges } from './git'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

class TaskStore {
  private tasks: Map<string, Task> = new Map()
  private outputs: Map<string, TaskOutput[]> = new Map()
  private processManagers: Map<string, ProcessManager> = new Map()
  private repoPath: string = ''
  private configPath: string = path.join(os.homedir(), '.claude-god-config.json')
  private dataDir: string = path.join(os.homedir(), '.claude-god-data')
  private tasksFile: string = path.join(os.homedir(), '.claude-god-data', 'tasks.json')
  private outputsFile: string = path.join(os.homedir(), '.claude-god-data', 'outputs.json')
  private readonly MAX_CONCURRENT_TASKS = 10
  private saveDebounceTimer: NodeJS.Timeout | null = null

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
      if (repoPath) {
        this.repoPath = repoPath
      }
    } catch (error) {
      // Config doesn't exist yet or is invalid
      console.log('No existing config found, starting fresh')
    }
  }

  private async loadTasks() {
    try {
      const tasksData = await fs.readFile(this.tasksFile, 'utf-8')
      const tasks = JSON.parse(tasksData)
      
      // Convert array back to Map and restore Date objects
      for (const task of tasks) {
        task.createdAt = new Date(task.createdAt)
        this.tasks.set(task.id, task)
        
        // Note: We can't restore process managers for running tasks
        // Mark previously running tasks as interrupted
        if (task.status === 'in_progress' || task.status === 'starting') {
          task.status = 'interrupted'
          task.phase = 'interrupted'
        }
      }
      
      console.log(`Loaded ${this.tasks.size} tasks from disk`)
    } catch (error) {
      console.log('No existing tasks found, starting fresh')
    }
    
    try {
      const outputsData = await fs.readFile(this.outputsFile, 'utf-8')
      const outputs = JSON.parse(outputsData)
      
      // Convert back to Map structure
      for (const [taskId, taskOutputs] of Object.entries(outputs)) {
        // Restore Date objects in outputs
        const restoredOutputs = (taskOutputs as any[]).map(output => ({
          ...output,
          timestamp: new Date(output.timestamp)
        }))
        this.outputs.set(taskId, restoredOutputs)
      }
      
      console.log(`Loaded outputs for ${this.outputs.size} tasks from disk`)
    } catch (error) {
      console.log('No existing outputs found')
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
    try {
      // Convert Map to array for JSON serialization
      const tasksArray = Array.from(this.tasks.values())
      await fs.writeFile(this.tasksFile, JSON.stringify(tasksArray, null, 2))
    } catch (error) {
      console.error('Error saving tasks:', error)
    }
  }

  private async saveOutputs() {
    try {
      // Convert Map to object for JSON serialization
      const outputsObject: Record<string, TaskOutput[]> = {}
      for (const [taskId, outputs] of this.outputs) {
        outputsObject[taskId] = outputs
      }
      await fs.writeFile(this.outputsFile, JSON.stringify(outputsObject, null, 2))
    } catch (error) {
      console.error('Error saving outputs:', error)
    }
  }

  private debouncedSave() {
    // Clear existing timer
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer)
    }
    
    // Set new timer to save after 1 second of no changes
    this.saveDebounceTimer = setTimeout(async () => {
      await this.saveTasks()
      await this.saveOutputs()
    }, 1000)
  }

  getRepoPath(): string {
    return this.repoPath
  }

  async setRepoPath(path: string) {
    this.repoPath = path
    await this.saveConfig()
  }

  async createTask(prompt: string, repoPath: string): Promise<Task> {
    // Check concurrent task limit
    const activeTasks = Array.from(this.tasks.values()).filter(
      t => t.status !== 'finished' && t.status !== 'failed'
    )
    if (activeTasks.length >= this.MAX_CONCURRENT_TASKS) {
      throw new Error(`Maximum concurrent tasks (${this.MAX_CONCURRENT_TASKS}) reached`)
    }
    
    const taskId = Math.random().toString(36).substring(7)
    const branchName = `task-${taskId}`
    
    if (repoPath) {
      await this.setRepoPath(repoPath)
    }
    
    // Check if this is self-modification
    const isSelfModification = repoPath.includes('claude-god') || 
                               path.resolve(repoPath) === path.resolve(process.cwd())
    
    if (isSelfModification) {
      console.log('WARNING: Self-modification task detected. Server may restart if changes are merged to main branch.')
    }
    
    const worktreePath = await createWorktree(this.repoPath, branchName)
    
    const task: Task = {
      id: taskId,
      prompt,
      status: 'starting',
      phase: 'editor',
      worktree: worktreePath,
      createdAt: new Date(),
      output: [],
      isSelfModification
    }
    
    this.tasks.set(taskId, task)
    this.outputs.set(taskId, [])
    this.debouncedSave() // Save after creating task
    
    const processManager = new ProcessManager()
    this.processManagers.set(taskId, processManager)
    
    processManager.on('output', (output) => {
      this.addOutput(taskId, output)
    })
    
    processManager.on('status', (status) => {
      const task = this.tasks.get(taskId)
      if (task) {
        task.status = status
        this.debouncedSave() // Save after status change
      }
    })
    
    processManager.on('phase', (phase) => {
      const task = this.tasks.get(taskId)
      if (task) {
        task.phase = phase
        this.debouncedSave() // Save after phase change
      }
    })
    
    processManager.on('reviewerPid', (pid) => {
      const task = this.tasks.get(taskId)
      if (task) {
        task.reviewerPid = pid
        this.debouncedSave() // Save after pid update
      }
    })
    
    processManager.on('completed', () => {
      const task = this.tasks.get(taskId)
      if (task) {
        task.status = 'finished'
        task.phase = 'done'
        this.debouncedSave() // Save after completion
      }
    })
    
    try {
      const { editorPid, reviewerPid } = await processManager.startProcesses(
        worktreePath,
        prompt,
        taskId
      )
      
      task.editorPid = editorPid
      task.reviewerPid = reviewerPid
      this.debouncedSave() // Save after PIDs are set
    } catch (error) {
      task.status = 'failed'
      console.error('Error starting processes:', error)
      this.debouncedSave() // Save failed status
    }
    
    return task
  }

  getTasks(): Task[] {
    return Array.from(this.tasks.values())
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  getOutputs(taskId: string): TaskOutput[] {
    return this.outputs.get(taskId) || []
  }

  private addOutput(taskId: string, output: any) {
    const outputs = this.outputs.get(taskId) || []
    const newOutput = {
      id: Math.random().toString(36).substring(7),
      taskId,
      ...output
    }
    
    outputs.push(newOutput)
    
    // Limit output history to prevent unbounded growth
    const MAX_OUTPUTS = 1000
    if (outputs.length > MAX_OUTPUTS) {
      outputs.splice(0, outputs.length - MAX_OUTPUTS)
    }
    
    this.outputs.set(taskId, outputs)
    this.debouncedSave() // Save after adding output
  }

  async commitTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error('Task not found')
    
    await commitChanges(task.worktree, `Complete task: ${task.prompt}`)
    await this.removeTask(taskId)
  }

  async sendPromptToTask(taskId: string, prompt: string): Promise<void> {
    const processManager = this.processManagers.get(taskId)
    if (processManager) {
      await processManager.sendPrompt(prompt)
    }
  }

  async removeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) return
    
    console.log(`Removing task ${taskId} with status: ${task.status}`)
    
    const processManager = this.processManagers.get(taskId)
    if (processManager) {
      processManager.stopProcesses()
      this.processManagers.delete(taskId)
    }
    
    try {
      await removeWorktree(this.repoPath, task.worktree)
    } catch (error) {
      console.error('Error removing worktree:', error)
    }
    
    this.tasks.delete(taskId)
    this.outputs.delete(taskId)
    this.debouncedSave() // Save after removing task
  }
}

export const taskStore = new TaskStore()