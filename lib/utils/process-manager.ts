import { EventEmitter } from 'events'
import { spawnTaggedSession, focusTaggedSession } from './iterm-integration'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

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
    
    // Save prompt to a temporary file to avoid command line length limits
    const tempFile = join(tmpdir(), `claude-prompt-${this.taskId}.txt`)
    try {
      await fs.writeFile(tempFile, prompt, 'utf-8')
      
      // Build the Claude Code command
      const command = await this.buildClaudeCommand(tempFile)
      
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

  private async buildClaudeCommand(promptFile: string): Promise<string> {
    // Escape the worktree path
    const escapedPath = this.worktreePath.replace(/'/g, "'\\''")
    
    // Escape the prompt file path
    const escapedPromptFile = promptFile.replace(/'/g, "'\\''")
    
    // Build command to change directory, cat the prompt file and pipe to claude
    // This avoids command line length limits for long prompts
    const command = `cd '${escapedPath}' && cat '${escapedPromptFile}' | claude --verbose --dangerously-skip-permissions && rm -f '${escapedPromptFile}'`
    
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