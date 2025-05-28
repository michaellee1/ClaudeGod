import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { promises as fsPromises } from 'fs'
import { Initiative } from '../types/initiative'

export interface ProcessOutput {
  type: 'planner' | 'editor' | 'reviewer'
  content: string
  timestamp: Date
}

export class ProcessManager extends EventEmitter {
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

  constructor(taskId?: string, worktreePath?: string, repoPath?: string) {
    super()
    this.taskId = taskId || ''
    this.worktreePath = worktreePath || ''
    this.repoPath = repoPath || ''
  }

  // Method to reconnect to existing processes after restart
  async reconnectToProcesses(pids: { editorPid?: number, reviewerPid?: number, plannerPid?: number }, phase: string) {
    this.currentPhase = phase as any
    
    // Since we can't reconnect to existing process streams, 
    // we'll at least track that the processes are running
    console.log(`ProcessManager reconnected for task ${this.taskId}:`, {
      editorPid: pids.editorPid,
      reviewerPid: pids.reviewerPid,
      plannerPid: pids.plannerPid,
      phase: phase
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
          // Editor finished but no reviewer started - task might be in no_review mode
          this.currentPhase = 'finished'
          this.emit('status', 'finished')
          this.emit('phase', 'done')
          this.emit('completed', true)
        }
      }
    }, 5000) // Check every 5 seconds
  }

  async startProcesses(
    worktreePath: string,
    prompt: string,
    taskId: string,
    thinkMode?: string
  ): Promise<{ editorPid: number, reviewerPid: number }> {
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
        return {
          editorPid: this.plannerProcess?.pid || 0,
          reviewerPid: 0
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
      // Create a wrapper command that ensures ReadableStream is available
      const nodeExecutable = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/bin/node')
      const claudePath = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/lib/node_modules/@anthropic-ai/claude-code/cli.js')
      
      console.log('Starting editor process with Node executable:', nodeExecutable)
      console.log('Claude CLI path:', claudePath)
      console.log('Arguments:', ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'])
      console.log('Working directory:', worktreePath)
      
      // Use node directly with the CLI script and required flags
      this.editorProcess = spawn(nodeExecutable, [
        '--no-warnings',
        '--enable-source-maps',
        claudePath,
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--dangerously-skip-permissions'
      ], {
        cwd: worktreePath,
        env: { 
          ...process.env, 
          PATH: this.getEnhancedPath(),
          FORCE_COLOR: '0',
          NO_COLOR: '1'
        },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      if (!this.editorProcess.pid) {
        throw new Error('Failed to start editor process')
      }
      
      console.log('Editor process started with PID:', this.editorProcess.pid)

      this.setupEditorHandlers()
      
      // Send prompt via stdin
      if (this.editorProcess.stdin) {
        console.log('Writing prompt to editor stdin, length:', editorPrompt.length)
        this.editorProcess.stdin.write(editorPrompt + '\n')
        this.editorProcess.stdin.end()
        console.log('Editor stdin closed')
      } else {
        console.error('Editor process stdin is not available')
      }
      
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
      
      if (this.editorProcess.stdout) {
        console.log('Editor stdout is available')
        this.editorProcess.stdout.setEncoding('utf8')
        this.editorProcess.stdout.on('data', (data) => {
          console.log('Editor stdout data received:', data.substring(0, 100))
          this.lastOutputTime = Date.now()
          const content = data.toString()
          this.outputBuffer += content
          
          // Try to parse stream-json format
          const lines = content.trim().split('\n')
          const processedLines = new Set<string>()
          
          for (const line of lines) {
            if (line.trim()) {
              let isJsonLine = false
              try {
                const parsed = JSON.parse(line)
                isJsonLine = true
                processedLines.add(line)
                
                // Handle different message types
                if (parsed.type === 'assistant' && parsed.message?.content) {
                  // Extract text from assistant messages
                  for (const content of parsed.message.content) {
                    if (content.type === 'text') {
                      this.emit('output', {
                        type: 'editor',
                        content: content.text,
                        timestamp: new Date()
                      })
                    }
                  }
                } else if (parsed.type === 'tool_use') {
                  // Log detailed tool usage
                  let toolInfo = `[Tool: ${parsed.name}]`
                  
                  // Add tool-specific details
                  if (parsed.input) {
                    switch (parsed.name) {
                      case 'Read':
                        if (parsed.input.file_path) {
                          toolInfo = `📖 Reading: ${parsed.input.file_path}`
                          if (parsed.input.offset || parsed.input.limit) {
                            toolInfo += ` (lines ${parsed.input.offset || 0}-${(parsed.input.offset || 0) + (parsed.input.limit || 'end')})`
                          }
                        }
                        break
                      case 'Edit':
                        if (parsed.input.file_path) {
                          toolInfo = `✏️ Editing: ${parsed.input.file_path}`
                        }
                        break
                      case 'MultiEdit':
                        if (parsed.input.file_path && parsed.input.edits) {
                          toolInfo = `✏️ Multi-edit: ${parsed.input.file_path} (${parsed.input.edits.length} changes)`
                        }
                        break
                      case 'Write':
                        if (parsed.input.file_path) {
                          toolInfo = `💾 Writing: ${parsed.input.file_path}`
                        }
                        break
                      case 'Grep':
                        if (parsed.input.pattern) {
                          toolInfo = `🔍 Searching: "${parsed.input.pattern}"`
                          if (parsed.input.path) {
                            toolInfo += ` in ${parsed.input.path}`
                          }
                          if (parsed.input.include) {
                            toolInfo += ` (${parsed.input.include})`
                          }
                        }
                        break
                      case 'Glob':
                        if (parsed.input.pattern) {
                          toolInfo = `📁 Finding: ${parsed.input.pattern}`
                          if (parsed.input.path) {
                            toolInfo += ` in ${parsed.input.path}`
                          }
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
                    }
                  }
                  
                  this.emit('output', {
                    type: 'editor',
                    content: toolInfo,
                    timestamp: new Date()
                  })
                } else if (parsed.type === 'system' && parsed.subtype === 'init') {
                  // Log initialization
                  this.emit('output', {
                    type: 'editor',
                    content: `🚀 Started`,
                    timestamp: new Date()
                  })
                } else if (parsed.type === 'tool_result') {
                  // Handle tool results - these often contain file contents
                  if (parsed.content && typeof parsed.content === 'string') {
                    // Check if it's file content (has line numbers)
                    if (parsed.content.includes('\n') && /^\s*\d+\s+/.test(parsed.content)) {
                      this.emit('output', {
                        type: 'editor',
                        content: parsed.content,
                        timestamp: new Date()
                      })
                    }
                  }
                } else if (parsed.type === 'user' && parsed.message) {
                  // Skip user messages - these are usually just echoing the prompt
                  // Don't emit these
                }
              } catch (e) {
                // Not JSON - continue to check if it should be emitted
              }
              
              // Emit non-JSON lines that aren't raw JSON strings
              if (!isJsonLine && !processedLines.has(line) && !line.includes('{"type":')) {
                this.emit('output', {
                  type: 'editor',
                  content: line,
                  timestamp: new Date()
                })
                processedLines.add(line)
              }
            }
          }
          
          // Check for completion patterns
          this.checkForCompletion()
        })
      } else {
        console.log('Editor stdout is NOT available')
      }

      if (this.editorProcess.stderr) {
        console.log('Editor stderr is available')
        this.editorProcess.stderr.setEncoding('utf8')
        this.editorProcess.stderr.on('data', (data) => {
          console.log('Editor stderr data received:', data.substring(0, 100))
          this.lastOutputTime = Date.now()
          this.emit('output', {
            type: 'editor',
            content: data,
            timestamp: new Date()
          })
        })
      } else {
        console.log('Editor stderr is NOT available')
      }

      this.editorProcess.on('error', (error) => {
        console.log('Editor process error:', error)
        this.emit('output', {
          type: 'editor',
          content: `❌ Error: ${error.message}`,
          timestamp: new Date()
        })
        this.emit('status', 'failed')
      })
      
      this.editorProcess.on('exit', (code, signal) => {
        console.log('Editor process exited with code:', code, 'signal:', signal)
        this.processExitCode = code
        
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
      
      if (this.reviewerProcess.stdout) {
        console.log('Reviewer stdout is available')
        this.reviewerProcess.stdout.setEncoding('utf8')
        this.reviewerProcess.stdout.on('data', (data) => {
          console.log('Reviewer stdout data received:', data.substring(0, 100))
          this.lastOutputTime = Date.now()
          const content = data.toString()
          this.outputBuffer += content
          
          // Try to parse stream-json format
          const lines = content.trim().split('\n')
          const processedLines = new Set<string>()
          
          for (const line of lines) {
            if (line.trim()) {
              let isJsonLine = false
              try {
                const parsed = JSON.parse(line)
                isJsonLine = true
                processedLines.add(line)
                
                // Handle different message types
                if (parsed.type === 'assistant' && parsed.message?.content) {
                  // Extract text from assistant messages
                  for (const content of parsed.message.content) {
                    if (content.type === 'text') {
                      this.emit('output', {
                        type: 'reviewer',
                        content: content.text,
                        timestamp: new Date()
                      })
                    }
                  }
                } else if (parsed.type === 'tool_use' && parsed.name) {
                  // Log tool usage with details
                  const toolName = parsed.name
                  let toolInfo = `[Tool: ${toolName}]`
                  
                  // Add specific details based on tool type
                  switch (toolName) {
                    case 'Read':
                      if (parsed.input.file_path) {
                        toolInfo = `📖 Reading: ${parsed.input.file_path}`
                        if (parsed.input.offset || parsed.input.limit) {
                          toolInfo += ` (lines ${parsed.input.offset || 0}-${(parsed.input.offset || 0) + (parsed.input.limit || 'end')})`
                        }
                      }
                      break
                    case 'Edit':
                      if (parsed.input.file_path) {
                        toolInfo = `✏️ Editing: ${parsed.input.file_path}`
                      }
                      break
                    case 'MultiEdit':
                      if (parsed.input.file_path && parsed.input.edits) {
                        toolInfo = `✏️ Multi-edit: ${parsed.input.file_path} (${parsed.input.edits.length} changes)`
                      }
                      break
                    case 'Write':
                      if (parsed.input.file_path) {
                        toolInfo = `💾 Writing: ${parsed.input.file_path}`
                      }
                      break
                    case 'Grep':
                      if (parsed.input.pattern) {
                        toolInfo = `🔍 Searching: "${parsed.input.pattern}"`
                        if (parsed.input.path) {
                          toolInfo += ` in ${parsed.input.path}`
                        }
                        if (parsed.input.include) {
                          toolInfo += ` (${parsed.input.include})`
                        }
                      }
                      break
                    case 'Glob':
                      if (parsed.input.pattern) {
                        toolInfo = `📁 Finding: ${parsed.input.pattern}`
                        if (parsed.input.path) {
                          toolInfo += ` in ${parsed.input.path}`
                        }
                      }
                      break
                    case 'Bash':
                      if (parsed.input.command) {
                        const cmdPreview = parsed.input.command.substring(0, 100)
                        toolInfo = `🖥️ Running: ${cmdPreview}${parsed.input.command.length > 100 ? '...' : ''}`
                      }
                      break
                    case 'LS':
                      if (parsed.input.path) {
                        toolInfo = `📂 Listing: ${parsed.input.path}`
                      }
                      break
                  }
                  
                  this.emit('output', {
                    type: 'reviewer',
                    content: toolInfo,
                    timestamp: new Date()
                  })
                } else if (parsed.type === 'system' && parsed.subtype === 'init') {
                  // Log initialization
                  this.emit('output', {
                    type: 'reviewer',
                    content: `🚀 Started`,
                    timestamp: new Date()
                  })
                } else if (parsed.type === 'tool_result') {
                  // Handle tool results - these often contain file contents
                  if (parsed.content && typeof parsed.content === 'string') {
                    // Check if it's file content (has line numbers)
                    if (parsed.content.includes('\n') && /^\s*\d+\s+/.test(parsed.content)) {
                      this.emit('output', {
                        type: 'reviewer',
                        content: parsed.content,
                        timestamp: new Date()
                      })
                    }
                  }
                } else if (parsed.type === 'user' && parsed.message) {
                  // Skip user messages - these are usually just echoing the prompt
                  // Don't emit these
                }
              } catch (e) {
                // Not JSON - continue to check if it should be emitted
              }
              
              // Emit non-JSON lines that aren't raw JSON strings
              if (!isJsonLine && !processedLines.has(line) && !line.includes('{"type":')) {
                this.emit('output', {
                  type: 'reviewer',
                  content: line,
                  timestamp: new Date()
                })
                processedLines.add(line)
              }
            }
          }
          
          // Check for completion patterns
          this.checkForCompletion()
        })
      } else {
        console.log('Reviewer stdout is NOT available')
      }

      if (this.reviewerProcess.stderr) {
        console.log('Reviewer stderr is available')
        this.reviewerProcess.stderr.setEncoding('utf8')
        this.reviewerProcess.stderr.on('data', (data) => {
          console.log('Reviewer stderr data received:', data.substring(0, 100))
          this.lastOutputTime = Date.now()
          this.emit('output', {
            type: 'reviewer',
            content: data,
            timestamp: new Date()
          })
        })
      } else {
        console.log('Reviewer stderr is NOT available')
      }

      this.reviewerProcess.on('error', (error) => {
        console.log('Reviewer process error:', error)
        this.emit('output', {
          type: 'reviewer',
          content: `❌ Error: ${error.message}`,
          timestamp: new Date()
        })
        this.emit('status', 'failed')
      })
      
      this.reviewerProcess.on('exit', (code, signal) => {
        console.log('Reviewer process exited with code:', code, 'signal:', signal)
        this.processExitCode = code
        
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
      console.log('Skipping reviewer phase due to no_review mode')
      this.currentPhase = 'finished'
      this.emit('status', 'finished')
      this.emit('phase', 'done')
      this.emit('completed', true) // Pass true to indicate successful completion
      return
    }
    
    // Phase 2: Start and monitor reviewer
    this.currentPhase = 'reviewer'
    this.emit('phase', 'reviewer')
    
    try {
      // Now start the reviewer process
      const nodeExecutable = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/bin/node')
      const claudePath = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/lib/node_modules/@anthropic-ai/claude-code/cli.js')
      
      console.log('Starting reviewer process with Node executable:', nodeExecutable)
      console.log('Claude CLI path:', claudePath)
      console.log('Arguments:', ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'])
      console.log('Working directory:', worktreePath)
        
      // Use node directly with the CLI script and required flags
      this.reviewerProcess = spawn(nodeExecutable, [
        '--no-warnings',
        '--enable-source-maps',
        claudePath,
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--dangerously-skip-permissions'
      ], {
        cwd: worktreePath,
        env: { 
          ...process.env, 
          PATH: this.getEnhancedPath(),
          FORCE_COLOR: '0',
          NO_COLOR: '1'
        },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      if (!this.reviewerProcess.pid) {
        throw new Error('Failed to start reviewer process')
      }
      
      console.log('Reviewer process started with PID:', this.reviewerProcess.pid)

      this.emit('reviewerPid', this.reviewerProcess.pid)
      this.setupReviewerHandlers()
      
      // Send prompt via stdin
      if (this.reviewerProcess.stdin) {
        this.reviewerProcess.stdin.write(reviewerPrompt + '\n')
        this.reviewerProcess.stdin.end()
      } else {
        console.error('Reviewer process stdin is not available')
      }
      
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
        
        // Send SIGTERM for graceful shutdown
        process.kill('SIGTERM')
        
        // Wait up to 5 seconds for graceful exit
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            console.warn(`${name} did not exit gracefully, sending SIGKILL`)
            try {
              process.kill('SIGKILL')
            } catch (e) {
              // Process may already be dead
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
      const nodeExecutable = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/bin/node')
      const claudePath = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/lib/node_modules/@anthropic-ai/claude-code/cli.js')
      
      console.log('Starting planner process')
      
      this.plannerProcess = spawn(nodeExecutable, [
        '--no-warnings',
        '--enable-source-maps',
        claudePath,
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--dangerously-skip-permissions'
      ], {
        cwd: worktreePath,
        env: { 
          ...process.env, 
          PATH: this.getEnhancedPath(),
          FORCE_COLOR: '0',
          NO_COLOR: '1'
        },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      if (!this.plannerProcess.pid) {
        throw new Error('Failed to start planner process')
      }
      
      console.log('Planner process started with PID:', this.plannerProcess.pid)
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
      
      // Send prompt via stdin
      if (this.plannerProcess.stdin) {
        this.plannerProcess.stdin.write(plannerPrompt + '\n')
        this.plannerProcess.stdin.end()
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
    
    if (this.plannerProcess.stdout) {
      this.plannerProcess.stdout.setEncoding('utf8')
      this.plannerProcess.stdout.on('data', (data) => {
        this.lastOutputTime = Date.now()
        const content = data.toString()
        this.outputBuffer += content
        
        // Process stream-json format similar to editor
        const lines = content.split('\n')
        const processedLines = new Set<string>()
        
        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine || processedLines.has(line)) continue
          
          let isJsonLine = false
          if (trimmedLine.startsWith('{') && trimmedLine.includes('"type":')) {
            try {
              const parsed = JSON.parse(trimmedLine)
              isJsonLine = true
              
              if (parsed.type === 'tool_use' && parsed.name) {
                let toolInfo = `⚡ Using tool: ${parsed.name}`
                if (parsed.input) {
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
                    case 'Bash':
                      if (parsed.input.command) {
                        const cmd = parsed.input.command.substring(0, 80)
                        toolInfo = `🖥️ Running: ${cmd}${parsed.input.command.length > 80 ? '...' : ''}`
                      }
                      break
                  }
                }
                
                this.emit('output', {
                  type: 'planner',
                  content: toolInfo,
                  timestamp: new Date()
                })
              } else if (parsed.type === 'content' && parsed.content) {
                this.emit('output', {
                  type: 'planner',
                  content: parsed.content,
                  timestamp: new Date()
                })
              }
            } catch (e) {
              // Not JSON
            }
          }
          
          if (!isJsonLine && !processedLines.has(line) && !line.includes('{"type":')) {
            this.emit('output', {
              type: 'planner',
              content: line,
              timestamp: new Date()
            })
            processedLines.add(line)
          }
        }
      })
    }

    if (this.plannerProcess.stderr) {
      this.plannerProcess.stderr.setEncoding('utf8')
      this.plannerProcess.stderr.on('data', (data) => {
        this.emit('output', {
          type: 'planner',
          content: data,
          timestamp: new Date()
        })
      })
    }

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
    
    // Start editor process with the stored prompt
    const nodeExecutable = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/bin/node')
    const claudePath = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/lib/node_modules/@anthropic-ai/claude-code/cli.js')
    
    this.editorProcess = spawn(nodeExecutable, [
      '--no-warnings',
      '--enable-source-maps',
      claudePath,
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions'
    ], {
      cwd: this.worktreePath,
      env: { 
        ...process.env, 
        PATH: this.getEnhancedPath(),
        FORCE_COLOR: '0',
        NO_COLOR: '1'
      },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    if (!this.editorProcess.pid) {
      throw new Error('Failed to start editor process')
    }
    
    console.log('Editor process started with PID:', this.editorProcess.pid)
    this.emit('editorPid', this.editorProcess.pid)
    this.setupEditorHandlers()
    
    // Send prompt via stdin
    if (this.editorProcess.stdin) {
      this.editorProcess.stdin.write(this.editorPrompt + '\n')
      this.editorProcess.stdin.end()
    }
    
    // Continue with sequential execution
    try {
      this.startSequentialExecution(this.worktreePath, this.reviewerPrompt, this.thinkMode)
    } catch (error) {
      console.error('Error starting sequential execution:', error)
      this.emit('output', {
        type: 'editor',
        content: `❌ Failed to start reviewer: ${error}`,
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
    this.worktreePath = this.repoPath || process.cwd()
    
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
    this.worktreePath = this.repoPath || process.cwd()
    
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
    this.worktreePath = this.repoPath || process.cwd()
    
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
    const templatePath = path.join(__dirname, '..', 'prompts', 'initiative', `${templateName}.md`)
    try {
      const template = await fsPromises.readFile(templatePath, 'utf-8')
      return template
    } catch (error) {
      console.error(`Failed to load prompt template ${templateName}:`, error)
      throw new Error(`Prompt template not found: ${templateName}`)
    }
  }

  private substituteVariables(template: string, variables: Record<string, string>): string {
    let result = template
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g')
      result = result.replace(regex, value)
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
    const nodeExecutable = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/bin/node')
    const claudePath = path.join(os.homedir(), '.nvm/versions/node/v22.14.0/lib/node_modules/@anthropic-ai/claude-code/cli.js')
    
    console.log(`[ProcessManager] Starting initiative ${phase} process`)
    console.log(`[ProcessManager] Timeout: ${timeout}ms`)
    
    // Update metadata
    this.initiativeMetadata = {
      initiativeId: this.taskId.replace('initiative-', ''),
      phase,
      startTime: new Date(),
      pid: undefined
    }
    
    // Create process with stream-json output
    const initiativeProcess = spawn(nodeExecutable, [
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
    ], {
      cwd: this.worktreePath,
      env: { 
        ...process.env, 
        PATH: this.getEnhancedPath(),
        FORCE_COLOR: '0',
        NO_COLOR: '1'
      },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    if (!initiativeProcess.pid) {
      throw new Error(`Failed to start ${phase} process`)
    }
    
    // Update metadata with PID
    this.initiativeMetadata.pid = initiativeProcess.pid
    
    console.log(`[ProcessManager] Initiative ${phase} process started with PID:`, initiativeProcess.pid)
    
    // Emit process started event with metadata
    this.emit('initiative-process-started', {
      ...this.initiativeMetadata,
      timeout
    })
    
    // Set up output handlers specific to initiative phases
    this.setupInitiativeHandlers(initiativeProcess, phase)
    
    // Send prompt via stdin
    if (initiativeProcess.stdin) {
      initiativeProcess.stdin.write(prompt + '\n')
      initiativeProcess.stdin.end()
    }
    
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
    
    // Store process reference for cleanup
    this.plannerProcess = initiativeProcess
  }

  private setupInitiativeHandlers(process: ChildProcess, phase: string) {
    if (!process) return
    
    // Track output for phase completion detection
    let outputBuffer = ''
    let hasError = false
    
    if (process.stdout) {
      process.stdout.setEncoding('utf8')
      process.stdout.on('data', (data) => {
        this.lastOutputTime = Date.now()
        const content = data.toString()
        outputBuffer += content
        
        // Parse stream-json format
        const lines = content.split('\n')
        for (const line of lines.filter((l: string) => l.trim())) {
          try {
            const parsed = JSON.parse(line)
            
            // Handle different message types
            if (parsed.type === 'assistant' && parsed.message?.content) {
              for (const content of parsed.message.content) {
                if (content.type === 'text') {
                  this.emit('initiative-output', {
                    phase,
                    content: content.text,
                    timestamp: new Date()
                  })
                }
              }
            } else if (parsed.type === 'tool_use') {
              // Enhanced tool output for initiatives
              let toolInfo = `⚡ Using tool: ${parsed.name}`
              
              if (parsed.input) {
                switch (parsed.name) {
                  case 'Read':
                    if (parsed.input.file_path) {
                      toolInfo = `📖 Reading: ${parsed.input.file_path}`
                    }
                    break
                  case 'Write':
                    if (parsed.input.file_path) {
                      toolInfo = `💾 Writing: ${parsed.input.file_path}`
                      // Check if this is writing one of our expected output files
                      if (phase === 'exploration' && (
                        parsed.input.file_path.endsWith('intermediate-plan.md') ||
                        parsed.input.file_path.endsWith('questions.md')
                      )) {
                        this.emit('initiative-output', {
                          phase,
                          content: `✅ Created ${path.basename(parsed.input.file_path)}`,
                          timestamp: new Date()
                        })
                      } else if (phase === 'refinement' && parsed.input.file_path.endsWith('research-needs.md')) {
                        this.emit('initiative-output', {
                          phase,
                          content: `✅ Created research needs document`,
                          timestamp: new Date()
                        })
                      } else if (phase === 'planning' && parsed.input.file_path.endsWith('tasks.json')) {
                        this.emit('initiative-output', {
                          phase,
                          content: `✅ Created task breakdown`,
                          timestamp: new Date()
                        })
                      }
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
                }
              }
              
              this.emit('initiative-output', {
                phase,
                content: toolInfo,
                timestamp: new Date()
              })
            }
          } catch (e) {
            // Not JSON, emit as regular output
            if (line && !line.includes('{"type":')) {
              this.emit('initiative-output', {
                phase,
                content: line,
                timestamp: new Date()
              })
            }
          }
        }
      })
    }
    
    if (process.stderr) {
      process.stderr.setEncoding('utf8')
      process.stderr.on('data', (data) => {
        hasError = true
        this.emit('initiative-output', {
          phase,
          content: `[Error] ${data}`,
          timestamp: new Date()
        })
      })
    }
    
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