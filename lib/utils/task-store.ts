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
  private readonly MAX_CONCURRENT_TASKS = 10

  constructor() {
    this.loadConfig()
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

  private async saveConfig() {
    try {
      await fs.writeFile(this.configPath, JSON.stringify({ repoPath: this.repoPath }))
    } catch (error) {
      console.error('Error saving config:', error)
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
    
    const worktreePath = await createWorktree(this.repoPath, branchName)
    
    const task: Task = {
      id: taskId,
      prompt,
      status: 'starting',
      phase: 'editor',
      worktree: worktreePath,
      createdAt: new Date(),
      output: []
    }
    
    this.tasks.set(taskId, task)
    this.outputs.set(taskId, [])
    
    const processManager = new ProcessManager()
    this.processManagers.set(taskId, processManager)
    
    processManager.on('output', (output) => {
      this.addOutput(taskId, output)
    })
    
    processManager.on('status', (status) => {
      const task = this.tasks.get(taskId)
      if (task) {
        task.status = status
      }
    })
    
    processManager.on('phase', (phase) => {
      const task = this.tasks.get(taskId)
      if (task) {
        task.phase = phase
      }
    })
    
    processManager.on('reviewerPid', (pid) => {
      const task = this.tasks.get(taskId)
      if (task) {
        task.reviewerPid = pid
      }
    })
    
    processManager.on('completed', () => {
      const task = this.tasks.get(taskId)
      if (task) {
        task.status = 'finished'
        task.phase = 'done'
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
    } catch (error) {
      task.status = 'failed'
      console.error('Error starting processes:', error)
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
  }
}

export const taskStore = new TaskStore()