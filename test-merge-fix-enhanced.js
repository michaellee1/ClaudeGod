#!/usr/bin/env node

/**
 * Enhanced test script to verify that merging a task doesn't delete other tasks
 * This tests the enhanced fix with pending task queue
 */

const fs = require('fs').promises
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getTasksFromFile() {
  const tasksFile = path.join(os.homedir(), '.claude-god-data', 'tasks.json')
  try {
    const data = await fs.readFile(tasksFile, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    return []
  }
}

// Helper to make HTTP requests to the API
async function makeRequest(endpoint, method = 'GET', body = null) {
  const fetch = (await import('node-fetch')).default
  const response = await fetch(`http://localhost:3000/api${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : null
  })
  
  const data = await response.json()
  if (!response.ok) {
    throw new Error(`API error: ${data.error || response.statusText}`)
  }
  return data
}

async function createTask(prompt, repoPath) {
  return makeRequest('/tasks', 'POST', {
    prompt,
    repoPath,
    thinkMode: 'none'
  })
}

async function commitTask(taskId, message) {
  return makeRequest(`/tasks/${taskId}/commit`, 'POST', {
    message
  })
}

async function mergeTask(taskId) {
  return makeRequest(`/tasks/${taskId}/merge`, 'POST')
}

async function getTasks() {
  return makeRequest('/tasks')
}

async function runTest() {
  console.log('🧪 Starting enhanced merge fix test...\n')
  
  const testRepoPath = process.cwd()
  
  try {
    // Step 1: Get initial task count
    const initialTasks = await getTasks()
    console.log(`📊 Initial task count: ${initialTasks.length}`)
    
    // Step 2: Create multiple tasks quickly
    console.log('\n📝 Creating 5 test tasks in quick succession...')
    const taskPromises = []
    
    for (let i = 1; i <= 5; i++) {
      const promise = createTask(
        `Test task ${i} - ${new Date().toISOString()}`,
        testRepoPath
      )
      taskPromises.push(promise)
      // Very small delay to simulate rapid creation
      await sleep(10)
    }
    
    const tasks = await Promise.all(taskPromises)
    console.log(`✅ Created ${tasks.length} tasks via API`)
    
    // Step 3: Wait a moment and verify all tasks are visible
    await sleep(500)
    const tasksAfterCreation = await getTasks()
    const newTasks = tasksAfterCreation.filter(t => 
      tasks.some(created => created.task.id === t.id)
    )
    console.log(`\n📁 New tasks visible via API: ${newTasks.length}`)
    
    // Step 4: Create activity on some tasks while simultaneously creating more
    console.log('\n🔄 Creating concurrent activity...')
    
    // Start merging the first task
    const taskToMerge = tasks[0].task
    console.log(`\n🔀 Starting merge of task ${taskToMerge.id}...`)
    
    // First commit the task
    await commitTask(taskToMerge.id, 'Test commit')
    
    // Create more tasks DURING the merge operation
    const concurrentPromises = []
    const mergePromise = mergeTask(taskToMerge.id)
    
    // Immediately create more tasks while merge is in progress
    for (let i = 6; i <= 8; i++) {
      concurrentPromises.push(createTask(
        `Concurrent task ${i} - ${new Date().toISOString()}`,
        testRepoPath
      ))
    }
    
    // Wait for everything to complete
    const [mergeResult, ...concurrentTasks] = await Promise.all([
      mergePromise,
      ...concurrentPromises
    ])
    
    console.log(`✅ Merge completed`)
    console.log(`✅ Created ${concurrentTasks.length} concurrent tasks during merge`)
    
    // Step 5: Verify all tasks are still there
    await sleep(1000)
    const finalTasks = await getTasks()
    const allTestTasks = finalTasks.filter(t => 
      t.prompt.includes('Test task') || t.prompt.includes('Concurrent task')
    )
    
    console.log(`\n📊 Final Results:`)
    console.log(`   - Total test tasks found: ${allTestTasks.length}`)
    console.log(`   - Expected: 8 (5 initial + 3 concurrent)`)
    console.log(`   - Active tasks: ${allTestTasks.filter(t => t.status !== 'merged').length}`)
    console.log(`   - Merged tasks: ${allTestTasks.filter(t => t.status === 'merged').length}`)
    
    // Check the file directly as well
    const fileData = await getTasksFromFile()
    const fileTestTasks = fileData.filter(t => 
      t.prompt.includes('Test task') || t.prompt.includes('Concurrent task')
    )
    console.log(`   - Tasks in file: ${fileTestTasks.length}`)
    
    // Verify the fix worked
    if (allTestTasks.length === 8 && allTestTasks.filter(t => t.status !== 'merged').length === 7) {
      console.log('\n✅ SUCCESS: All tasks preserved during concurrent operations!')
      console.log('   The enhanced fix is working correctly.')
    } else {
      console.log('\n❌ FAILURE: Some tasks were lost!')
      console.log(`   Expected 8 total tasks, found ${allTestTasks.length}`)
      console.log(`   Expected 7 active tasks, found ${allTestTasks.filter(t => t.status !== 'merged').length}`)
      
      // Debug info
      console.log('\n🔍 Debug info:')
      allTestTasks.forEach(t => {
        console.log(`   - ${t.id}: ${t.prompt.substring(0, 30)}... (${t.status})`)
      })
    }
    
  } catch (error) {
    console.error('\n❌ Test failed with error:', error)
  }
  
  console.log('\n✨ Test complete!')
}

// Check if server is running
async function checkServer() {
  try {
    await makeRequest('/tasks')
    return true
  } catch (error) {
    return false
  }
}

// Main execution
async function main() {
  const serverRunning = await checkServer()
  if (!serverRunning) {
    console.log('❌ Server is not running. Please start the server with: npm run dev')
    process.exit(1)
  }
  
  await runTest()
}

main().catch(console.error)