import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { promises as fsPromises } from 'fs'
import { Initiative } from '../types/initiative'
import { processStateManager } from './process-state'
import Tail from 'tail'
import { PROMPTS } from './initiative-prompts'

export interface ProcessOutput {
  type: 'planner' | 'editor' | 'reviewer'
  content: string
  timestamp: Date
}

export class ProcessManager extends EventEmitter {
  private static readonly OUTPUT_DIR = path.join(os.homedir(), '.claude-god-data', 'process-outputs')
  
  private editorProcess: ChildProcess | null = null
  private reviewerProcess: ChildProcess | null = null
  private plannerProcess: ChildProcess | null = null
  private currentPhase: 'starting' | 'planner' | 'editor' | 'reviewer' | 'finished' = 'starting'
  private lastOutputTime: number = 0
  private outputMonitorInterval: NodeJS.Timeout | null = null
  private readonly IDLE_TIMEOUT = 1800000 // 30 minutes - increased timeout for long-running tasks
  private readonly GRACEFUL_SHUTDOWN_TIMEOUT = 5000 // 5 seconds for graceful shutdown
  private isShuttingDown = false
  private processExitCode: number | null = null
  private outputBuffer: string = ''
  private readonly COMPLETION_PATTERNS = [
    /Task complete/i,
    /Done\./i,
    /Finished\./i,
    /All tests pass/i,
    /Successfully completed/i
  ]
  private taskId: string
  private worktreePath: string
  private repoPath: string
  private planFilePath: string | null = null
  private editorPrompt: string = ''
  private reviewerPrompt: string = ''
  private thinkMode: string | undefined
  private cleanupCallbacks: (() => void)[] = []
  private initiativeMetadata: {
    initiativeId?: string
    phase?: string
    startTime?: Date
    pid?: number
  } = {}
  private fileTails: Map<string, Tail.Tail> = new Map()
  private isAdopted: boolean = false

  constructor(taskId?: string, worktreePath?: string, repoPath?: string) {
    super()
    this.taskId = this.validateAndSanitizeTaskId(taskId || '')
    this.worktreePath = worktreePath || ''
    this.repoPath = repoPath || ''
  }

  private validateAndSanitizeTaskId(taskId: string): string {
    // Remove any path traversal attempts
    const sanitized = taskId.replace(/\.\./g, '').replace(/[\/\\]/g, '-')
    
    // Validate format (alphanumeric, hyphens, and underscores only)
    if (!/^[a-zA-Z0-9-_]*$/.test(sanitized)) {
      throw new Error(`Invalid task ID format: ${taskId}`)
    }
    
    return sanitized
  }

  private async ensureOutputDir() {
    const absoluteOutputDir = path.resolve(ProcessManager.OUTPUT_DIR)
    await fsPromises.mkdir(absoluteOutputDir, { recursive: true })
    console.log(`[ProcessManager] Ensured output directory at: ${absoluteOutputDir}`)
  }

  private getOutputPaths(phase: 'editor' | 'reviewer' | 'planner') {
    const timestamp = new Date().toISOString().replace(/:/g, '-')
    // Use path.basename to ensure no path traversal
    const safeTaskId = path.basename(this.taskId)
    const absoluteOutputDir = path.resolve(ProcessManager.OUTPUT_DIR)
    const base = path.join(absoluteOutputDir, safeTaskId, `${phase}-${timestamp}`)
    return {
      stdout: `${base}.stdout.log`,
      stderr: `${base}.stderr.log`,
      stdin: `${base}.stdin.log`
    }
  }

  private async createOutputStreams(phase: 'editor' | 'reviewer' | 'planner') {
    await this.ensureOutputDir()
    const absoluteOutputDir = path.resolve(ProcessManager.OUTPUT_DIR)
    await fsPromises.mkdir(path.join(absoluteOutputDir, this.taskId), { recursive: true })
    
    const paths = this.getOutputPaths(phase)
    
    // Create empty files
    await fsPromises.writeFile(paths.stdout, '')
    await fsPromises.writeFile(paths.stderr, '')
    await fsPromises.writeFile(paths.stdin, '')
    
    return { paths }
  }

