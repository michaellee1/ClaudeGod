import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

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
  private readonly IDLE_TIMEOUT = 20000 // 20 seconds of no output means done
  private outputBuffer: string = ''
  private readonly COMPLETION_PATTERNS = [
    /Task complete/i,
    /Done\./i,
    /Finished\./i,
    /All tests pass/i,
    /Successfully completed/i
  ]

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
      console.log('Arguments:', ['-p', '--verbose', editorPrompt.substring(0, 50) + '...', '--dangerously-skip-permissions'])
      console.log('Working directory:', worktreePath)
      
      // Use print mode with verbose output
      this.editorProcess = spawn(claudeCommand, ['-p', '--verbose', editorPrompt, '--dangerously-skip-permissions'], {
        cwd: worktreePath,
        env: { 
          ...process.env, 
          PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin:/Users/michaellee/.nvm/versions/node/v20.16.0/bin',
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
      
      // Don't send prompt via stdin since we're passing it as argument
      // Keep stdin open for additional prompts
      
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
          const content = data
          this.outputBuffer += content
          
          this.emit('output', {
            type: 'editor',
            content: content,
            timestamp: new Date()
          })
          
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
        const exitMessage = code === 0 
          ? `Process completed successfully (code: ${code})`
          : `Process exited unexpectedly (code: ${code}, signal: ${signal})`
        
        this.emit('output', {
          type: 'editor',
          content: exitMessage,
          timestamp: new Date()
        })
        
        // If process exits with non-zero code and we're not already finished, mark as failed
        if (code !== 0 && this.currentPhase === 'editor') {
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
          const content = data
          this.outputBuffer += content
          
          this.emit('output', {
            type: 'reviewer',
            content: content,
            timestamp: new Date()
          })
          
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
        const exitMessage = code === 0 
          ? `Process completed successfully (code: ${code})`
          : `Process exited unexpectedly (code: ${code}, signal: ${signal})`
        
        this.emit('output', {
          type: 'reviewer',
          content: exitMessage,
          timestamp: new Date()
        })
        
        // If process exits with non-zero code and we're not already finished, mark as failed
        if (code !== 0 && this.currentPhase === 'reviewer') {
          console.error('Reviewer process failed with code:', code)
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
    
    // Monitor editor output
    await this.monitorProcessCompletion('editor')
    
    // Phase 2: Start and monitor reviewer
    this.currentPhase = 'reviewer'
    this.emit('phase', 'reviewer')
    
    try {
      // Now start the reviewer process
      const claudeCommand = 'claude'
      
      console.log('Starting reviewer process with command:', claudeCommand)
      console.log('Arguments:', ['-p', '--verbose', reviewerPrompt.substring(0, 50) + '...', '--dangerously-skip-permissions'])
      console.log('Working directory:', worktreePath)
        
      // Use print mode with verbose output
      this.reviewerProcess = spawn(claudeCommand, ['-p', '--verbose', reviewerPrompt, '--dangerously-skip-permissions'], {
        cwd: worktreePath,
        env: { 
          ...process.env, 
          PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin:/Users/michaellee/.nvm/versions/node/v20.16.0/bin',
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
      
      // Don't send prompt via stdin since we're passing it as argument
      // Keep stdin open for additional prompts
      
      this.lastOutputTime = Date.now()
      
      // Monitor reviewer output
      await this.monitorProcessCompletion('reviewer')
      
      // Phase 3: Complete
      this.currentPhase = 'finished'
      this.emit('status', 'finished')
      this.emit('phase', 'done')
      this.emit('completed')
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
    const process = this.currentPhase === 'reviewer' ? this.reviewerProcess : this.editorProcess
    if (process && process.stdin) {
      process.stdin.write(prompt + '\n')
      this.lastOutputTime = Date.now()
    }
  }

  stopProcesses() {
    if (this.outputMonitorInterval) {
      clearInterval(this.outputMonitorInterval)
    }
    
    if (this.editorProcess) {
      this.editorProcess.kill('SIGTERM')
      this.editorProcess = null
    }
    
    if (this.reviewerProcess) {
      this.reviewerProcess.kill('SIGTERM')
      this.reviewerProcess = null
    }
  }
}