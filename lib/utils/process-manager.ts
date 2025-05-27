import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import os from 'os'
import path from 'path'

export interface ProcessOutput {
  type: 'editor' | 'reviewer'
  content: string
  timestamp: Date
}

export class ProcessManager extends EventEmitter {
  private editorProcess: ChildProcess | null = null
  private reviewerProcess: ChildProcess | null = null
  private currentPhase: 'starting' | 'editor' | 'reviewer' | 'finished' = 'starting'
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

  constructor(taskId?: string, worktreePath?: string, repoPath?: string) {
    super()
    this.taskId = taskId || ''
    this.worktreePath = worktreePath || ''
    this.repoPath = repoPath || ''
  }

  async startProcesses(
    worktreePath: string,
    prompt: string,
    taskId: string
  ): Promise<{ editorPid: number, reviewerPid: number }> {
    this.emit('status', 'starting')
    
    const editorPrompt = prompt
    const reviewerPrompt = `Another AI agent was asked to implement the following: "${prompt}"

Please review their implementation by:
1. First, run 'git diff' to see all changes made by the other agent
2. Carefully review each change to ensure it correctly implements the requirements
3. Check for any bugs, security issues, or code quality problems
4. Verify that only necessary changes were made (no extraneous modifications)
5. If you find any issues, fix them directly in the code
6. After making fixes, run the tests if applicable to ensure everything works

Start by running 'git diff' to see what was changed.`

    try {
      // Start editor process first
      // Use 'claude' command instead of 'claude-code'
      const claudeCommand = 'claude'
      
      console.log('Starting editor process with command:', claudeCommand)
      console.log('Arguments:', ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'])
      console.log('Working directory:', worktreePath)
      
      // Use print mode with stream-json output for real-time logs
      this.editorProcess = spawn(claudeCommand, ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'], {
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
      this.startSequentialExecution(worktreePath, reviewerPrompt)

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
                          toolInfo = `[Reading file: ${parsed.input.file_path}]`
                          if (parsed.input.offset || parsed.input.limit) {
                            toolInfo += ` (lines ${parsed.input.offset || 0}-${(parsed.input.offset || 0) + (parsed.input.limit || 'end')})`
                          }
                        }
                        break
                      case 'Edit':
                        if (parsed.input.file_path) {
                          toolInfo = `[Editing file: ${parsed.input.file_path}]`
                          if (parsed.input.old_string) {
                            const preview = parsed.input.old_string.substring(0, 50).replace(/\n/g, '\\n')
                            toolInfo += ` - replacing "${preview}${parsed.input.old_string.length > 50 ? '...' : ''}"`
                          }
                        }
                        break
                      case 'MultiEdit':
                        if (parsed.input.file_path && parsed.input.edits) {
                          toolInfo = `[Multi-editing file: ${parsed.input.file_path}] - ${parsed.input.edits.length} edits`
                        }
                        break
                      case 'Write':
                        if (parsed.input.file_path) {
                          toolInfo = `[Writing file: ${parsed.input.file_path}]`
                        }
                        break
                      case 'Grep':
                        if (parsed.input.pattern) {
                          toolInfo = `[Searching for: "${parsed.input.pattern}"]`
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
                          toolInfo = `[Finding files: ${parsed.input.pattern}]`
                          if (parsed.input.path) {
                            toolInfo += ` in ${parsed.input.path}`
                          }
                        }
                        break
                      case 'Bash':
                        if (parsed.input.command) {
                          const cmd = parsed.input.command.substring(0, 80)
                          toolInfo = `[Running: ${cmd}${parsed.input.command.length > 80 ? '...' : ''}]`
                        }
                        break
                      case 'LS':
                        if (parsed.input.path) {
                          toolInfo = `[Listing: ${parsed.input.path}]`
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
                    content: `[System: Initialized with tools: ${parsed.tools?.join(', ') || 'none'}]`,
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
          content: `PROCESS ERROR: ${error.message}`,
          timestamp: new Date()
        })
        this.emit('status', 'failed')
      })
      
