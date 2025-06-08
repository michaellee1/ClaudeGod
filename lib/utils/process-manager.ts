import { EventEmitter } from 'events'
import { spawnTaggedSession, focusTaggedSession } from './iterm-integration'

export interface ITermProcessManager extends EventEmitter {
  taskId: string
  mode: 'planning' | 'edit'
  terminalTag: string
  worktreePath: string
  isActive: boolean
}

export class ProcessManager extends EventEmitter implements ITermProcessManager {
  taskId: string
  mode!: 'planning' | 'edit'
  terminalTag: string
  worktreePath: string
  isActive: boolean = false

  constructor(taskId: string, worktreePath: string, repoPath?: string) {
    super()
    this.taskId = taskId
    this.worktreePath = worktreePath
    this.terminalTag = ''
  }

  async start(prompt: string, mode: 'planning' | 'edit' = 'edit'): Promise<void> {
    this.mode = mode
    this.terminalTag = `claude-${this.taskId}-${mode}`
    
    // Build the Claude Code command without -p flag
    const command = this.buildClaudeCommand(prompt)
    
    try {
      // Spawn a new iTerm session with our command
      await spawnTaggedSession(this.terminalTag, command)
      
      this.isActive = true
      this.emit('status', 'in_progress')
      this.emit('terminalSpawned', {
        taskId: this.taskId,
        tag: this.terminalTag,
        mode: this.mode
      })
      
      console.log(`[ProcessManager] Spawned iTerm session for task ${this.taskId} in ${mode} mode with tag: ${this.terminalTag}`)
    } catch (error) {
      console.error(`[ProcessManager] Failed to spawn iTerm session:`, error)
      this.emit('status', 'failed')
      this.emit('error', error)
      throw error
    }
  }

  private buildClaudeCommand(prompt: string): string {
    // Change to the worktree directory and run Claude Code
    // Escape the prompt for shell
    const escapedPrompt = prompt.replace(/'/g, "'\"'\"'").replace(/\n/g, '\\n')
    
    // Build command to change directory and run Claude Code with the prompt
    const command = `cd '${this.worktreePath}' && claude-code '${escapedPrompt}'`
    
    return command
  }

  async bringToFront(): Promise<void> {
    if (!this.terminalTag) {
      throw new Error('No terminal session associated with this task')
    }

    try {
      await focusTaggedSession(this.terminalTag)
      console.log(`[ProcessManager] Brought terminal to front for task ${this.taskId}`)
    } catch (error) {
      console.error(`[ProcessManager] Failed to bring terminal to front:`, error)
      throw error
    }
  }

  // Simplified methods for compatibility
  stopProcesses(): void {
    // Since we're using iTerm, we don't manage the process lifecycle
    // The user will close the terminal when done
    this.isActive = false
    this.emit('status', 'stopped')
  }

  isProcessRunning(): boolean {
    return this.isActive
  }

  // Stub methods for backward compatibility
  async sendPrompt(prompt: string): Promise<void> {
    console.warn('[ProcessManager] sendPrompt is not supported with iTerm integration')
  }

  async reconnectToProcesses(): Promise<void> {
    console.warn('[ProcessManager] reconnectToProcesses is not supported with iTerm integration')
  }
}