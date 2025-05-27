import { Task, TaskOutput, PromptCycle } from '@/lib/types/task'
import { ProcessManager } from './process-manager'
import { createWorktree, removeWorktree, commitChanges, cherryPickCommit, undoCherryPick, mergeWorktreeToMain } from './git'
import { gitLock } from './git-lock'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'

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
        if (task.mergedAt) {
          task.mergedAt = new Date(task.mergedAt)
        }
        this.tasks.set(task.id, task)
        
        // Note: We can't restore process managers for running tasks
        // Tasks will remain in their current status even after reload
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

  private broadcastTaskUpdate(taskId: string, task: Task) {
    // Broadcast via WebSocket if available
    if (typeof global !== 'undefined' && (global as any).broadcastTaskUpdate) {
      (global as any).broadcastTaskUpdate(taskId, task)
    }
  }

  private broadcastTaskOutput(taskId: string, output: TaskOutput) {
    // Broadcast via WebSocket if available
    if (typeof global !== 'undefined' && (global as any).broadcastTaskOutput) {
      (global as any).broadcastTaskOutput(taskId, output)
    }
  }

  private cleanupTaskConnections(taskId: string) {
    // Clean up WebSocket connections if available
    if (typeof global !== 'undefined' && (global as any).cleanupTaskConnections) {
      (global as any).cleanupTaskConnections(taskId)
    }
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
      repoPath: this.repoPath,
      createdAt: new Date(),
      output: [],
      isSelfModification
    }
    
    this.tasks.set(taskId, task)
    this.outputs.set(taskId, [])
    this.debouncedSave() // Save after creating task
    this.broadcastTaskUpdate(taskId, task)
    
    const processManager = new ProcessManager(taskId, worktreePath, this.repoPath)
    this.processManagers.set(taskId, processManager)
    
    this.setupProcessManagerEvents(processManager, task)
    
    try {
      const { editorPid, reviewerPid } = await processManager.startProcesses(
        worktreePath,
        prompt,
        taskId
      )
      
      task.editorPid = editorPid
      task.reviewerPid = reviewerPid
      this.debouncedSave() // Save after PIDs are set
      this.broadcastTaskUpdate(taskId, task)
    } catch (error) {
      task.status = 'failed'
      console.error('Error starting processes:', error)
      this.debouncedSave() // Save failed status
      this.broadcastTaskUpdate(taskId, task)
    }
    
    return task
  }

  getTasks(): Task[] {
    return Array.from(this.tasks.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  getOutputs(taskId: string): TaskOutput[] {
    return this.outputs.get(taskId) || []
  }

  private addOutput(taskId: string, output: any) {
    console.log(`[TaskStore] Adding output for task ${taskId}:`, {
      type: output.type,
      contentLength: output.content?.length || 0,
      preview: output.content?.substring(0, 50)
    })
    
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
    console.log(`[TaskStore] Output count for task ${taskId}: ${outputs.length}`)
    this.debouncedSave() // Save after adding output
    this.broadcastTaskOutput(taskId, newOutput)
  }

  async commitTask(taskId: string, message?: string): Promise<string> {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error('Task not found')
    
    const commitMessage = message || `Complete task: ${task.prompt}`
    
    // Commit changes with lock (using repo path as lock key for consistency)
    const commitHash = await gitLock.withLock(task.repoPath, async () => {
      return await commitChanges(task.worktree, commitMessage)
    })
    
    task.commitHash = commitHash
    await this.saveTasks()
    this.broadcastTaskUpdate(taskId, task)
    
    return commitHash
  }

  async mergeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error('Task not found')
    
    // Stop preview if active
    if (task.isPreviewing) {
      await this.stopPreview(taskId)
    }
    
    // Merge the worktree branch to main with lock
    await gitLock.withLock(task.repoPath, async () => {
      await mergeWorktreeToMain(task.repoPath, task.worktree)
    })
    
    // Mark task as merged instead of removing it
    task.status = 'merged' as any
    task.mergedAt = new Date()
    await this.saveTasks()
    this.broadcastTaskUpdate(taskId, task)
  }

  async sendPromptToTask(taskId: string, prompt: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error('Task not found')
    
    // If task is finished or merged, we need to restart the editor/reviewer cycle
    if (task.status === 'finished' || task.status === 'merged') {
      // Store the current state in prompt history
      if (!task.promptHistory) {
        task.promptHistory = []
      }
      
      // On first additional prompt request, we need to capture the original task completion
      if (task.promptHistory.length === 0 && task.commitHash) {
        // Store the original task completion
        task.promptHistory.push({
          prompt: task.prompt,
          timestamp: task.createdAt,
          commitHash: task.commitHash
        })
      }
      
      // Get git diff to see what we built
      let gitDiff = ''
      try {
        const { stdout } = await promisify(execFile)(
          'git', ['-C', task.worktree, 'diff', 'main...HEAD']
        )
        gitDiff = stdout || '(No changes detected)'
      } catch (error) {
        console.error('Failed to get git diff:', error)
        gitDiff = '(Unable to retrieve git diff)'
      }
      
      // Build context message based on number of prompts
      let contextPrompt = ''
      if (task.promptHistory.length === 1) {
        // First additional prompt
        contextPrompt = `The first prompt was "${task.prompt}" (don't work on this), and you can see what we built in response to that prompt by using git diff. Now, you are being asked to make changes to this initial work, with the new request for changes being "${prompt}" (work on this). Make those changes.

## Git diff showing what was built:
\`\`\`diff
${gitDiff}
\`\`\``
      } else {
        // Multiple prompts - stack the context
        // Collect all previous prompts in order
        const previousPrompts: string[] = []
        
        // First prompt is always the original task prompt
        previousPrompts.push(task.prompt)
        
        // Add any additional prompts from history (excluding the one we just stored)
        for (let i = 0; i < task.promptHistory.length - 1; i++) {
          const historyPrompt = task.promptHistory[i].prompt
          // Skip if it's the original prompt (already added) or empty
          if (historyPrompt && historyPrompt !== task.prompt) {
            previousPrompts.push(historyPrompt)
          }
        }
        
        contextPrompt = `The first ${previousPrompts.length} prompts were:
${previousPrompts.map((p, i) => `${i + 1}. "${p}"`).join('\n')}

You can see what we built in response to these prompts by using git diff. Now, you are being asked to make changes to this work, with the new request for changes being "${prompt}" (work on this). Make those changes.

## Git diff showing what was built:
\`\`\`diff
${gitDiff}
\`\`\``
      }
      
      // Add the new prompt to history for future reference
      task.promptHistory.push({
        prompt: prompt,
        timestamp: new Date(),
        commitHash: undefined // Will be set when this cycle completes
      })
      
      // Reset task status to restart the cycle
      task.status = 'starting'
      task.phase = 'editor'
      delete task.editorPid
      delete task.reviewerPid
      this.broadcastTaskUpdate(taskId, task)
      
      // Clean up old ProcessManager if it exists
      const oldProcessManager = this.processManagers.get(taskId)
      if (oldProcessManager) {
        oldProcessManager.stopProcesses()
      }
      
      // Create a new ProcessManager for this cycle
      const newProcessManager = new ProcessManager(task.id, task.worktree, task.repoPath)
      this.processManagers.set(taskId, newProcessManager)
      
      // Set up event handlers
      this.setupProcessManagerEvents(newProcessManager, task)
      
      // Start the new cycle with the context prompt
      await newProcessManager.start(contextPrompt)
      
      // Save the updated task
      await this.saveTasks()
      this.broadcastTaskUpdate(taskId, task)
    } else {
      // Original behavior for in-progress tasks
      const processManager = this.processManagers.get(taskId)
      if (processManager) {
        await processManager.sendPrompt(prompt)
      }
    }
  }

  async startPreview(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error('Task not found')
    if (!task.commitHash) throw new Error('Task has no commit to preview')
    if (task.isPreviewing) throw new Error('Task is already being previewed')
    
    // Cherry-pick the commit to main repo with lock
    await gitLock.withLock(task.repoPath, async () => {
      await cherryPickCommit(task.repoPath, task.commitHash!)
    })
    task.isPreviewing = true
    await this.saveTasks()
    this.broadcastTaskUpdate(taskId, task)
  }
  
  async stopPreview(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error('Task not found')
    if (!task.isPreviewing) throw new Error('Task is not being previewed')
    
    // Undo the cherry-pick with lock
    await gitLock.withLock(task.repoPath, async () => {
      await undoCherryPick(task.repoPath)
    })
    task.isPreviewing = false
    await this.saveTasks()
    this.broadcastTaskUpdate(taskId, task)
  }

  async removeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) return
    
    console.log(`Removing task ${taskId} with status: ${task.status}`)
    
    // Stop preview if active
    if (task.isPreviewing) {
      try {
        await this.stopPreview(taskId)
      } catch (error) {
        console.error('Error stopping preview:', error)
      }
    }
    
    const processManager = this.processManagers.get(taskId)
    if (processManager) {
      processManager.stopProcesses()
      this.processManagers.delete(taskId)
    }
    
    try {
      await removeWorktree(task.repoPath, task.worktree)
    } catch (error) {
      console.error('Error removing worktree:', error)
    }
    
    this.tasks.delete(taskId)
    this.outputs.delete(taskId)
    this.debouncedSave() // Save after removing task
    this.cleanupTaskConnections(taskId)
  }

  async removeAllTasks(): Promise<void> {
    console.log('Removing all tasks...')
    
    // Get all task IDs
    const taskIds = Array.from(this.tasks.keys())
    
    // Remove each task one by one to ensure proper cleanup
    for (const taskId of taskIds) {
      try {
        await this.removeTask(taskId)
        console.log(`Removed task ${taskId}`)
      } catch (error) {
        console.error(`Failed to remove task ${taskId}:`, error)
        // Continue with other tasks even if one fails
      }
    }
    
    // Ensure everything is cleared
    this.tasks.clear()
    this.outputs.clear()
    this.processManagers.clear()
    
    // Save the empty state
    await this.saveTasks()
    await this.saveOutputs()
    
    console.log('All tasks removed successfully')
  }

  private setupProcessManagerEvents(processManager: ProcessManager, task: Task) {
    processManager.on('output', (output) => {
      this.addOutput(task.id, output)
    })
    
    processManager.on('status', (status) => {
      task.status = status
      this.debouncedSave()
      this.broadcastTaskUpdate(task.id, task)
    })
    
    processManager.on('phase', (phase) => {
      task.phase = phase
      this.debouncedSave()
      this.broadcastTaskUpdate(task.id, task)
    })
    
    processManager.on('editorPid', (pid) => {
      task.editorPid = pid
      this.debouncedSave()
      this.broadcastTaskUpdate(task.id, task)
    })
    
    processManager.on('reviewerPid', (pid) => {
      task.reviewerPid = pid
      this.debouncedSave()
      this.broadcastTaskUpdate(task.id, task)
    })
    
    processManager.on('error', (error: Error) => {
      console.error(`Process error for task ${task.id}:`, error)
      this.addOutput(task.id, {
        type: 'system',
        content: `⚠️ ${error.message}`,
        timestamp: new Date()
      })
      
      // Don't automatically mark as failed for SIGTERM errors
      if (!error.message.includes('SIGTERM')) {
        task.status = 'failed'
        this.debouncedSave()
        this.broadcastTaskUpdate(task.id, task)
      }
    })
    
    processManager.on('timeout', ({ processName, pid }) => {
      console.warn(`Process timeout for task ${task.id}: ${processName} (PID: ${pid})`)
      this.addOutput(task.id, {
        type: 'system',
        content: `⏱️ ${processName} process timed out after 30 minutes and was terminated`,
        timestamp: new Date()
      })
    })
    
    processManager.on('completed', async (shouldAutoCommit: boolean) => {
      task.status = 'finished'
      task.phase = 'done'
      
      // Auto-commit if reviewer completed successfully
      if (shouldAutoCommit) {
        try {
          console.log(`Auto-committing task ${task.id} after successful completion`)
          const commitHash = await gitLock.withLock(task.repoPath, async () => {
            return await commitChanges(task.worktree, `Complete task: ${task.prompt}`)
          })
          task.commitHash = commitHash
          console.log(`Task ${task.id} auto-committed with hash: ${commitHash}`)
          
          // Update the last prompt history entry with the commit hash
          if (task.promptHistory && task.promptHistory.length > 0) {
            const lastEntry = task.promptHistory[task.promptHistory.length - 1]
            if (!lastEntry.commitHash) {
              lastEntry.commitHash = commitHash
            }
          }
        } catch (error) {
          console.error(`Failed to auto-commit task ${task.id}:`, error)
        }
      }
      
      // Save immediately on completion
      this.saveTasks().then(() => {
        console.log(`Task ${task.id} marked as finished and saved`)
        this.broadcastTaskUpdate(task.id, task)
      })
    })
  }
}

export const taskStore = new TaskStore()