      this.editorProcess.on('exit', (code, signal) => {
        console.log('Editor process exited with code:', code, 'signal:', signal)
        this.processExitCode = code
        
        let exitMessage: string
        if (code === 0) {
          exitMessage = `Process completed successfully (code: ${code})`
        } else if (code === 143 && !this.isShuttingDown) {
          exitMessage = `Process terminated (SIGTERM). This may be due to timeout or system resource limits.`
          this.emit('error', new Error(exitMessage))
        } else if (!this.isShuttingDown) {
          exitMessage = `Process exited unexpectedly (code: ${code}, signal: ${signal})`
        } else {
          exitMessage = `Process stopped (code: ${code})`
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
                        toolInfo = `[Reading file: ${parsed.input.file_path}]`
                        if (parsed.input.offset || parsed.input.limit) {
                          toolInfo += ` (lines ${parsed.input.offset || 0}-${(parsed.input.offset || 0) + (parsed.input.limit || 'end')})`
                        }
                      }
                      break
                    case 'Edit':
                      if (parsed.input.file_path) {
                        toolInfo = `[Editing file: ${parsed.input.file_path}]`
                        if (parsed.input.old_string && parsed.input.new_string) {
                          const oldPreview = parsed.input.old_string.substring(0, 50).replace(/\n/g, '\\n')
                          const newPreview = parsed.input.new_string.substring(0, 50).replace(/\n/g, '\\n')
                          toolInfo += ` (replacing "${oldPreview}${parsed.input.old_string.length > 50 ? '...' : ''}" with "${newPreview}${parsed.input.new_string.length > 50 ? '...' : ''}")`
                        }
                      }
                      break
                    case 'MultiEdit':
                      if (parsed.input.file_path && parsed.input.edits) {
                        toolInfo = `[Multi-editing file: ${parsed.input.file_path}] (${parsed.input.edits.length} edits)`
                      }
                      break
                    case 'Write':
                      if (parsed.input.file_path) {
                        toolInfo = `[Writing file: ${parsed.input.file_path}]`
                        if (parsed.input.content) {
                          toolInfo += ` (${parsed.input.content.length} characters)`
                        }
                      }
                      break
                    case 'Grep':
                      if (parsed.input.pattern) {
                        toolInfo = `[Searching for pattern: "${parsed.input.pattern}"]`
                        if (parsed.input.path) {
                          toolInfo += ` in ${parsed.input.path}`
                        }
                        if (parsed.input.include) {
                          toolInfo += ` (files matching ${parsed.input.include})`
                        }
                      }
                      break
                    case 'Glob':
                      if (parsed.input.pattern) {
                        toolInfo = `[Finding files matching: ${parsed.input.pattern}]`
                        if (parsed.input.path) {
                          toolInfo += ` in ${parsed.input.path}`
                        }
                      }
                      break
                    case 'Bash':
                      if (parsed.input.command) {
                        const cmdPreview = parsed.input.command.substring(0, 100)
                        toolInfo = `[Running command: ${cmdPreview}${parsed.input.command.length > 100 ? '...' : ''}]`
                      }
                      break
                    case 'LS':
                      if (parsed.input.path) {
                        toolInfo = `[Listing directory: ${parsed.input.path}]`
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
                    content: `[System: Initialized with tools: ${parsed.tools?.join(', ') || 'none'}]`,
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
          content: `PROCESS ERROR: ${error.message}`,
          timestamp: new Date()
        })
        this.emit('status', 'failed')
      })
      
      this.reviewerProcess.on('exit', (code, signal) => {
        console.log('Reviewer process exited with code:', code, 'signal:', signal)
        this.processExitCode = code
        
        let exitMessage: string
        if (code === 0) {
          exitMessage = `Process completed successfully (code: ${code})`
        } else if (code === 143 && !this.isShuttingDown) {
          exitMessage = `Process terminated (SIGTERM). This may be due to timeout or system resource limits.`
          this.emit('error', new Error(exitMessage))
        } else if (!this.isShuttingDown) {
          exitMessage = `Process exited unexpectedly (code: ${code}, signal: ${signal})`
        } else {
          exitMessage = `Process stopped (code: ${code})`
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

  private async startSequentialExecution(worktreePath: string, reviewerPrompt: string) {
    // Phase 1: Editor
    this.currentPhase = 'editor'
    this.emit('status', 'in_progress')
    this.emit('phase', 'editor')
    this.lastOutputTime = Date.now()
    
    // Wait for editor to complete (it will exit on its own with -p mode)
    await this.waitForProcessExit(this.editorProcess, 'editor')
    
    // Phase 2: Start and monitor reviewer
    this.currentPhase = 'reviewer'
    this.emit('phase', 'reviewer')
    
    try {
      // Now start the reviewer process
      const claudeCommand = 'claude'
      
      console.log('Starting reviewer process with command:', claudeCommand)
      console.log('Arguments:', ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'])
      console.log('Working directory:', worktreePath)
        
      // Use print mode with stream-json output for real-time logs
      this.reviewerProcess = spawn(claudeCommand, ['-p', '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'], {
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
        console.warn(`${processName} process timed out after 30 minutes`)
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

  async start(prompt: string): Promise<void> {
    // Use stored values or throw error if not set
    if (!this.worktreePath || !this.taskId) {
      throw new Error('ProcessManager not properly initialized with worktreePath and taskId')
    }
    
    const { editorPid, reviewerPid } = await this.startProcesses(
      this.worktreePath,
      prompt,
      this.taskId
    )
    
    this.emit('editorPid', editorPid)
    this.emit('reviewerPid', reviewerPid)
  }

  stopProcesses() {
    this.isShuttingDown = true
    
    if (this.outputMonitorInterval) {
      clearInterval(this.outputMonitorInterval)
    }
    
    // Give processes time to gracefully shutdown
    const gracefulShutdown = async (process: ChildProcess | null, name: string) => {
      if (!process || !process.pid) return
      
      try {
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
    
    // Stop both processes gracefully
    Promise.all([
      gracefulShutdown(this.editorProcess, 'editor'),
      gracefulShutdown(this.reviewerProcess, 'reviewer')
    ]).then(() => {
      this.editorProcess = null
      this.reviewerProcess = null
      this.isShuttingDown = false
    })
  }
  
  isProcessRunning(): boolean {
    return !!(this.editorProcess || this.reviewerProcess)
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
}