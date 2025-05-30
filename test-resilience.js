#!/usr/bin/env node

/**
 * Test script to verify system resilience against crashes and connection failures
 */

const { spawn, exec } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)
const fs = require('fs').promises
const path = require('path')
const WebSocket = require('ws')

const TEST_RESULTS = {
  passed: 0,
  failed: 0,
  tests: []
}

// Test configuration
const SERVER_URL = 'http://localhost:3000'
const WS_URL = 'ws://localhost:3000/ws'
const HEALTH_URL = `${SERVER_URL}/api/health`

// Helper functions
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForServer(maxAttempts = 30) {
  console.log('Waiting for server to start...')
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(HEALTH_URL)
      if (response.ok) {
        console.log('Server is ready')
        return true
      }
    } catch (error) {
      // Server not ready yet
    }
    await sleep(1000)
  }
  throw new Error('Server failed to start')
}

async function createTestTask() {
  const response = await fetch(`${SERVER_URL}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Test task for resilience testing - add a test comment to README.md',
      repoPath: process.cwd()
    })
  })
  
  if (!response.ok) {
    throw new Error(`Failed to create task: ${response.statusText}`)
  }
  
  const task = await response.json()
  console.log(`Created test task: ${task.id}`)
  return task
}

async function getTask(taskId) {
  const response = await fetch(`${SERVER_URL}/api/tasks/${taskId}`)
  if (!response.ok) {
    throw new Error(`Failed to get task: ${response.statusText}`)
  }
  return response.json()
}

async function getHealthStatus() {
  const response = await fetch(HEALTH_URL)
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.statusText}`)
  }
  return response.json()
}

