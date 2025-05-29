import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { Task } from '../types/task'

const execFileAsync = promisify(execFile)

export interface MergeConflictContext {
  task: Task
  worktreePath: string
  repoPath: string
  branchName: string
  taskPrompt: string
  conflictFiles: string[]
}

export interface MergeConflictOutput {
  type: 'claude-code' | 'system' | 'error'
  content: string
  timestamp: Date
}

export class MergeConflictResolver {
  private claudeCodeAvailable: boolean | null = null
  private outputCallback?: (output: MergeConflictOutput) => void
  
  setOutputCallback(callback: (output: MergeConflictOutput) => void) {
    this.outputCallback = callback
  }
  
  private sendOutput(type: MergeConflictOutput['type'], content: string) {
    if (this.outputCallback) {
      this.outputCallback({
        type,
        content,
        timestamp: new Date()
      })
    }
  }
  
  async checkClaudeCodeAvailable(): Promise<boolean> {
    if (this.claudeCodeAvailable !== null) {
      return this.claudeCodeAvailable
    }
    
    try {
      await execFileAsync('which', ['claude'])
      this.claudeCodeAvailable = true
      return true
    } catch {
      this.claudeCodeAvailable = false
      return false
    }
  }
  
  async resolveConflicts(context: MergeConflictContext): Promise<void> {
    console.log(`[MergeConflictResolver] Starting conflict resolution for task ${context.task.id}`)
    this.sendOutput('system', `Starting automatic conflict resolution for task ${context.task.id}...`)
    
    // Check if Claude Code is available
    const isAvailable = await this.checkClaudeCodeAvailable()
    if (!isAvailable) {
      const error = 'Claude Code CLI is not installed or not in PATH'
      this.sendOutput('error', error)
      throw new Error(error)
    }
    
    try {
      // Get the list of conflicted files
      this.sendOutput('system', 'Analyzing merge conflicts...')
      const conflictedFiles = await this.getConflictedFiles(context.repoPath)
      console.log(`[MergeConflictResolver] Found ${conflictedFiles.length} conflicted files`)
      this.sendOutput('system', `Found ${conflictedFiles.length} conflicted file(s): ${conflictedFiles.join(', ')}`)
      
      if (conflictedFiles.length === 0) {
        const error = 'No merge conflicts detected'
        this.sendOutput('error', error)
        throw new Error(error)
      }
      
      // Get the diff of changes from the task
      this.sendOutput('system', 'Retrieving task changes...')
      const taskChanges = await this.getTaskChanges(context.worktreePath, context.branchName)
      
      // Build a comprehensive prompt for Claude Code
      this.sendOutput('system', 'Preparing Claude Code prompt...')
      const resolutionPrompt = await this.buildResolutionPrompt(
        context,
        conflictedFiles,
        taskChanges
      )
      
      // Run Claude Code to resolve conflicts
      this.sendOutput('system', 'Running Claude Code to resolve conflicts...')
      await this.runClaudeCode(context.repoPath, resolutionPrompt)
      
      // Verify all conflicts are resolved
      this.sendOutput('system', 'Verifying conflict resolution...')
      const remainingConflicts = await this.getConflictedFiles(context.repoPath)
      if (remainingConflicts.length > 0) {
        const error = `Failed to resolve all conflicts. ${remainingConflicts.length} files still have conflicts.`
        this.sendOutput('error', error)
        throw new Error(error)
      }
      
      // Stage all resolved files
      this.sendOutput('system', 'Staging resolved files...')
      await execFileAsync('git', ['-C', context.repoPath, 'add', '.'])
      
      // Complete the merge
      this.sendOutput('system', 'Completing merge...')
      const commitMessage = `Merge branch '${context.branchName}' (resolved conflicts with Claude Code)\n\nOriginal task: ${context.taskPrompt}`
      await execFileAsync('git', ['-C', context.repoPath, 'commit', '--no-edit', '-m', commitMessage])
      
      console.log(`[MergeConflictResolver] Successfully resolved conflicts and completed merge`)
      this.sendOutput('system', 'Successfully resolved conflicts and completed merge!')
    } catch (error) {
      console.error('[MergeConflictResolver] Error resolving conflicts:', error)
      this.sendOutput('error', `Error: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }
  
  private async getConflictedFiles(repoPath: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('git', [
        '-C', repoPath,
        'diff', '--name-only', '--diff-filter=U'
      ])
      
      return stdout.trim().split('\n').filter(file => file.length > 0)
    } catch (error) {
      console.error('[MergeConflictResolver] Error getting conflicted files:', error)
      return []
    }
  }
  
  private async getTaskChanges(worktreePath: string, branchName: string): Promise<string> {
    try {
      // Get the diff between main and the task branch
      const { stdout } = await execFileAsync('git', [
        '-C', worktreePath,
        'diff', 'main...HEAD'
      ])
      
      return stdout
    } catch (error) {
      console.error('[MergeConflictResolver] Error getting task changes:', error)
      return ''
    }
  }
  
  private async buildResolutionPrompt(
    context: MergeConflictContext,
    conflictedFiles: string[],
    taskChanges: string
  ): Promise<string> {
    // Build a detailed prompt for Claude Code
    let prompt = `You are resolving merge conflicts for a task that was just completed. 

## Original Task
${context.taskPrompt}

## Task Context
- Task ID: ${context.task.id}
- Branch: ${context.branchName}
- Created: ${context.task.createdAt}

## Merge Conflict Resolution Instructions
There are merge conflicts in ${conflictedFiles.length} file(s) that need to be resolved:
${conflictedFiles.map(f => `- ${f}`).join('\n')}

## Changes Made by the Task
The following changes were made by the task (git diff):
\`\`\`diff
${taskChanges.substring(0, 10000)}${taskChanges.length > 10000 ? '\n... (truncated)' : ''}
\`\`\`

## Your Mission
1. Examine each conflicted file carefully
2. Understand the intent of both the task changes (<<<<<<< HEAD) and the main branch changes (>>>>>>> branch)
3. Resolve conflicts by:
   - Keeping the task's changes when they represent the intended functionality
   - Preserving important changes from main that don't conflict with the task's purpose
   - Merging both sets of changes when they're complementary
   - Ensuring the final code is syntactically correct and functional

4. Remove all conflict markers (<<<<<<, ======, >>>>>>)
5. Make sure the resolved code aligns with the original task's intent

IMPORTANT: Focus only on resolving the merge conflicts. Do not make additional changes beyond what's necessary to resolve the conflicts and ensure the code works correctly.`
    
    return prompt
  }
  
  private async runClaudeCode(repoPath: string, prompt: string): Promise<void> {
    console.log('[MergeConflictResolver] Running Claude Code to resolve conflicts')
    
    // Validate repo path to prevent directory traversal
    const resolvedPath = path.resolve(repoPath)
    if (!resolvedPath.startsWith(path.resolve(process.cwd()))) {
      throw new Error('Invalid repository path')
    }
    
    try {
      // Use prompt file approach for better security (avoids shell interpretation)
      return await this.runClaudeCodeWithFile(resolvedPath, prompt)
    } catch (error: any) {
      console.error('[MergeConflictResolver] Error running Claude Code:', error)
      
      // Check if Claude Code is installed
      if (error.code === 'ENOENT') {
        throw new Error('Claude Code CLI not found. Please ensure Claude Code is installed and available in PATH.')
      }
      
      throw new Error(`Claude Code failed: ${error.message}`)
    }
  }
  
  private async runClaudeCodeWithFile(repoPath: string, prompt: string): Promise<void> {
    // Validate repo path again
    const resolvedPath = path.resolve(repoPath)
    if (!resolvedPath.startsWith(path.resolve(process.cwd()))) {
      throw new Error('Invalid repository path')
    }
    
    // Create a temporary file with secure random name
    const tempFileName = `.claude-merge-prompt-${crypto.randomBytes(8).toString('hex')}.tmp`
    const tempPromptFile = path.join(resolvedPath, tempFileName)
    
    // Ensure temp file is within repo directory
    const resolvedTempFile = path.resolve(tempPromptFile)
    if (!resolvedTempFile.startsWith(resolvedPath)) {
      throw new Error('Invalid temporary file path')
    }
    
    await fs.writeFile(tempPromptFile, prompt, { mode: 0o600 }) // Restrict file permissions
    
    try {
      // Get model from environment or use default
      const model = process.env.CLAUDE_CODE_MODEL || 'claude-3-5-sonnet-20241022'
      const maxThinkingTime = process.env.CLAUDE_CODE_MAX_THINKING_TIME || '30000'
      
      // Use spawn instead of execFile for streaming output
      const claudeProcess = spawn('claude', [
        'code',
        '--prompt-file', tempPromptFile,
        '--yes', // Auto-confirm any prompts
        '--max-thinking-time', maxThinkingTime,
        '--model', model
      ], {
        cwd: repoPath,
        env: {
          ...process.env,
          CLAUDE_CODE_NON_INTERACTIVE: '1' // Set non-interactive mode
        }
      })
      
      // Stream stdout
      claudeProcess.stdout.on('data', (data) => {
        const output = data.toString()
        this.sendOutput('claude-code', output)
        console.log('[MergeConflictResolver] Claude Code output:', output)
      })
      
      // Stream stderr
      claudeProcess.stderr.on('data', (data) => {
        const output = data.toString()
        this.sendOutput('claude-code', output)
        console.warn('[MergeConflictResolver] Claude Code stderr:', output)
      })
      
      // Wait for process to complete
      await new Promise<void>((resolve, reject) => {
        let timeout: NodeJS.Timeout
        
        // Set a 5-minute timeout
        timeout = setTimeout(() => {
          claudeProcess.kill()
          reject(new Error('Claude Code execution timed out after 5 minutes'))
        }, 300000)
        
        claudeProcess.on('close', (code) => {
          clearTimeout(timeout)
          if (code !== 0) {
            reject(new Error(`Claude Code exited with code ${code}`))
          } else {
            console.log('[MergeConflictResolver] Claude Code completed successfully (via prompt file)')
            resolve()
          }
        })
        
        claudeProcess.on('error', (error) => {
          clearTimeout(timeout)
          claudeProcess.kill() // Ensure process is killed
          reject(error)
        })
      })
    } catch (error: any) {
      console.error('[MergeConflictResolver] Error running Claude Code with file:', error)
      throw new Error(`Claude Code failed: ${error.message}`)
    } finally {
      // Clean up temp file
      try {
        await fs.unlink(tempPromptFile)
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }
}

export const mergeConflictResolver = new MergeConflictResolver()