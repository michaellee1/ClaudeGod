import fs from 'fs'
import { promises as fsPromises } from 'fs'
import path from 'path'

export interface ProcessInfo {
  pid: number
  taskId: string
  phase: 'editor' | 'reviewer' | 'planner'
  startTime: number
  worktreePath: string
  prompt?: string
  outputPaths?: {
    stdout: string
    stderr: string
    stdin: string
  }
  shellCommand?: string // Store the command for debugging
}

export interface ProcessStateData {
  processes: { [key: string]: ProcessInfo }
}

class ProcessStateManager {
  private static readonly STATE_FILE = path.join(require('os').homedir(), '.claude-god-data', 'claude-processes.json')
  private state: ProcessStateData = { processes: {} }

  constructor() {
    this.loadState()
  }

  private async loadState() {
    try {
      const data = await fsPromises.readFile(ProcessStateManager.STATE_FILE, 'utf-8')
      this.state = JSON.parse(data)
    } catch (error) {
      // File doesn't exist or is corrupted, start fresh
      this.state = { processes: {} }
    }
  }

  private async saveState() {
    const tempFile = ProcessStateManager.STATE_FILE + '.tmp'
    try {
      // Write to temp file first for atomic operation
      await fsPromises.writeFile(
        tempFile,
        JSON.stringify(this.state, null, 2)
      )
      // Atomic rename
      await fsPromises.rename(tempFile, ProcessStateManager.STATE_FILE)
    } catch (error) {
      console.error('[ProcessState] Failed to save state:', error)
      // Clean up temp file if it exists
      try {
        await fsPromises.unlink(tempFile)
      } catch (unlinkError) {
        // Ignore if temp file doesn't exist
      }
    }
  }

  async registerProcess(info: ProcessInfo): Promise<void> {
    const key = `${info.taskId}-${info.phase}`
    this.state.processes[key] = info
    await this.saveState()
    console.log(`[ProcessState] Registered process ${info.pid} for task ${info.taskId} (${info.phase})`)
  }

  async unregisterProcess(taskId: string, phase: 'editor' | 'reviewer' | 'planner'): Promise<void> {
    const key = `${taskId}-${phase}`
    delete this.state.processes[key]
    await this.saveState()
    console.log(`[ProcessState] Unregistered process for task ${taskId} (${phase})`)
  }

  getProcessForTask(taskId: string): ProcessInfo | undefined {
    // Check for any phase of this task
    const editorKey = `${taskId}-editor`
    const reviewerKey = `${taskId}-reviewer`
    const plannerKey = `${taskId}-planner`
    
    return this.state.processes[editorKey] || this.state.processes[reviewerKey] || this.state.processes[plannerKey]
  }

  getAllProcesses(): ProcessInfo[] {
    return Object.values(this.state.processes)
  }

  async killAllProcesses(): Promise<number> {
    let killed = 0
    
    for (const [key, info] of Object.entries(this.state.processes)) {
      try {
        if (await this.isProcessAlive(info.pid)) {
          console.log(`[ProcessState] Killing process ${info.pid} for task ${info.taskId} (${info.phase})`)
          // Note: This kills the nohup process, child processes may continue
          // On macOS/Linux, we can try to kill the process group
          try {
            process.kill(-info.pid, 'SIGTERM') // Negative PID kills process group
          } catch (e) {
            // Fallback to killing just the process
            process.kill(info.pid, 'SIGTERM')
          }
          killed++
        }
        delete this.state.processes[key]
      } catch (error) {
        console.error(`[ProcessState] Failed to kill process ${info.pid}:`, error)
        delete this.state.processes[key]
      }
    }
    
    await this.saveState()
    return killed
  }

  async isProcessAlive(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get live processes that can be adopted
   */
  async getAdoptableProcesses(): Promise<ProcessInfo[]> {
    const adoptable: ProcessInfo[] = []
    
    for (const [key, info] of Object.entries(this.state.processes)) {
      if (await this.isProcessAlive(info.pid)) {
        adoptable.push(info)
      } else {
        // Clean up dead process
        delete this.state.processes[key]
      }
    }
    
    // Save cleaned state
    await this.saveState()
    
    return adoptable
  }

  /**
   * Clean up processes without corresponding tasks
   */
  async cleanupOrphanedProcesses(validTaskIds: string[]): Promise<number> {
    let cleaned = 0
    
    for (const [key, info] of Object.entries(this.state.processes)) {
      if (!validTaskIds.includes(info.taskId)) {
        console.log(`[ProcessState] Found orphaned process ${info.pid} for non-existent task ${info.taskId}`)
        
        // Try to kill the process
        try {
          if (await this.isProcessAlive(info.pid)) {
            // Note: This kills the nohup process, child processes may continue
            // On macOS/Linux, we can try to kill the process group
            try {
              process.kill(-info.pid, 'SIGTERM') // Negative PID kills process group
            } catch (e) {
              // Fallback to killing just the process
              process.kill(info.pid, 'SIGTERM')
            }
            cleaned++
          }
        } catch (error) {
          console.error(`[ProcessState] Failed to kill orphaned process ${info.pid}:`, error)
        }
        
        delete this.state.processes[key]
      }
    }
    
    if (cleaned > 0) {
      await this.saveState()
    }
    
    return cleaned
  }

  /**
   * Get process info for a specific task
   */
  getProcessInfo(taskId: string, phase: 'editor' | 'reviewer' | 'planner'): ProcessInfo | undefined {
    const key = `${taskId}-${phase}`
    return this.state.processes[key]
  }
}

// Export singleton instance
export const processStateManager = new ProcessStateManager()