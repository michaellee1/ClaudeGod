#!/usr/bin/env node

/**
 * System Validation Script for Claude God
 * 
 * This script validates key assumptions made in the codebase to help debug
 * issues when the system is running.
 */

const { execFile } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const fs = require('fs/promises')
const os = require('os')

const execFileAsync = promisify(execFile)

class SystemValidator {
  constructor() {
    this.results = []
    this.tempDir = os.tmpdir()
    this.worktreeBase = path.join(this.tempDir, 'claude-god-worktrees')
    this.dataDir = path.join(os.homedir(), '.claude-god-data')
    this.configPath = path.join(os.homedir(), '.claude-god-config.json')
  }

  log(test, status, message, details = null) {
    const result = { test, status, message, details, timestamp: new Date() }
    this.results.push(result)
    
    const statusSymbol = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️'
    console.log(`${statusSymbol} ${test}: ${message}`)
    if (details) {
      console.log(`   Details: ${JSON.stringify(details, null, 2)}`)
    }
  }

  async testEnvironment() {
    console.log('\n🔍 Testing Environment...')
    
    // Test Node.js version
    const nodeVersion = process.version
    this.log('Node Version', 'INFO', `Running Node.js ${nodeVersion}`)
    
    // Test OS details
    const platform = os.platform()
    const release = os.release()
    this.log('OS Info', 'INFO', `Platform: ${platform}, Release: ${release}`)
    
    // Test temp directory
    try {
      await fs.access(this.tempDir)
      this.log('Temp Directory', 'PASS', `Temp dir accessible: ${this.tempDir}`)
    } catch (error) {
      this.log('Temp Directory', 'FAIL', `Cannot access temp dir: ${this.tempDir}`, error.message)
    }
    
    // Test worktree base directory
    try {
      await fs.access(this.worktreeBase)
      const files = await fs.readdir(this.worktreeBase)
      this.log('Worktree Base', 'PASS', `Found ${files.length} worktrees`, files)
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.log('Worktree Base', 'INFO', 'Worktree base directory does not exist (normal if no tasks created)')
      } else {
        this.log('Worktree Base', 'FAIL', 'Cannot access worktree base', error.message)
      }
    }
  }

  async testGitOperations() {
    console.log('\n🔍 Testing Git Operations...')
    
    // Test git availability
    try {
      const { stdout } = await execFileAsync('git', ['--version'])
      this.log('Git Available', 'PASS', `Git found: ${stdout.trim()}`)
    } catch (error) {
      this.log('Git Available', 'FAIL', 'Git not found in PATH', error.message)
      return
    }
    
    // Test current repo
    try {
      const repoPath = process.cwd()
      await execFileAsync('git', ['-C', repoPath, 'rev-parse', '--git-dir'])
      this.log('Current Repo', 'PASS', `Valid git repository: ${repoPath}`)
      
      // Test git operations
      const { stdout: branch } = await execFileAsync('git', ['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'])
      this.log('Git Branch', 'PASS', `Current branch: ${branch.trim()}`)
      
      const { stdout: status } = await execFileAsync('git', ['-C', repoPath, 'status', '--porcelain'])
      this.log('Git Status', 'INFO', `Working tree status: ${status.trim() || 'clean'}`)
      
    } catch (error) {
      this.log('Current Repo', 'FAIL', 'Current directory is not a git repository', error.message)
    }
    
    // Test worktree operations (dry run)
    try {
      const testBranch = `test-validation-${Date.now()}`
      const testWorktreePath = path.join(this.worktreeBase, testBranch)
      
      // Ensure base directory exists
      await fs.mkdir(this.worktreeBase, { recursive: true })
      
      // Test worktree creation
      await execFileAsync('git', [
        '-C', process.cwd(),
        'worktree', 'add',
        testWorktreePath,
        '-b', testBranch,
        'HEAD'
      ])
      
      this.log('Worktree Creation', 'PASS', `Successfully created test worktree: ${testWorktreePath}`)
      
      // Test worktree removal
      await execFileAsync('git', ['-C', process.cwd(), 'worktree', 'remove', testWorktreePath, '--force'])
      await execFileAsync('git', ['-C', process.cwd(), 'branch', '-D', testBranch])
      
      this.log('Worktree Cleanup', 'PASS', 'Successfully cleaned up test worktree')
      
    } catch (error) {
      this.log('Worktree Operations', 'FAIL', 'Failed to test worktree operations', error.message)
    }
  }

  async testClaudeCommand() {
    console.log('\n🔍 Testing Claude Command...')
    
    // Test claude command availability
    try {
      const { stdout, stderr } = await execFileAsync('claude', ['--version'])
      this.log('Claude Command', 'PASS', `Claude CLI found: ${stdout.trim() || stderr.trim()}`)
    } catch (error) {
      this.log('Claude Command', 'FAIL', 'Claude CLI not found in PATH', error.message)
      
      // Test alternative paths
      const altPaths = [
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
        path.join(os.homedir(), '.nvm/versions/node/v20.16.0/bin/claude')
      ]
      
      for (const altPath of altPaths) {
        try {
          await fs.access(altPath)
          this.log('Claude Alt Path', 'INFO', `Found claude at: ${altPath}`)
        } catch {
          // Not found at this path
        }
      }
    }
    
    // Test PATH environment
    const pathEnv = process.env.PATH
    const pathDirs = pathEnv.split(':')
    this.log('PATH Environment', 'INFO', `PATH has ${pathDirs.length} directories`, pathDirs.slice(0, 10))
  }

  async testDataStorage() {
    console.log('\n🔍 Testing Data Storage...')
    
    // Test data directory
    try {
      await fs.access(this.dataDir)
      const files = await fs.readdir(this.dataDir)
      this.log('Data Directory', 'PASS', `Data dir exists with ${files.length} files`, files)
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.log('Data Directory', 'INFO', 'Data directory does not exist (normal for first run)')
      } else {
        this.log('Data Directory', 'FAIL', 'Cannot access data directory', error.message)
      }
    }
    
    // Test config file
    try {
      const config = await fs.readFile(this.configPath, 'utf-8')
      const parsed = JSON.parse(config)
      this.log('Config File', 'PASS', 'Config file exists and is valid JSON', parsed)
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.log('Config File', 'INFO', 'Config file does not exist (normal for first run)')
      } else {
        this.log('Config File', 'FAIL', 'Cannot read config file', error.message)
      }
    }
    
    // Test tasks file
    const tasksFile = path.join(this.dataDir, 'tasks.json')
    try {
      const tasks = await fs.readFile(tasksFile, 'utf-8')
      const parsed = JSON.parse(tasks)
      this.log('Tasks File', 'PASS', `Found ${parsed.length} tasks in storage`, parsed.map(t => ({ id: t.id, status: t.status })))
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.log('Tasks File', 'INFO', 'Tasks file does not exist (normal for first run)')
      } else {
        this.log('Tasks File', 'FAIL', 'Cannot read tasks file', error.message)
      }
    }
    
    // Test outputs file
    const outputsFile = path.join(this.dataDir, 'outputs.json')
    try {
      const outputs = await fs.readFile(outputsFile, 'utf-8')
      const parsed = JSON.parse(outputs)
      const taskIds = Object.keys(parsed)
      this.log('Outputs File', 'PASS', `Found outputs for ${taskIds.length} tasks`, taskIds)
      
      // Validate output structure for first task
      if (taskIds.length > 0) {
        const firstTaskId = taskIds[0]
        const firstTaskOutputs = parsed[firstTaskId]
        if (Array.isArray(firstTaskOutputs) && firstTaskOutputs.length > 0) {
          const sampleOutput = firstTaskOutputs[0]
          this.log('Output Structure', 'PASS', 'Output structure validation', {
            taskId: firstTaskId,
            outputCount: firstTaskOutputs.length,
            sampleFields: Object.keys(sampleOutput),
            hasContent: !!sampleOutput.content,
            contentLength: sampleOutput.content?.length || 0,
            contentPreview: sampleOutput.content?.substring(0, 100) || 'No content'
          })
        } else {
          this.log('Output Structure', 'WARN', `Task ${firstTaskId} has no outputs or invalid structure`)
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.log('Outputs File', 'INFO', 'Outputs file does not exist (normal for first run)')
      } else {
        this.log('Outputs File', 'FAIL', 'Cannot read outputs file', error.message)
      }
    }
  }

  async testProcessCapabilities() {
    console.log('\n🔍 Testing Process Capabilities...')
    
    // Test spawn capability
    try {
      const { spawn } = require('child_process')
      const testProcess = spawn('echo', ['test'], { stdio: 'pipe' })
      
      let output = ''
      testProcess.stdout.on('data', (data) => {
        output += data.toString()
      })
      
      await new Promise((resolve, reject) => {
        testProcess.on('exit', (code) => {
          if (code === 0) {
            this.log('Process Spawn', 'PASS', `Successfully spawned process, output: ${output.trim()}`)
            resolve()
          } else {
            reject(new Error(`Process exited with code ${code}`))
          }
        })
        testProcess.on('error', reject)
      })
    } catch (error) {
      this.log('Process Spawn', 'FAIL', 'Cannot spawn processes', error.message)
    }
    
    // Test Claude process spawning with same parameters as ProcessManager
    await this.testClaudeProcessSpawn()
    
    // Test process environment
    const importantEnvVars = ['HOME', 'PATH', 'USER']
    for (const envVar of importantEnvVars) {
      const value = process.env[envVar]
      if (value) {
        this.log(`Env ${envVar}`, 'PASS', `${envVar}=${value.substring(0, 50)}${value.length > 50 ? '...' : ''}`)
      } else {
        this.log(`Env ${envVar}`, 'WARN', `${envVar} not set`)
      }
    }
  }

  async testClaudeProcessSpawn() {
    console.log('\n🔍 Testing Claude Process Spawning...')
    
    // Test 1: Basic Claude command without worktree
    await this.testBasicClaudeCommand()
    
    // Test 2: Claude in worktree with different invocation methods
    await this.testClaudeInWorktree()
  }

  async testBasicClaudeCommand() {
    console.log('\n🔍 Testing Basic Claude Command...')
    
    try {
      // Test simple Claude command first
      const simpleTest = await execFileAsync('claude', ['--help'], { timeout: 5000 })
      this.log('Claude Help', 'PASS', 'Claude --help works', { 
        stdoutLength: simpleTest.stdout.length,
        stderrLength: simpleTest.stderr.length 
      })
      
      // Log the help output to see available flags
      console.log('\n=== CLAUDE HELP OUTPUT ===')
      console.log(simpleTest.stdout)
      console.log('=== END HELP OUTPUT ===\n')
      
      // Test if Claude needs stdin or has other modes
      try {
        // Test sending prompt via stdin with echo
        const echoTest = await execFileAsync('bash', ['-c', 'echo "echo test123" | claude -p'], { 
          timeout: 10000,
          cwd: process.cwd()
        })
        this.log('Claude Echo Pipe', 'PASS', 'Claude with echo pipe works', {
          stdoutLength: echoTest.stdout.length,
          stderrLength: echoTest.stderr.length,
          stdoutPreview: echoTest.stdout.substring(0, 200),
          stderrPreview: echoTest.stderr.substring(0, 200)
        })
      } catch (error) {
        this.log('Claude Echo Pipe', 'FAIL', 'Claude with echo pipe failed', error.message)
      }
      
    } catch (error) {
      this.log('Basic Claude Test', 'FAIL', 'Basic Claude command failed', error.message)
    }
  }

  async testClaudeInWorktree() {
    console.log('\n🔍 Testing Claude in Worktree...')
    
    try {
      const { spawn } = require('child_process')
      
      // Create a temporary worktree to test with
      const testBranch = `test-claude-spawn-${Date.now()}`
      const testWorktreePath = path.join(this.worktreeBase, testBranch)
      
      // Ensure base directory exists
      await fs.mkdir(this.worktreeBase, { recursive: true })
      
      // Create test worktree
      await execFileAsync('git', [
        '-C', process.cwd(),
        'worktree', 'add',
        testWorktreePath,
        '-b', testBranch,
        'HEAD'
      ])
      
      this.log('Test Worktree', 'PASS', `Created test worktree: ${testWorktreePath}`)
      
      // Test different Claude invocation methods
      const testCases = [
        {
          name: 'Print Mode File Path',
          args: ['-p', '/tmp/test-prompt.txt'],
          timeout: 10000,
          interactive: false,
          setupFn: async () => {
            await fs.writeFile('/tmp/test-prompt.txt', 'echo "Hello from file"')
            return () => fs.unlink('/tmp/test-prompt.txt').catch(() => {})
          }
        },
        {
          name: 'Print Mode Stdin',
          args: ['-p'],
          prompt: 'echo "Hello from stdin"\n',
          timeout: 10000,
          interactive: true
        },
        {
          name: 'Print Mode Basic',
          args: ['-p', 'echo "Hello World"'],
          timeout: 10000,
          interactive: false
        }
      ]
      
      for (const testCase of testCases) {
        try {
          let cleanupFn = null
          if (testCase.setupFn) {
            cleanupFn = await testCase.setupFn()
          }
          
          this.log(`Claude Test: ${testCase.name}`, 'INFO', `Testing: claude ${testCase.args.join(' ')}`)
          
          const claudeProcess = spawn('claude', testCase.args, {
            cwd: testWorktreePath,
            env: { 
              ...process.env, 
              PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin:/Users/michaellee/.nvm/versions/node/v20.16.0/bin',
              FORCE_COLOR: '0',
              NO_COLOR: '1'
            },
            shell: false,
            stdio: ['pipe', 'pipe', 'pipe']
          })
          
          if (!claudeProcess.pid) {
            throw new Error('Failed to start Claude process - no PID')
          }
          
          // Capture output
          let stdoutData = ''
          let stderrData = ''
          let outputReceived = false
          
          if (claudeProcess.stdout) {
            claudeProcess.stdout.setEncoding('utf8')
            claudeProcess.stdout.on('data', (data) => {
              console.log(`[${testCase.name}] STDOUT:`, data.substring(0, 100))
              stdoutData += data
              outputReceived = true
            })
          }
          
          if (claudeProcess.stderr) {
            claudeProcess.stderr.setEncoding('utf8')
            claudeProcess.stderr.on('data', (data) => {
              console.log(`[${testCase.name}] STDERR:`, data.substring(0, 100))
              stderrData += data
              outputReceived = true
            })
          }
          
          // For interactive mode, send prompt via stdin
          if (testCase.interactive && testCase.prompt) {
            if (claudeProcess.stdin) {
              console.log(`[${testCase.name}] Sending prompt via stdin:`, testCase.prompt.substring(0, 50))
              claudeProcess.stdin.write(testCase.prompt)
              claudeProcess.stdin.end()
            } else {
              this.log(`Claude ${testCase.name} STDIN`, 'FAIL', 'Claude process stdin is null')
            }
          }
          
          // Wait for process to complete or timeout
          const processResult = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              claudeProcess.kill('SIGKILL')
              resolve({ 
                code: 'TIMEOUT', 
                signal: 'SIGKILL', 
                stdoutData, 
                stderrData, 
                outputReceived,
                timedOut: true 
              })
            }, testCase.timeout)
            
            claudeProcess.on('exit', (code, signal) => {
              clearTimeout(timeout)
              resolve({ code, signal, stdoutData, stderrData, outputReceived, timedOut: false })
            })
            
            claudeProcess.on('error', (error) => {
              clearTimeout(timeout)
              reject(error)
            })
          })
          
          const status = processResult.timedOut ? 'FAIL' : (processResult.outputReceived ? 'PASS' : 'WARN')
          this.log(`Claude ${testCase.name}`, status, 
            `${processResult.timedOut ? 'TIMED OUT' : `Exited: ${processResult.code}`}`, {
              pid: claudeProcess.pid,
              outputReceived: processResult.outputReceived,
              stdoutLength: processResult.stdoutData.length,
              stderrLength: processResult.stderrData.length,
              stdoutPreview: processResult.stdoutData.substring(0, 100),
              stderrPreview: processResult.stderrData.substring(0, 100)
            })
          
        } catch (error) {
          this.log(`Claude ${testCase.name}`, 'FAIL', 'Process failed to start', error.message)
        }
      }
      
      // Clean up test worktree
      await execFileAsync('git', ['-C', process.cwd(), 'worktree', 'remove', testWorktreePath, '--force'])
      await execFileAsync('git', ['-C', process.cwd(), 'branch', '-D', testBranch])
      this.log('Test Cleanup', 'PASS', 'Cleaned up test worktree')
      
    } catch (error) {
      this.log('Claude Worktree Test', 'FAIL', 'Failed to test Claude in worktree', error.message)
    }
  }

  async testNetworkAndAPI() {
    console.log('\n🔍 Testing Network and API...')
    
    // Test if Next.js server is running
    try {
      const http = require('http')
      const testRequest = (url) => {
        return new Promise((resolve, reject) => {
          const req = http.get(url, (res) => {
            let data = ''
            res.on('data', (chunk) => data += chunk)
            res.on('end', () => resolve({ statusCode: res.statusCode, data }))
          })
          req.on('error', reject)
          req.setTimeout(5000, () => reject(new Error('Timeout')))
        })
      }
      
      const configResponse = await testRequest('http://localhost:3000/api/config')
      this.log('API Server', 'PASS', `API server responding (status: ${configResponse.statusCode})`)
      
      // Test tasks list endpoint
      const tasksResponse = await testRequest('http://localhost:3000/api/tasks')
      if (tasksResponse.statusCode === 200) {
        const tasks = JSON.parse(tasksResponse.data)
        this.log('Tasks API', 'PASS', `Tasks endpoint returned ${tasks.length} tasks`, tasks.map(t => ({ id: t.id, status: t.status })))
        
        // Test output endpoints for each task
        for (const task of tasks.slice(0, 3)) { // Test first 3 tasks only
          try {
            const outputResponse = await testRequest(`http://localhost:3000/api/tasks/${task.id}/outputs`)
            if (outputResponse.statusCode === 200) {
              const outputs = JSON.parse(outputResponse.data)
              this.log(`Outputs API (${task.id})`, 'PASS', `Task ${task.id} has ${outputs.length} outputs`, {
                taskId: task.id,
                outputCount: outputs.length,
                sampleOutput: outputs.length > 0 ? {
                  type: outputs[0].type,
                  contentLength: outputs[0].content?.length || 0,
                  timestamp: outputs[0].timestamp
                } : null
              })
            } else {
              this.log(`Outputs API (${task.id})`, 'FAIL', `Task ${task.id} outputs returned status ${outputResponse.statusCode}`, outputResponse.data)
            }
          } catch (error) {
            this.log(`Outputs API (${task.id})`, 'FAIL', `Failed to fetch outputs for task ${task.id}`, error.message)
          }
        }
      } else {
        this.log('Tasks API', 'FAIL', `Tasks endpoint returned status ${tasksResponse.statusCode}`, tasksResponse.data)
      }
      
    } catch (error) {
      this.log('API Server', 'FAIL', 'API server not responding on port 3000', error.message)
    }
  }

  async run() {
    console.log('🚀 Starting Claude God System Validation\n')
    
    await this.testEnvironment()
    await this.testGitOperations()
    await this.testClaudeCommand()
    await this.testDataStorage()
    await this.testProcessCapabilities()
    await this.testNetworkAndAPI()
    
    console.log('\n📊 Validation Summary:')
    const passed = this.results.filter(r => r.status === 'PASS').length
    const failed = this.results.filter(r => r.status === 'FAIL').length
    const warnings = this.results.filter(r => r.status === 'WARN').length
    const info = this.results.filter(r => r.status === 'INFO').length
    
    console.log(`✅ Passed: ${passed}`)
    console.log(`❌ Failed: ${failed}`)
    console.log(`⚠️  Warnings: ${warnings}`)
    console.log(`ℹ️  Info: ${info}`)
    
    if (failed > 0) {
      console.log('\n🔥 Critical Issues Found:')
      this.results.filter(r => r.status === 'FAIL').forEach(r => {
        console.log(`   ${r.test}: ${r.message}`)
      })
    }
    
    // Save detailed results
    const resultsFile = path.join(process.cwd(), 'validation-results.json')
    await fs.writeFile(resultsFile, JSON.stringify(this.results, null, 2))
    console.log(`\n📄 Detailed results saved to: ${resultsFile}`)
    
    return failed === 0
  }
}

// Run validation if called directly
if (require.main === module) {
  const validator = new SystemValidator()
  validator.run().then(success => {
    process.exit(success ? 0 : 1)
  }).catch(error => {
    console.error('Validation failed:', error)
    process.exit(1)
  })
}

module.exports = { SystemValidator }