// Test functions
async function test1_CrashRecovery() {
  console.log('\n=== Test 1: Crash Recovery ===')
  const testName = 'Crash Recovery'
  
  try {
    // Create a task
    const task = await createTestTask()
    
    // Wait for some outputs
    await sleep(5000)
    
    // Get task outputs before crash
    const taskBefore = await getTask(task.id)
    const outputCountBefore = taskBefore.outputs?.length || 0
    console.log(`Task has ${outputCountBefore} outputs before crash`)
    
    // Simulate server crash
    console.log('Simulating server crash...')
    await execAsync('pkill -9 -f "node.*server.js"')
    await sleep(2000)
    
    // Restart server
    console.log('Restarting server...')
    const serverProcess = spawn('npm', ['run', 'dev'], {
      detached: true,
      stdio: 'ignore'
    })
    serverProcess.unref()
    
    // Wait for server to recover
    await waitForServer()
    await sleep(3000)
    
    // Check if task was recovered
    const taskAfter = await getTask(task.id)
    const outputCountAfter = taskAfter.outputs?.length || 0
    
    console.log(`Task has ${outputCountAfter} outputs after recovery`)
    console.log(`Task status: ${taskAfter.status}`)
    
    // Verify task was recovered
    if (taskAfter && taskAfter.id === task.id && outputCountAfter >= outputCountBefore) {
      console.log('✅ Task successfully recovered after crash')
      TEST_RESULTS.passed++
      TEST_RESULTS.tests.push({ name: testName, passed: true })
    } else {
      console.log('❌ Task recovery failed')
      TEST_RESULTS.failed++
      TEST_RESULTS.tests.push({ name: testName, passed: false, error: 'Task not properly recovered' })
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
    TEST_RESULTS.failed++
    TEST_RESULTS.tests.push({ name: testName, passed: false, error: error.message })
  }
}

async function test2_WebSocketReconnection() {
  console.log('\n=== Test 2: WebSocket Reconnection ===')
  const testName = 'WebSocket Reconnection'
  
  try {
    // Create a task
    const task = await createTestTask()
    
    // Connect WebSocket
    const ws = new WebSocket(`${WS_URL}?taskId=${task.id}`)
    let messageCount = 0
    let disconnectCount = 0
    
    await new Promise((resolve, reject) => {
      ws.on('open', () => {
        console.log('WebSocket connected')
        resolve()
      })
      ws.on('error', reject)
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000)
    })
    
    ws.on('message', (data) => {
      messageCount++
      const message = JSON.parse(data)
      console.log(`Received message type: ${message.type}`)
    })
    
    ws.on('close', () => {
      disconnectCount++
      console.log('WebSocket disconnected')
    })
    
    // Wait for some messages
    await sleep(3000)
    const initialMessageCount = messageCount
    console.log(`Received ${initialMessageCount} messages before disconnect`)
    
    // Force disconnect
    ws.close()
    await sleep(1000)
    
    // Reconnect
    const ws2 = new WebSocket(`${WS_URL}?taskId=${task.id}`)
    let reconnectMessageCount = 0
    
    await new Promise((resolve, reject) => {
      ws2.on('open', () => {
        console.log('WebSocket reconnected')
        resolve()
      })
      ws2.on('error', reject)
      setTimeout(() => reject(new Error('WebSocket reconnection timeout')), 5000)
    })
    
    ws2.on('message', () => {
      reconnectMessageCount++
    })
    
    // Wait for more messages
    await sleep(3000)
    
    console.log(`Received ${reconnectMessageCount} messages after reconnect`)
    
    // Cleanup
    ws2.close()
    
    if (disconnectCount === 1 && reconnectMessageCount > 0) {
      console.log('✅ WebSocket reconnection successful')
      TEST_RESULTS.passed++
      TEST_RESULTS.tests.push({ name: testName, passed: true })
    } else {
      console.log('❌ WebSocket reconnection failed')
      TEST_RESULTS.failed++
      TEST_RESULTS.tests.push({ name: testName, passed: false, error: 'Reconnection not working properly' })
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
    TEST_RESULTS.failed++
    TEST_RESULTS.tests.push({ name: testName, passed: false, error: error.message })
  }
}

async function test3_DataPersistence() {
  console.log('\n=== Test 3: Data Persistence ===')
  const testName = 'Data Persistence'
  
  try {
    // Check persistent state files
    const dataDir = path.join(require('os').homedir(), '.claude-god-data')
    const stateDir = path.join(dataDir, 'state')
    const logsDir = path.join(dataDir, 'logs')
    
    // Verify directories exist
    const stateDirExists = await fs.access(stateDir).then(() => true).catch(() => false)
    const logsDirExists = await fs.access(logsDir).then(() => true).catch(() => false)
    
    console.log(`State directory exists: ${stateDirExists}`)
    console.log(`Logs directory exists: ${logsDirExists}`)
    
    if (!stateDirExists || !logsDirExists) {
      throw new Error('Persistence directories not created')
    }
    
    // Check for snapshots
    const snapshotsDir = path.join(stateDir, 'snapshots')
    const snapshots = await fs.readdir(snapshotsDir).catch(() => [])
    console.log(`Found ${snapshots.length} snapshots`)
    
    // Check for log files
    const logFiles = await fs.readdir(logsDir).catch(() => [])
    const logFileCount = logFiles.filter(f => f.endsWith('.log')).length
    console.log(`Found ${logFileCount} log files`)
    
    // Verify task persistence
    const tasksDir = path.join(stateDir, 'tasks')
    const taskFiles = await fs.readdir(tasksDir).catch(() => [])
    console.log(`Found ${taskFiles.length} persisted task files`)
    
    if (logFileCount > 0 && taskFiles.length > 0) {
      console.log('✅ Data persistence working correctly')
      TEST_RESULTS.passed++
      TEST_RESULTS.tests.push({ name: testName, passed: true })
    } else {
      console.log('❌ Data persistence incomplete')
      TEST_RESULTS.failed++
      TEST_RESULTS.tests.push({ name: testName, passed: false, error: 'Missing persistence files' })
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
    TEST_RESULTS.failed++
    TEST_RESULTS.tests.push({ name: testName, passed: false, error: error.message })
  }
}

async function test4_HealthMonitoring() {
  console.log('\n=== Test 4: Health Monitoring ===')
  const testName = 'Health Monitoring'
  
  try {
    const health = await getHealthStatus()
    
    console.log(`Overall health: ${health.status}`)
    console.log('Component health:')
    Object.entries(health.components).forEach(([name, component]) => {
      console.log(`  ${name}: ${component.status} - ${component.message || 'OK'}`)
    })
    
    console.log(`Active tasks: ${health.metrics.activeTasks}`)
    console.log(`Total tasks: ${health.metrics.totalTasks}`)
    console.log(`Uptime: ${Math.round(health.metrics.uptime)} seconds`)
    
    if (health.warnings.length > 0) {
      console.log('Warnings:', health.warnings)
    }
    
    if (health.errors.length > 0) {
      console.log('Errors:', health.errors)
    }
    
    // Verify all components are at least degraded
    const allComponentsOk = Object.values(health.components).every(
      c => c.status === 'healthy' || c.status === 'degraded'
    )
    
    if (allComponentsOk) {
      console.log('✅ Health monitoring working correctly')
      TEST_RESULTS.passed++
      TEST_RESULTS.tests.push({ name: testName, passed: true })
    } else {
      console.log('❌ Some components unhealthy')
      TEST_RESULTS.failed++
      TEST_RESULTS.tests.push({ name: testName, passed: false, error: 'Unhealthy components detected' })
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
    TEST_RESULTS.failed++
    TEST_RESULTS.tests.push({ name: testName, passed: false, error: error.message })
  }
}

async function test5_GracefulShutdown() {
  console.log('\n=== Test 5: Graceful Shutdown ===')
  const testName = 'Graceful Shutdown'
  
  try {
    // Create a task that we'll check persists through shutdown
    const task = await createTestTask()
    await sleep(3000)
    
    // Get current state
    const taskBefore = await getTask(task.id)
    const outputCountBefore = taskBefore.outputs?.length || 0
    
    console.log('Triggering graceful shutdown...')
    
    // Send SIGTERM to trigger graceful shutdown
    await execAsync('pkill -TERM -f "node.*server.js"')
    
    // Wait for shutdown
    await sleep(5000)
    
    // Check that data was persisted
    const dataDir = path.join(require('os').homedir(), '.claude-god-data')
    const currentStateFile = path.join(dataDir, 'state', 'current-state.json')
    
    const stateExists = await fs.access(currentStateFile).then(() => true).catch(() => false)
    
    if (stateExists) {
      const state = JSON.parse(await fs.readFile(currentStateFile, 'utf-8'))
      console.log(`State saved with ${state.taskCount} tasks`)
      
      if (state.shutdownClean === true) {
        console.log('✅ Graceful shutdown completed successfully')
        TEST_RESULTS.passed++
        TEST_RESULTS.tests.push({ name: testName, passed: true })
      } else {
        console.log('❌ Shutdown was not clean')
        TEST_RESULTS.failed++
        TEST_RESULTS.tests.push({ name: testName, passed: false, error: 'Unclean shutdown detected' })
      }
    } else {
      console.log('❌ State file not found after shutdown')
      TEST_RESULTS.failed++
      TEST_RESULTS.tests.push({ name: testName, passed: false, error: 'State not persisted' })
    }
    
    // Restart server for next tests
    console.log('Restarting server...')
    const serverProcess = spawn('npm', ['run', 'dev'], {
      detached: true,
      stdio: 'ignore'
    })
    serverProcess.unref()
    await waitForServer()
    
  } catch (error) {
    console.error('❌ Test failed:', error.message)
    TEST_RESULTS.failed++
    TEST_RESULTS.tests.push({ name: testName, passed: false, error: error.message })
  }
}

// Main test runner
async function runTests() {
  console.log('Starting resilience tests...')
  console.log('================================\n')
  
  try {
    // Ensure server is running
    await waitForServer()
    
    // Run tests
    await test1_CrashRecovery()
    await test2_WebSocketReconnection()
    await test3_DataPersistence()
    await test4_HealthMonitoring()
    await test5_GracefulShutdown()
    
  } catch (error) {
    console.error('Fatal error:', error)
  }
  
  // Print summary
  console.log('\n================================')
  console.log('Test Summary:')
  console.log(`Passed: ${TEST_RESULTS.passed}`)
  console.log(`Failed: ${TEST_RESULTS.failed}`)
  console.log(`Total: ${TEST_RESULTS.passed + TEST_RESULTS.failed}`)
  
  console.log('\nDetailed Results:')
  TEST_RESULTS.tests.forEach(test => {
    const status = test.passed ? '✅' : '❌'
    console.log(`${status} ${test.name}${test.error ? ` - ${test.error}` : ''}`)
  })
  
  process.exit(TEST_RESULTS.failed > 0 ? 1 : 0)
}

// Run tests
runTests().catch(console.error)