  private async readRecentOutput(filePath: string, lines: number): Promise<string[]> {
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8')
      const allLines = content.split('\n').filter(line => line.trim())
      return allLines.slice(-lines)
    } catch (error) {
      console.error(`[ProcessManager] Failed to read ${filePath}:`, error)
      return []
    }
  }

  private async readAllOutput(filePath: string): Promise<string[]> {
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8')
      const allLines = content.split('\n').filter(line => line.trim())
      return allLines
    } catch (error) {
      console.error(`[ProcessManager] Failed to read ${filePath}:`, error)
      return []
    }
  }

  private async checkProcessExitCode(outputPath: string): Promise<number | null> {
    try {
      const exitCodePath = outputPath.replace('.stdout.log', '.exitcode')
      const exitCodeStr = await fsPromises.readFile(exitCodePath, 'utf-8')
      const exitCode = parseInt(exitCodeStr.trim(), 10)
      return isNaN(exitCode) ? null : exitCode
    } catch (error) {
      console.log(`[ProcessManager] No exit code file found for ${outputPath}`)
      return null
    }
  }

  // Method to reconnect to existing processes after restart
  async reconnectToProcesses(pids: { editorPid?: number, reviewerPid?: number, plannerPid?: number }, phase: string, thinkMode?: string) {
    this.currentPhase = phase as any
    this.thinkMode = thinkMode
    this.isAdopted = true
    
    // Check if processes are registered in our state
    const processInfo = processStateManager.getProcessForTask(this.taskId)
    if (processInfo) {
      console.log(`[ProcessManager] Found registered process for task ${this.taskId}:`, processInfo)
      
      // If we have output paths, tail the files
      if (processInfo.outputPaths) {
        // Reconnect to stdout
        if (processInfo.outputPaths.stdout) {
          // First, read ALL historical output from the file
          const allLines = await this.readAllOutput(processInfo.outputPaths.stdout)
          console.log(`[ProcessManager] Reading ${allLines.length} historical log lines for task ${this.taskId}`)
          
          // Process all historical lines
          for (const line of allLines) {
            // Skip empty lines
            if (!line.trim()) continue
            
            try {
              // Try to parse as JSON (stream-json format)
              const parsed = JSON.parse(line)
              
              // Handle different message types
              if (parsed.type === 'assistant' && parsed.message?.content) {
                for (const content of parsed.message.content) {
                  if (content.type === 'text') {
                    this.emit('output', {
                      type: processInfo.phase || 'editor',
                      content: content.text,
                      timestamp: new Date()
                    })
                  }
                }
              } else if (parsed.type === 'tool_use') {
                // Tool usage output
                let toolInfo = this.formatToolInfo(parsed)
                this.emit('output', {
                  type: processInfo.phase || 'editor',
                  content: toolInfo,
                  timestamp: new Date()
                })
              }
            } catch (e) {
              // Not JSON - emit as plain text
              if (!line.includes('{"type":')) {
                this.emit('output', {
                  type: processInfo.phase || 'editor',
                  content: line,
                  timestamp: new Date()
                })
              }
            }
          }
          
          // Add a separator to indicate new live output
          this.emit('output', {
            type: processInfo.phase || 'editor',
            content: '--- Reconnected to live output ---',
            timestamp: new Date()
          })
          
          // Then tail for new output
          this.tailFile(processInfo.outputPaths.stdout, processInfo.phase || 'editor')
        }
        
        // Reconnect to stderr
        if (processInfo.outputPaths.stderr) {
          this.tailFile(processInfo.outputPaths.stderr, processInfo.phase || 'editor', true)
        }
      }
    }
    
    console.log(`ProcessManager reconnected for task ${this.taskId}:`, {
      editorPid: pids.editorPid,
      reviewerPid: pids.reviewerPid,
      plannerPid: pids.plannerPid,
      phase: phase,
      thinkMode: thinkMode
    })
    
    // Monitor the processes to detect when they complete
    this.monitorExistingProcesses(pids)
  }

  private async monitorExistingProcesses(pids: { editorPid?: number, reviewerPid?: number, plannerPid?: number }) {
    const { execFile } = require('child_process')
    const { promisify } = require('util')
    const exec = promisify(execFile)
    
    // Set up monitoring interval
    const checkInterval = setInterval(async () => {
      let anyAlive = false
      
      // Check each process
      for (const [processType, pid] of Object.entries(pids)) {
        if (pid) {
          try {
            await exec('kill', ['-0', pid.toString()])
            anyAlive = true
          } catch {
            // Process is dead
            console.log(`${processType} (PID ${pid}) has terminated`)
          }
        }
      }
      
      if (!anyAlive) {
        clearInterval(checkInterval)
        console.log(`All processes for task ${this.taskId} have terminated`)
        
        // Update phase based on what was running
        if (this.currentPhase === 'reviewer' && pids.reviewerPid) {
          this.currentPhase = 'finished'
          this.emit('status', 'finished')
          this.emit('phase', 'done')
          this.emit('completed', true)
        } else if (this.currentPhase === 'editor' && pids.editorPid && !pids.reviewerPid) {
          // Editor finished but no reviewer started
          // Only mark as finished if we're in no_review mode
          if (this.thinkMode === 'no_review') {
            this.currentPhase = 'finished'
            this.emit('status', 'finished')
            this.emit('phase', 'done')
            this.emit('completed', true)
          } else {
            // For other modes, check exit code to determine actual failure reason
            const processInfo = processStateManager.getProcessForTask(this.taskId)
            if (processInfo && processInfo.outputPaths?.stdout) {
              const exitCode = await this.checkProcessExitCode(processInfo.outputPaths.stdout)
              if (exitCode !== null && exitCode !== 0) {
                console.log(`Task ${this.taskId} editor failed with exit code ${exitCode}`)
                this.emit('status', 'failed')
                this.emit('error', new Error(`Editor process failed with exit code ${exitCode}`))
              } else {
                console.log(`Task ${this.taskId} editor exited without starting reviewer (thinkMode: ${this.thinkMode})`)
                this.emit('status', 'failed')
                this.emit('error', new Error('Editor process exited without starting reviewer'))
              }
            } else {
              this.emit('status', 'failed')
              this.emit('error', new Error('Editor process exited unexpectedly'))
            }
          }
        }
      }
    }, 5000) // Check every 5 seconds
  }

  private tailFile(filePath: string, phase: 'editor' | 'reviewer' | 'planner', isError: boolean = false) {
    // Check if we're already tailing this file
    const tailKey = `${phase}-${filePath}`
    if (this.fileTails.has(tailKey)) {
      console.log(`[ProcessManager] Already tailing ${phase} output: ${filePath}`)
      return
    }

    console.log(`[ProcessManager] Starting to tail ${phase} output: ${filePath}`)
    
    const tail = new Tail.Tail(filePath, {
      follow: true,
      fromBeginning: false,
      useWatchFile: true,
      logger: console
    })
    
    tail.on('line', (data: string) => {
      this.lastOutputTime = Date.now()
      
      if (isError) {
        this.emit('output', {
          type: phase,
          content: `[ERROR] ${data}`,
          timestamp: new Date()
        })
      } else {
        // Process the output similar to the original stdout handler
        this.processOutput(data, phase)
      }
    })
    
    let retryCount = 0
    const MAX_RETRIES = 10
    
    tail.on('error', (error: Error) => {
      console.error(`[ProcessManager] Tail error for ${filePath}:`, error)
      // File might not exist yet, retry with limit
      if (error.message.includes('ENOENT') && retryCount < MAX_RETRIES) {
        retryCount++
        // Clean up the failed tail watcher before retrying
        tail.unwatch()
        this.fileTails.delete(tailKey)
        
        setTimeout(() => {
          if (!this.isShuttingDown) {
            console.log(`[ProcessManager] Retrying tail for ${filePath} (attempt ${retryCount}/${MAX_RETRIES})`)
            this.tailFile(filePath, phase, isError)
          }
        }, 1000)
      } else if (retryCount >= MAX_RETRIES) {
        console.error(`[ProcessManager] Max retries reached for tailing ${filePath}`)
        tail.unwatch()
        this.fileTails.delete(tailKey)
      }
    })
    
    this.fileTails.set(tailKey, tail)
    
    // Clean up on process manager cleanup
    this.cleanupCallbacks.push(() => {
      tail.unwatch()
      this.fileTails.delete(tailKey)
    })
  }

  private processOutput(data: string, phase: 'editor' | 'reviewer' | 'planner') {
    const content = data.toString()
    
    // Parse stream-json format
    const lines = content.split('\n')
    for (const line of lines.filter((l: string) => l.trim())) {
      try {
        const parsed = JSON.parse(line)
        
        // Handle different message types
        if (parsed.type === 'assistant' && parsed.message?.content) {
          for (const content of parsed.message.content) {
            if (content.type === 'text') {
              this.emit('output', {
                type: phase,
                content: content.text,
                timestamp: new Date()
              })
            }
          }
        } else if (parsed.type === 'tool_use') {
          // Tool usage output
          let toolInfo = `⚡ Using tool: ${parsed.name}`
          
          if (parsed.input) {
            toolInfo = this.formatToolInfo(parsed)
          }
          
          this.emit('output', {
            type: phase,
            content: toolInfo,
            timestamp: new Date()
          })
        } else if (parsed.type === 'system' && parsed.subtype === 'init') {
          // Log initialization
          this.emit('output', {
            type: phase,
            content: `🚀 Started`,
            timestamp: new Date()
          })
        }
      } catch (e) {
        // Not JSON - emit as plain text
        if (!line.includes('{"type":')) {
          this.emit('output', {
            type: phase,
            content: line,
            timestamp: new Date()
          })
        }
      }
    }
  }

  private formatToolInfo(parsed: any): string {
    let toolInfo = `⚡ Using tool: ${parsed.name}`
    
    // Check if input exists before accessing properties
    if (!parsed.input) {
      return toolInfo
    }
    
    switch (parsed.name) {
      case 'Read':
        if (parsed.input.file_path) {
          toolInfo = `📖 Reading: ${parsed.input.file_path}`
        }
        break
      case 'Write':
        if (parsed.input.file_path) {
          toolInfo = `💾 Writing: ${parsed.input.file_path}`
        }
        break
      case 'Edit':
        if (parsed.input.file_path) {
          toolInfo = `✏️ Editing: ${parsed.input.file_path}`
        }
        break
      case 'Grep':
        if (parsed.input.pattern) {
          toolInfo = `🔍 Searching: "${parsed.input.pattern}"`
        }
        break
      case 'Glob':
        if (parsed.input.pattern) {
          toolInfo = `📁 Finding: ${parsed.input.pattern}`
        }
        break
      case 'Bash':
        if (parsed.input.command) {
          const cmd = parsed.input.command.substring(0, 80)
          toolInfo = `🖥️ Running: ${cmd}${parsed.input.command.length > 80 ? '...' : ''}`
        }
        break
      case 'LS':
        if (parsed.input.path) {
          toolInfo = `📂 Listing: ${parsed.input.path}`
        }
        break
      // Add other tools as needed
    }
    
    return toolInfo
  }

  async startProcesses(
    worktreePath: string,
    prompt: string,
    taskId: string,
    thinkMode?: string
  ): Promise<{ editorPid: number, reviewerPid: number, plannerPid?: number }> {
    this.emit('status', 'starting')
    
    // Handle planning mode
    if (thinkMode === 'planning') {
      try {
        // Start with planning phase
        this.currentPhase = 'planner'
        this.emit('phase', 'planner')
        
        // Create secure temp file path
        const tempDir = process.env.TMPDIR || '/tmp'
        this.planFilePath = path.join(tempDir, `claude-task-plan-${taskId}-${Date.now()}.md`)
        
        const plannerPrompt = `${prompt}. Ultrathink

Task: Deeply analyze this task and create a detailed implementation plan.

1. Carefully read and understand the task description
2. Explore the codebase to understand:
   - Project structure and architecture
   - Existing patterns and conventions
   - Dependencies and libraries used
   - Testing framework if any
3. Identify all components that need to be:
   - Created
   - Modified
   - Tested
4. Consider edge cases and potential challenges
5. Create a detailed plan in a markdown file at ${this.planFilePath}

The plan should include:
- Task summary and objectives
- Files to be created/modified with specific changes
- Implementation steps in order
- Testing strategy
- Potential risks or complexities
- More detail for complex parts

Be thorough but concise. Focus on actionable steps.`
        
        // Store prompts for later phases
        this.editorPrompt = `${prompt}. Ultrathink

IMPORTANT: A detailed plan has been created at ${this.planFilePath}

1. First, read the plan using: cat ${this.planFilePath}
2. Follow the plan to implement the task
3. Feel free to adjust the plan if you find a better approach
4. Ensure all requirements from the original prompt are met
5. The plan provides guidance but you should use your judgment

Original task: "${prompt}"`
        
        this.reviewerPrompt = `Task: "${prompt}"

A plan was created at ${this.planFilePath} and implementation was done based on it.

Review the implementation:
1. Run 'git diff' to see changes
2. Read the plan: cat ${this.planFilePath}
3. Verify all requirements are met
4. Check for bugs, security issues, code quality
5. Fix any issues found
6. Run tests if available

Begin with 'git diff'.`
        
        this.thinkMode = thinkMode
        
        // Start planner process
        await this.startPlannerProcess(worktreePath, plannerPrompt)
        
        // Emit status after successful start
        console.log(`[ProcessManager ${taskId}] Emitting status: in_progress for planning mode`)
        this.emit('status', 'in_progress')
        
        // Return early - planner will trigger editor when done
        // Verify plannerProcess was created successfully
        if (!this.plannerProcess || !this.plannerProcess.pid) {
          throw new Error('Planner process failed to start')
        }
        return {
          editorPid: 0,
          reviewerPid: 0,
          plannerPid: this.plannerProcess.pid
        }
      } catch (error) {
        console.error('Error in planning mode:', error)
        this.emit('status', 'failed')
        throw error
      }
    }
    
    const editorPrompt = prompt
    const reviewerPrompt = `Task: "${prompt}"

Review the implementation:
1. Run 'git diff' to see changes
2. Verify requirements are met
3. Check for bugs, security issues, code quality
4. Fix any issues found
5. Run tests if available

Begin with 'git diff'.`

    try {
      // Start editor process first
      // Create output files for file-based I/O
      const { paths } = await this.createOutputStreams('editor')
      
      // Write prompt to stdin file
      await fsPromises.writeFile(paths.stdin, editorPrompt)
      
      const nodeExecutable = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/bin/node')
      const claudePath = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/lib/node_modules/@anthropic-ai/claude-code/cli.js')
      
      console.log('Starting editor process with Node executable:', nodeExecutable)
      console.log('Claude CLI path:', claudePath)
      console.log('Working directory:', worktreePath)
      console.log('Output paths:', paths)
      
      const args = [
        '--no-warnings',
        '--enable-source-maps',
        claudePath,
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--dangerously-skip-permissions'
      ]
      
      // Escape paths for shell safety - properly handle all shell metacharacters
      const escapePath = (p: string) => {
        // Escape shell metacharacters by wrapping in single quotes and escaping embedded single quotes
        // This handles all special characters including $, `, newlines, etc.
        return "'" + p.replace(/'/g, "'\"'\"'") + "'"
      }
      
      // Use shell to handle redirection (using single quotes for safety)
      // Wrap command to capture exit code for recovery after server restart
      const exitCodePath = paths.stdout.replace('.stdout.log', '.exitcode')
      const innerCommand = `${nodeExecutable} ${args.join(' ')} < '${escapePath(paths.stdin)}' > '${escapePath(paths.stdout)}' 2> '${escapePath(paths.stderr)}'`
      const shellCommand = `sh -c '${innerCommand}; echo $? > '${escapePath(exitCodePath)}''`
      
      console.log('Shell command:', shellCommand)
      
      // Use shell with nohup for true detachment
      // Use setsid to create a new session for proper process group management
      this.editorProcess = spawn('sh', ['-c', `setsid nohup ${shellCommand}`], {
        cwd: worktreePath,
        stdio: 'ignore',
        detached: true
      })

      if (!this.editorProcess.pid) {
        throw new Error('Failed to start editor process')
      }
      
      console.log('Editor process started with PID:', this.editorProcess.pid)
      
      // Unref the process so it doesn't keep the parent alive
      this.editorProcess.unref()
      
      // Register process in state manager
      await processStateManager.registerProcess({
        pid: this.editorProcess.pid,
        taskId: this.taskId,
        phase: 'editor',
        startTime: Date.now(),
        worktreePath: worktreePath,
        prompt: editorPrompt,
        outputPaths: paths,
        shellCommand: shellCommand
      })
      
      // Start tailing output files
      this.tailFile(paths.stdout, 'editor')
      this.tailFile(paths.stderr, 'editor', true)
      
      // Add cleanup callback for stdin file (contains potentially large prompt)
      this.cleanupCallbacks.push(() => {
        fsPromises.unlink(paths.stdin).catch(err => 
          console.error(`[ProcessManager] Failed to cleanup stdin file: ${err}`)
        )
      })

      this.setupEditorHandlers()
      
      // Start sequential execution which will handle reviewer process
      this.startSequentialExecution(worktreePath, reviewerPrompt, thinkMode)

      // Return PIDs (reviewer PID will be 0 initially)
      return {
        editorPid: this.editorProcess.pid,
        reviewerPid: 0 // Will be set when reviewer starts
      }
    } catch (error) {
      this.emit('status', 'failed')
      throw error
    }
  }

  private setupEditorHandlers() {
    if (this.editorProcess) {
      console.log('Setting up editor handlers, PID:', this.editorProcess.pid)
      
      // Since we're using file-based I/O, we don't have stdout/stderr pipes
      // The file tailing handles output monitoring
      
      this.editorProcess.on('error', (error) => {
        console.log('Editor process error:', error)
        this.emit('output', {
          type: 'editor',
          content: `❌ Error: ${error.message}`,
          timestamp: new Date()
        })
        this.emit('status', 'failed')
      })
      
      this.editorProcess.on('exit', async (code, signal) => {
        console.log('Editor process exited with code:', code, 'signal:', signal)
        this.processExitCode = code
        
        // Clean up file tails for this phase
        const tailKey = `editor-${this.editorProcess?.pid}`
        for (const [key, tail] of this.fileTails) {
          if (key.startsWith('editor-')) {
            try {
              tail.unwatch()
              this.fileTails.delete(key)
            } catch (error) {
              console.error('Error cleaning up tail:', error)
            }
          }
        }
        
        // Unregister process on exit
        await processStateManager.unregisterProcess(this.taskId, 'editor')
        
        let exitMessage: string
        if (code === 0) {
          exitMessage = `✓ Completed successfully`
        } else if (code === 143 && !this.isShuttingDown) {
          exitMessage = `⚠️ Terminated (timeout or resource limit)`
          this.emit('error', new Error(exitMessage))
        } else if (!this.isShuttingDown) {
          exitMessage = `❌ Failed (exit code: ${code})`
        } else {
          exitMessage = `Stopped`
        }
        
        this.emit('output', {
          type: 'editor',
          content: exitMessage,
          timestamp: new Date()
        })
        
        // If process exits with non-zero code and we're not already finished or shutting down, mark as failed
        if (code !== 0 && this.currentPhase === 'editor' && !this.isShuttingDown) {
          console.error('Editor process failed with code:', code)
        }
        
        // If editor exits cleanly in no_review mode, this will be handled in startSequentialExecution
      })
    }
  }

  private setupReviewerHandlers() {
    if (this.reviewerProcess) {
      console.log('Setting up reviewer handlers, PID:', this.reviewerProcess.pid)
      
      // Since we're using file-based I/O, we don't have stdout/stderr pipes
      // The file tailing handles output monitoring
      
      this.reviewerProcess.on('error', (error) => {
        console.log('Reviewer process error:', error)
        this.emit('output', {
          type: 'reviewer',
          content: `❌ Error: ${error.message}`,
          timestamp: new Date()
        })
        this.emit('status', 'failed')
      })
      
      this.reviewerProcess.on('exit', async (code, signal) => {
        console.log('Reviewer process exited with code:', code, 'signal:', signal)
        this.processExitCode = code
        
        // Clean up file tails for this phase
        for (const [key, tail] of this.fileTails) {
          if (key.startsWith('reviewer-')) {
            try {
              tail.unwatch()
              this.fileTails.delete(key)
            } catch (error) {
              console.error('Error cleaning up tail:', error)
            }
          }
        }
        
        // Unregister process on exit
        await processStateManager.unregisterProcess(this.taskId, 'reviewer')
        
        let exitMessage: string
        if (code === 0) {
          exitMessage = `✓ Completed successfully`
        } else if (code === 143 && !this.isShuttingDown) {
          exitMessage = `⚠️ Terminated (timeout or resource limit)`
          this.emit('error', new Error(exitMessage))
        } else if (!this.isShuttingDown) {
          exitMessage = `❌ Failed (exit code: ${code})`
        } else {
          exitMessage = `Stopped`
        }
        
        this.emit('output', {
          type: 'reviewer',
          content: exitMessage,
          timestamp: new Date()
        })
        
        // If reviewer exits cleanly and we're in reviewer phase, mark as completed
        if (code === 0 && this.currentPhase === 'reviewer') {
          console.log('Reviewer completed successfully, marking task as finished')
          this.currentPhase = 'finished'
          this.emit('status', 'finished')
          this.emit('phase', 'done')
          this.emit('completed', true) // Pass true to indicate successful completion
        } else if (code !== 0 && this.currentPhase === 'reviewer' && !this.isShuttingDown) {
          console.error('Reviewer process failed with code:', code)
          this.emit('status', 'failed')
        }
      })
    }
  }

  private async startSequentialExecution(worktreePath: string, reviewerPrompt: string, thinkMode?: string) {
    // Phase 1: Editor
    this.currentPhase = 'editor'
    this.emit('status', 'in_progress')
    this.emit('phase', 'editor')
    this.lastOutputTime = Date.now()
    
    // Wait for editor to complete (it will exit on its own with -p mode)
    await this.waitForProcessExit(this.editorProcess, 'editor')
    
    // Check if we should skip the reviewer
    if (thinkMode === 'no_review') {
      console.log(`[ProcessManager ${this.taskId}] Skipping reviewer phase due to no_review mode`)
      this.currentPhase = 'finished'
      this.emit('status', 'finished')
      this.emit('phase', 'done')
      this.emit('completed', true) // Pass true to indicate successful completion
      return
    } else {
      console.log(`[ProcessManager ${this.taskId}] Will start reviewer phase after editor completes (thinkMode: ${thinkMode || 'none'})`)
    }
    
    // Phase 2: Start and monitor reviewer
    this.currentPhase = 'reviewer'
    this.emit('phase', 'reviewer')
    
    try {
      // Create output files for file-based I/O
      const { paths } = await this.createOutputStreams('reviewer')
      
      // Write prompt to stdin file
      await fsPromises.writeFile(paths.stdin, reviewerPrompt)
      
      // Now start the reviewer process
      const nodeExecutable = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/bin/node')
      const claudePath = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/lib/node_modules/@anthropic-ai/claude-code/cli.js')
      
      console.log('Starting reviewer process with Node executable:', nodeExecutable)
      console.log('Claude CLI path:', claudePath)
      console.log('Working directory:', worktreePath)
      console.log('Output paths:', paths)
      
      const args = [
        '--no-warnings',
        '--enable-source-maps',
        claudePath,
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--dangerously-skip-permissions'
      ]
      
      // Escape paths for shell safety - properly handle all shell metacharacters
      const escapePath = (p: string) => {
        // Escape shell metacharacters by wrapping in single quotes and escaping embedded single quotes
        // This handles all special characters including $, `, newlines, etc.
        return "'" + p.replace(/'/g, "'\"'\"'") + "'"
      }
      
      // Use shell to handle redirection (using single quotes for safety)
      // Wrap command to capture exit code for recovery after server restart
      const exitCodePath = paths.stdout.replace('.stdout.log', '.exitcode')
      const innerCommand = `${nodeExecutable} ${args.join(' ')} < '${escapePath(paths.stdin)}' > '${escapePath(paths.stdout)}' 2> '${escapePath(paths.stderr)}'`
      const shellCommand = `sh -c '${innerCommand}; echo $? > '${escapePath(exitCodePath)}''`
      
      console.log('Shell command:', shellCommand)
      
      // Use shell with nohup for true detachment
      // Use setsid to create a new session for proper process group management
      this.reviewerProcess = spawn('sh', ['-c', `setsid nohup ${shellCommand}`], {
        cwd: worktreePath,
        stdio: 'ignore',
        detached: true
      })

      if (!this.reviewerProcess.pid) {
        throw new Error('Failed to start reviewer process')
      }
      
      console.log('Reviewer process started with PID:', this.reviewerProcess.pid)
      
      // Unref the process so it doesn't keep the parent alive
      this.reviewerProcess.unref()
      
      // Register process in state manager
      await processStateManager.registerProcess({
        pid: this.reviewerProcess.pid,
        taskId: this.taskId,
        phase: 'reviewer',
        startTime: Date.now(),
        worktreePath: worktreePath,
        prompt: reviewerPrompt,
        outputPaths: paths,
        shellCommand: shellCommand
      })
      
      // Start tailing output files
      this.tailFile(paths.stdout, 'reviewer')
      this.tailFile(paths.stderr, 'reviewer', true)

      this.emit('reviewerPid', this.reviewerProcess.pid)
      this.setupReviewerHandlers()
      
      this.lastOutputTime = Date.now()
      
      // Wait for reviewer to complete (it will exit on its own with -p mode)
      await this.waitForProcessExit(this.reviewerProcess, 'reviewer')
      
      // The exit handler will emit the completed event
    } catch (error) {
      this.emit('status', 'failed')
      this.emit('output', {
        type: 'reviewer',
        content: `Failed to start reviewer: ${error}`,
        timestamp: new Date()
      })
    }
  }

  private checkForCompletion() {
    // Check recent output for completion patterns
    const recentOutput = this.outputBuffer.slice(-500) // Check last 500 chars
    
    // Prevent unbounded growth - keep only last 10KB
    if (this.outputBuffer.length > 10240) {
      this.outputBuffer = this.outputBuffer.slice(-5120)
    }
    
    for (const pattern of this.COMPLETION_PATTERNS) {
      if (pattern.test(recentOutput)) {
        // Found a completion pattern, wait a bit then complete
        setTimeout(() => {
          if (this.outputMonitorInterval) {
            clearInterval(this.outputMonitorInterval)
            this.outputMonitorInterval = null
          }
        }, 2000) // Wait 2 seconds after completion pattern
        return
      }
    }
  }

  private waitForProcessExit(process: ChildProcess | null, processName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!process) {
        reject(new Error(`${processName} process not found`))
        return
      }

      // Set up a sanity timeout
      const timeout = setTimeout(() => {
        console.warn(`${processName} timed out after 30 minutes`)
        if (!this.isShuttingDown) {
          this.emit('timeout', { processName, pid: process.pid })
        }
        process.kill('SIGTERM')
        resolve()
      }, this.IDLE_TIMEOUT)

      // Wait for process to exit
      process.once('exit', (code) => {
        clearTimeout(timeout)
        console.log(`${processName} process exited with code:`, code)
        resolve()
      })

      process.once('error', (error) => {
        clearTimeout(timeout)
        console.error(`${processName} process error:`, error)
        reject(error)
      })
    })
  }
  
  private monitorProcessCompletion(phase: 'editor' | 'reviewer'): Promise<void> {
    return new Promise((resolve) => {
      // Clear buffer for new phase
      this.outputBuffer = ''
      
      let completionPatternFound = false
      
      this.outputMonitorInterval = setInterval(() => {
        const timeSinceLastOutput = Date.now() - this.lastOutputTime
        
        // Check for completion patterns in recent output
        const recentOutput = this.outputBuffer.slice(-500)
        for (const pattern of this.COMPLETION_PATTERNS) {
          if (pattern.test(recentOutput)) {
            completionPatternFound = true
            break
          }
        }
        
        // Complete if:
        // 1. Found a completion pattern and 2+ seconds have passed, OR
        // 2. No output for IDLE_TIMEOUT seconds
        if ((completionPatternFound && timeSinceLastOutput > 2000) || 
            timeSinceLastOutput > this.IDLE_TIMEOUT) {
          if (this.outputMonitorInterval) {
            clearInterval(this.outputMonitorInterval)
          }
          resolve()
        }
      }, 1000)
    })
  }

  async sendPrompt(prompt: string) {
    // Note: This won't work since we close stdin after sending initial prompt
    // Would need to refactor to keep stdin open if we want to support additional prompts
    console.warn('sendPrompt called but stdin is closed after initial prompt')
  }

  async start(prompt: string, thinkMode?: string): Promise<void> {
    // Use stored values or throw error if not set
    if (!this.worktreePath || !this.taskId) {
      throw new Error('ProcessManager not properly initialized with worktreePath and taskId')
    }
    
    const { editorPid, reviewerPid } = await this.startProcesses(
      this.worktreePath,
      prompt,
      this.taskId,
      thinkMode
    )
    
    this.emit('editorPid', editorPid)
    this.emit('reviewerPid', reviewerPid)
  }

  stopProcesses() {
    this.isShuttingDown = true
    
    if (this.outputMonitorInterval) {
      clearInterval(this.outputMonitorInterval)
    }
    
    // Clean up file tails first
    for (const [key, tail] of this.fileTails) {
      try {
        tail.unwatch()
      } catch (error) {
        console.error('Error unwatching tail:', error)
      }
    }
    this.fileTails.clear()
    
    // Clean up any temporary files
    this.cleanupCallbacks.forEach(cleanup => {
      try {
        cleanup()
      } catch (error) {
        console.error('Cleanup error:', error)
      }
    })
    this.cleanupCallbacks = []
    
    // Give processes time to gracefully shutdown
    const gracefulShutdown = async (process: ChildProcess | null, name: string) => {
      if (!process || !process.pid) return
      
      try {
        // Check if process is still running before attempting to kill
        try {
          process.kill(0) // Signal 0 just checks if process exists
        } catch (e) {
          // Process doesn't exist, nothing to do
          return
        }
        
        // Try to kill the entire process group (negative PID)
        try {
          process.kill(-process.pid, 'SIGTERM')
          console.log(`${name}: Sent SIGTERM to process group ${process.pid}`)
        } catch (e) {
          // If process group kill fails, try regular kill
          process.kill('SIGTERM')
          console.log(`${name}: Sent SIGTERM to process ${process.pid}`)
        }
        
        // Wait up to 5 seconds for graceful exit
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            console.warn(`${name} did not exit gracefully, sending SIGKILL`)
            try {
              // Try process group kill first
              process.kill(-process.pid, 'SIGKILL')
            } catch (e) {
              // Fallback to regular kill
              try {
                process.kill('SIGKILL')
              } catch (e2) {
                // Process may already be dead
              }
            }
            resolve()
          }, this.GRACEFUL_SHUTDOWN_TIMEOUT)
          
          process.once('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
      } catch (error) {
        console.error(`Error stopping ${name}:`, error)
      }
    }
    
    // Stop all processes gracefully
    Promise.all([
      gracefulShutdown(this.plannerProcess, 'planner'),
      gracefulShutdown(this.editorProcess, 'editor'),
      gracefulShutdown(this.reviewerProcess, 'reviewer')
    ]).then(() => {
      this.plannerProcess = null
      this.editorProcess = null
      this.reviewerProcess = null
      this.isShuttingDown = false
      this.planFilePath = null
      this.editorPrompt = ''
      this.reviewerPrompt = ''
      this.thinkMode = undefined
    })
  }
  
  isProcessRunning(): boolean {
    return !!(this.plannerProcess || this.editorProcess || this.reviewerProcess)
  }
  
  private async startPlannerProcess(worktreePath: string, plannerPrompt: string) {
    if (!plannerPrompt || !plannerPrompt.trim()) {
      throw new Error('Planner prompt cannot be empty')
    }
    
    try {
      // Create output files for file-based I/O
      const { paths } = await this.createOutputStreams('planner')
      
      // Write prompt to stdin file
      await fsPromises.writeFile(paths.stdin, plannerPrompt)
      
      const nodeExecutable = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/bin/node')
      const claudePath = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/lib/node_modules/@anthropic-ai/claude-code/cli.js')
      
      console.log('Starting planner process with file-based I/O')
      console.log('Output paths:', paths)
      
      const args = [
        '--no-warnings',
        '--enable-source-maps',
        claudePath,
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--dangerously-skip-permissions'
      ]
      
      // Escape paths for shell safety
      const escapePath = (p: string) => {
        return "'" + p.replace(/'/g, "'\"'\"'") + "'"
      }
      
      // Use shell to handle redirection
      const exitCodePath = paths.stdout.replace('.stdout.log', '.exitcode')
      const innerCommand = `${nodeExecutable} ${args.join(' ')} < ${escapePath(paths.stdin)} > ${escapePath(paths.stdout)} 2> ${escapePath(paths.stderr)}`
      const shellCommand = `sh -c '${innerCommand}; echo $? > ${escapePath(exitCodePath)}'`
      
      console.log('Shell command:', shellCommand)
      
      // Use shell with nohup for true detachment
      this.plannerProcess = spawn('sh', ['-c', `setsid nohup ${shellCommand}`], {
        cwd: worktreePath,
        stdio: 'ignore',
        detached: true
      })

      if (!this.plannerProcess.pid) {
        throw new Error('Failed to start planner process')
      }
      
      console.log('Planner process started with PID:', this.plannerProcess.pid)
      
      // Unref the process so it doesn't keep the parent alive
      this.plannerProcess.unref()
      
      // Register process in state manager
      await processStateManager.registerProcess({
        pid: this.plannerProcess.pid,
        taskId: this.taskId,
        phase: 'planner',
        startTime: Date.now(),
        worktreePath: worktreePath,
        prompt: plannerPrompt,
        outputPaths: paths,
        shellCommand: shellCommand
      })
      
      // Start tailing output files
      this.tailFile(paths.stdout, 'planner')
      this.tailFile(paths.stderr, 'planner', true)
      
      this.emit('plannerPid', this.plannerProcess.pid)
      this.setupPlannerHandlers()
      
      // Add cleanup callback for plan file
      if (this.planFilePath) {
        this.cleanupCallbacks.push(() => {
          if (this.planFilePath && fs.existsSync(this.planFilePath)) {
            try {
              fs.unlinkSync(this.planFilePath)
              console.log('Cleaned up plan file:', this.planFilePath)
            } catch (error) {
              console.error('Failed to clean up plan file:', error)
            }
          }
        })
      }
    } catch (error) {
      console.error('Error starting planner:', error)
      this.emit('status', 'failed')
      throw error
    }
  }

  private setupPlannerHandlers() {
    if (!this.plannerProcess) return
    
    // Emit in_progress status when planner starts processing
    this.emit('status', 'in_progress')
    
    // File tailing is already set up in startPlannerProcess
    // We only need to handle process exit

    this.plannerProcess.on('exit', async (code, signal) => {
      console.log('Planner process exited with code:', code)
      
      if (code === 0 && this.currentPhase === 'planner') {
        // Planner completed successfully, start editor phase
        this.emit('output', {
          type: 'planner',
          content: `✓ Planning phase completed`,
          timestamp: new Date()
        })
        
        // Transition to editor phase
        this.currentPhase = 'editor'
        this.emit('phase', 'editor')
        
        // Clean up planner process
        this.plannerProcess = null
        
        // Start editor process with the plan
        try {
          await this.startEditorWithPlan()
        } catch (error) {
          console.error('Error starting editor after planner:', error)
          this.emit('output', {
            type: 'planner',
            content: `❌ Failed to start editor: ${error}`,
            timestamp: new Date()
          })
          this.emit('status', 'failed')
        }
      } else if (code !== 0 && !this.isShuttingDown) {
        this.emit('output', {
          type: 'planner',
          content: `❌ Planning failed (exit code: ${code})`,
          timestamp: new Date()
        })
        this.emit('status', 'failed')
      }
    })
  }

  private async startEditorWithPlan() {
    if (!this.editorPrompt || !this.editorPrompt.trim()) {
      throw new Error('Editor prompt cannot be empty')
    }
    
    // Ensure planner process is cleaned up
    if (this.plannerProcess) {
      this.plannerProcess = null
    }
    
    try {
      // Create output files for file-based I/O
      const { paths } = await this.createOutputStreams('editor')
      
      // Write prompt to stdin file
      await fsPromises.writeFile(paths.stdin, this.editorPrompt)
      
      const nodeExecutable = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/bin/node')
      const claudePath = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/lib/node_modules/@anthropic-ai/claude-code/cli.js')
      
      console.log('Starting editor process with file-based I/O after planning')
      console.log('Output paths:', paths)
      
      const args = [
        '--no-warnings',
        '--enable-source-maps',
        claudePath,
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--dangerously-skip-permissions'
      ]
      
      // Escape paths for shell safety
      const escapePath = (p: string) => {
        return "'" + p.replace(/'/g, "'\"'\"'") + "'"
      }
      
      // Use shell to handle redirection
      const exitCodePath = paths.stdout.replace('.stdout.log', '.exitcode')
      const innerCommand = `${nodeExecutable} ${args.join(' ')} < ${escapePath(paths.stdin)} > ${escapePath(paths.stdout)} 2> ${escapePath(paths.stderr)}`
      const shellCommand = `sh -c '${innerCommand}; echo $? > ${escapePath(exitCodePath)}'`
      
      // Use shell with nohup for true detachment
      this.editorProcess = spawn('sh', ['-c', `setsid nohup ${shellCommand}`], {
        cwd: this.worktreePath,
        stdio: 'ignore',
        detached: true
      })

      if (!this.editorProcess.pid) {
        throw new Error('Failed to start editor process')
      }
      
      console.log('Editor process started with PID:', this.editorProcess.pid)
      
      // Unref the process so it doesn't keep the parent alive
      this.editorProcess.unref()
      
      // Register process in state manager
      await processStateManager.registerProcess({
        pid: this.editorProcess.pid,
        taskId: this.taskId,
        phase: 'editor',
        startTime: Date.now(),
        worktreePath: this.worktreePath,
        prompt: this.editorPrompt,
        outputPaths: paths,
        shellCommand: shellCommand
      })
      
      // Start tailing output files
      this.tailFile(paths.stdout, 'editor')
      this.tailFile(paths.stderr, 'editor', true)
      
      this.emit('editorPid', this.editorProcess.pid)
      this.setupEditorHandlers()
      
      // Continue with sequential execution
      this.startSequentialExecution(this.worktreePath, this.reviewerPrompt, this.thinkMode)
    } catch (error) {
      console.error('Error starting editor after planner:', error)
      this.emit('output', {
        type: 'editor',
        content: `❌ Failed to start editor: ${error}`,
        timestamp: new Date()
      })
      this.emit('status', 'failed')
      // Clean up editor process
      if (this.editorProcess) {
        this.editorProcess.kill('SIGTERM')
        this.editorProcess = null
      }
    }
  }

  private getEnhancedPath(): string {
    const PATH = process.env.PATH || ''
    const pathComponents = [
      '/usr/local/bin',
      '/opt/homebrew/bin'
    ]
    
    // Add nvm node path if it exists
    const homeDir = os.homedir()
    const nvmPath = path.join(homeDir, '.nvm', 'versions', 'node')
    
    // Don't add user-specific paths, just common system paths
    pathComponents.push(PATH)
    return pathComponents.join(path.delimiter)
  }

  // Initiative-specific methods
  async runInitiativeExploration(initiative: Initiative): Promise<void> {
    console.log(`[ProcessManager] Starting initiative exploration for ${initiative.id}`)
    
    // Load and process exploration prompt template
    const promptTemplate = await this.loadPromptTemplate('exploration')
    const prompt = this.substituteVariables(promptTemplate, {
      objective: initiative.objective,
      outputDir: path.join(os.homedir(), '.claude-god-data', 'initiatives', initiative.id),
      initiativeId: initiative.id
    })
    
    // Set up process configuration
    this.currentPhase = 'planner' as any // Using planner phase for initiatives
    this.taskId = `initiative-${initiative.id}`
    this.worktreePath = initiative.repositoryPath || this.repoPath || process.cwd()
    
    // Configure timeout for exploration phase (60 minutes)
    const EXPLORATION_TIMEOUT = 3600000
    
    try {
      await this.startInitiativeProcess(prompt, 'exploration', EXPLORATION_TIMEOUT)
      console.log(`[ProcessManager] Initiative exploration started successfully`)
    } catch (error) {
      console.error(`[ProcessManager] Failed to start exploration:`, error)
      throw new Error(`Failed to start initiative exploration: ${error}`)
    }
  }

  async runInitiativeRefinement(initiative: Initiative): Promise<void> {
    console.log(`[ProcessManager] Starting initiative refinement for ${initiative.id}`)
    
    // Format user answers for the prompt
    const formattedAnswers = this.formatUserAnswers(initiative.userAnswers, initiative.questions)
    
    // Load and process refinement prompt template
    const promptTemplate = await this.loadPromptTemplate('refinement')
    const prompt = this.substituteVariables(promptTemplate, {
      objective: initiative.objective,
      outputDir: path.join(os.homedir(), '.claude-god-data', 'initiatives', initiative.id),
      userAnswers: formattedAnswers,
      initiativeId: initiative.id
    })
    
    // Set up process configuration
    this.currentPhase = 'planner' as any
    this.taskId = `initiative-${initiative.id}`
    this.worktreePath = initiative.repositoryPath || this.repoPath || process.cwd()
    
    // Configure timeout for refinement phase (45 minutes)
    const REFINEMENT_TIMEOUT = 2700000
    
    try {
      await this.startInitiativeProcess(prompt, 'refinement', REFINEMENT_TIMEOUT)
      console.log(`[ProcessManager] Initiative refinement started successfully`)
    } catch (error) {
      console.error(`[ProcessManager] Failed to start refinement:`, error)
      throw new Error(`Failed to start initiative refinement: ${error}`)
    }
  }

  async runInitiativePlanning(initiative: Initiative): Promise<void> {
    console.log(`[ProcessManager] Starting initiative planning for ${initiative.id}`)
    
    // Load and process planning prompt template
    const promptTemplate = await this.loadPromptTemplate('planning')
    const prompt = this.substituteVariables(promptTemplate, {
      objective: initiative.objective,
      outputDir: path.join(os.homedir(), '.claude-god-data', 'initiatives', initiative.id),
      researchResults: initiative.researchResults || 'No research results provided.',
      initiativeId: initiative.id
    })
    
    // Set up process configuration
    this.currentPhase = 'planner' as any
    this.taskId = `initiative-${initiative.id}`
    this.worktreePath = initiative.repositoryPath || this.repoPath || process.cwd()
    
    // Configure timeout for planning phase (90 minutes)
    const PLANNING_TIMEOUT = 5400000
    
    try {
      await this.startInitiativeProcess(prompt, 'planning', PLANNING_TIMEOUT)
      console.log(`[ProcessManager] Initiative planning started successfully`)
    } catch (error) {
      console.error(`[ProcessManager] Failed to start planning:`, error)
      throw new Error(`Failed to start initiative planning: ${error}`)
    }
  }

  private async loadPromptTemplate(templateName: string): Promise<string> {
    // Use embedded prompts instead of file system
    const template = PROMPTS[templateName as keyof typeof PROMPTS]
    if (!template) {
      console.error(`Failed to load prompt template ${templateName}: not found in PROMPTS`)
      throw new Error(`Prompt template not found: ${templateName}`)
    }
    return template
  }

  private substituteVariables(template: string, variables: Record<string, string>): string {
    let result = template
    
    // Handle conditional blocks first (e.g., {{#variable}}...{{/variable}})
    for (const [key, value] of Object.entries(variables)) {
      // Handle conditional blocks - show content if variable has a value
      const conditionalRegex = new RegExp(`{{#${key}}}([\\s\\S]*?){{/${key}}}`, 'g')
      result = result.replace(conditionalRegex, (match, content) => {
        return value && value.trim() ? content : ''
      })
    }
    
    // Then handle simple variable substitution
    for (const [key, value] of Object.entries(variables)) {
      // Escape special regex characters in the key
      const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`{{${escapedKey}}}`, 'g')
      result = result.replace(regex, value || '')
    }
    
    return result
  }

  private formatUserAnswers(answers: Record<string, string> | undefined, questions: any[] | undefined): string {
    if (!answers || !questions) {
      return 'No user answers provided.'
    }

    let formatted = '## User Answers\n\n'
    for (const question of questions) {
      const answer = answers[question.id]
      if (answer) {
        formatted += `**Q: ${question.question}**\nA: ${answer}\n\n`
      }
    }
    return formatted
  }

  private async startInitiativeProcess(prompt: string, phase: string, timeout: number): Promise<void> {
    try {
      // Create output files for file-based I/O
      const { paths } = await this.createOutputStreams('planner') // Use planner phase for initiatives
      
      // Write prompt to stdin file
      await fsPromises.writeFile(paths.stdin, prompt)
      
      const nodeExecutable = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/bin/node')
      const claudePath = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/lib/node_modules/@anthropic-ai/claude-code/cli.js')
      
      console.log(`[ProcessManager] Starting initiative ${phase} process with file-based I/O`)
      console.log(`[ProcessManager] Timeout: ${timeout}ms`)
      console.log('Output paths:', paths)
      
      // Update metadata
      this.initiativeMetadata = {
        initiativeId: this.taskId.replace('initiative-', ''),
        phase,
        startTime: new Date(),
        pid: undefined
      }
      
      const args = [
        '--no-warnings',
        '--enable-source-maps',
        claudePath,
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--dangerously-skip-permissions',
        '--think-mode',
        'planning' // Use planning mode for all initiative phases
      ]
      
      // Escape paths for shell safety
      const escapePath = (p: string) => {
        return "'" + p.replace(/'/g, "'\"'\"'") + "'"
      }
      
      // Use shell to handle redirection
      const exitCodePath = paths.stdout.replace('.stdout.log', '.exitcode')
      const innerCommand = `${nodeExecutable} ${args.join(' ')} < ${escapePath(paths.stdin)} > ${escapePath(paths.stdout)} 2> ${escapePath(paths.stderr)}`
      const shellCommand = `sh -c '${innerCommand}; echo $? > ${escapePath(exitCodePath)}'`
      
      console.log('Shell command:', shellCommand)
      
      // Use shell with nohup for true detachment
      const initiativeProcess = spawn('sh', ['-c', `setsid nohup ${shellCommand}`], {
        cwd: this.worktreePath,
        stdio: 'ignore',
        detached: true
      })

      if (!initiativeProcess.pid) {
        throw new Error(`Failed to start ${phase} process`)
      }
      
      // Update metadata with PID
      this.initiativeMetadata.pid = initiativeProcess.pid
      
      console.log(`[ProcessManager] Initiative ${phase} process started with PID:`, initiativeProcess.pid)
      
      // Unref the process so it doesn't keep the parent alive
      initiativeProcess.unref()
      
      // Register process in state manager
      await processStateManager.registerProcess({
        pid: initiativeProcess.pid,
        taskId: this.taskId,
        phase: 'planner',
        startTime: Date.now(),
        worktreePath: this.worktreePath,
        prompt: prompt,
        outputPaths: paths,
        shellCommand: shellCommand
      })
      
      // Start tailing output files
      this.tailFile(paths.stdout, 'planner')
      this.tailFile(paths.stderr, 'planner', true)
      
      // Emit process started event with metadata
      this.emit('initiative-process-started', {
        ...this.initiativeMetadata,
        timeout
      })
      
      // Set up output handlers specific to initiative phases
      this.setupInitiativeHandlers(initiativeProcess, phase)
      
      // Set up timeout handler
      const timeoutHandler = setTimeout(() => {
        console.warn(`[ProcessManager] Initiative ${phase} process timed out`)
        initiativeProcess.kill('SIGTERM')
        this.emit('initiative-error', {
          phase,
          error: `Process timed out after ${timeout / 1000 / 60} minutes`
        })
      }, timeout)
      
      // Clean up timeout on process exit
      initiativeProcess.once('exit', () => {
        clearTimeout(timeoutHandler)
      })
      
      // Clean up any existing process before storing new one
      if (this.plannerProcess) {
        console.warn(`[ProcessManager] Cleaning up existing ${this.initiativeMetadata.phase} process before starting ${phase}`)
        try {
          this.plannerProcess.kill('SIGTERM')
        } catch (e) {
          // Process might already be dead
        }
      }
      
      // Store process reference for cleanup
      this.plannerProcess = initiativeProcess
    } catch (error) {
      console.error(`[ProcessManager] Failed to start initiative ${phase} process:`, error)
      throw error
    }
  }

  private setupInitiativeHandlers(process: ChildProcess, phase: string) {
    if (!process) return
    
    // File tailing is already set up in startInitiativeProcess
    // Track if we have errors for exit handling
    let hasError = false
    
    process.on('exit', (code, signal) => {
      console.log(`[ProcessManager] Initiative ${phase} process exited with code:`, code)
      
      if (code === 0) {
        this.emit('initiative-phase-complete', {
          phase,
          success: true
        })
      } else {
        // Provide detailed error messages based on phase and exit code
        let errorMsg = ''
        
        if (signal === 'SIGTERM') {
          errorMsg = `Initiative ${phase} process was terminated (timeout or manual stop)`
        } else if (code === 143) {
          errorMsg = `Initiative ${phase} process exceeded time limit`
        } else if (hasError) {
          errorMsg = `Initiative ${phase} process encountered errors during execution`
        } else {
          // Phase-specific error messages
          switch (phase) {
            case 'exploration':
              errorMsg = `Failed to complete exploration phase. Claude Code may have encountered issues understanding the objective or accessing the codebase.`
              break
            case 'refinement':
              errorMsg = `Failed to complete refinement phase. There may have been issues processing the user answers or generating research needs.`
              break
            case 'planning':
              errorMsg = `Failed to complete planning phase. Task generation may have failed due to complexity or missing context.`
              break
            default:
              errorMsg = `Initiative ${phase} process failed with exit code ${code}`
          }
        }
        
        this.emit('initiative-error', {
          phase,
          error: errorMsg,
          exitCode: code,
          signal: signal
        })
      }
      
      // Clean up process reference
      if (this.plannerProcess === process) {
        this.plannerProcess = null
        // Clear metadata on exit
        this.initiativeMetadata = {}
      }
    })
    
    process.on('error', (error) => {
      console.error(`[ProcessManager] Initiative ${phase} process error:`, error)
      hasError = true
      
      // Provide user-friendly error messages
      let userError = error.message
      if (error.message.includes('ENOENT')) {
        userError = 'Claude Code executable not found. Please ensure Claude Code is installed correctly.'
      } else if (error.message.includes('EACCES')) {
        userError = 'Permission denied when trying to run Claude Code. Check file permissions.'
      } else if (error.message.includes('ENOMEM')) {
        userError = 'Insufficient memory to start Claude Code process.'
      }
      
      this.emit('initiative-error', {
        phase,
        error: userError,
        originalError: error.message
      })
    })
  }

  // Clean up initiative process on failure or cancellation
  stopInitiativeProcess(): void {
    console.log(`[ProcessManager] Stopping initiative process`)
    
    if (this.plannerProcess) {
      const pid = this.plannerProcess.pid
      const phase = this.initiativeMetadata.phase
      
      try {
        // Send SIGTERM for graceful shutdown
        this.plannerProcess.kill('SIGTERM')
        
        // Give it a moment to clean up
        setTimeout(() => {
          if (this.plannerProcess && this.plannerProcess.pid === pid) {
            console.warn(`[ProcessManager] Force killing initiative process ${pid}`)
            try {
              this.plannerProcess.kill('SIGKILL')
            } catch (e) {
              // Process may already be dead
            }
          }
        }, 5000)
        
        // Emit cleanup event
        this.emit('initiative-process-stopped', {
          ...this.initiativeMetadata,
          reason: 'manual_stop'
        })
      } catch (error) {
        console.error(`[ProcessManager] Error stopping initiative process:`, error)
      }
      
      // Clear process reference
      this.plannerProcess = null
    }
    
    // Clear metadata
    this.initiativeMetadata = {}
  }

  // Get current initiative process status
  getInitiativeProcessStatus(): {
    running: boolean,
    phase?: string,
    pid?: number,
    startTime?: Date
  } {
    return {
      running: !!this.plannerProcess,
      phase: this.initiativeMetadata.phase,
      pid: this.initiativeMetadata.pid,
      startTime: this.initiativeMetadata.startTime
    }
  }
}