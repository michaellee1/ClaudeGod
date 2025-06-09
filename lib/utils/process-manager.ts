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
      this.emit('terminalSpawned', {
        taskId: this.taskId,
        tag: this.terminalTag,
        mode: this.mode
      })
      
      console.log(`[ProcessManager] Spawned iTerm session for task ${this.taskId} in ${mode} mode with tag: ${this.terminalTag}`)
    } catch (error) {
      console.error(`[ProcessManager] Failed to spawn iTerm session:`, error)
      this.emit('error', error)
      throw error
    }
  }

  private buildClaudeCommand(prompt: string): string {
    // Properly escape the prompt for shell - handle single quotes by ending the quote,
    // adding an escaped quote, and starting a new quote
    const escapedPrompt = prompt.replace(/'/g, "'\\''")
    
    // Escape the worktree path similarly
    const escapedPath = this.worktreePath.replace(/'/g, "'\\''")
    
    // Build command to change directory and run claude with the prompt
    // Include the same flags as before, except -p
    const command = `cd '${escapedPath}' && claude --verbose --dangerously-skip-permissions '${escapedPrompt}'`
    
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