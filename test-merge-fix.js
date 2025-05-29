#!/usr/bin/env node

/**
 * Test script to verify that merging a task doesn't delete other tasks
 * This simulates the race condition that was causing task deletion
 */

const { taskStore } = require('./lib/utils/task-store')
const fs = require('fs').promises
const path = require('path')
const os = require('os')

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

async function runTest() {
  console.log('🧪 Starting merge fix test...\n')
  
  const testRepoPath = process.cwd() // Use current directory as test repo
  
  try {
    // Step 1: Create multiple tasks quickly to simulate concurrent creation
    console.log('📝 Creating 5 test tasks in quick succession...')
    const taskPromises = []
    
    for (let i = 1; i <= 5; i++) {
      const promise = taskStore.createTask(
        `Test task ${i} - ${new Date().toISOString()}`,
        testRepoPath,
        'none'
      )
      taskPromises.push(promise)
      // Small delay to simulate realistic timing
      await sleep(50)
    }
    
    const tasks = await Promise.all(taskPromises)
    console.log(`✅ Created ${tasks.length} tasks`)
    
    // Step 2: Verify all tasks are saved
    await sleep(1500) // Wait for debounced saves
    const savedTasks1 = await getTasksFromFile()
    console.log(`\n📁 Tasks in file after creation: ${savedTasks1.length}`)
    
    // Step 3: Simulate activity on tasks (this uses debounced saves)
    console.log('\n🔄 Simulating activity on tasks...')
    for (let i = 0; i < 3; i++) {
      taskStore.addOutput(tasks[i].id, {
        type: 'system',
        content: `Activity update ${i}`,
        timestamp: new Date()
      })
      await sleep(100)
    }
    
    // Step 4: Immediately merge a task (this is where the bug would occur)
    console.log('\n🔀 Merging task 1...')
    const taskToMerge = tasks[0]
    
    // First commit the task
    console.log('   - Committing task...')
    await taskStore.commitTask(taskToMerge.id, 'Test commit')
    
    // Then merge it
    console.log('   - Merging task...')
    await taskStore.mergeTask(taskToMerge.id)
    
    // Step 5: Check if all tasks are still there
    await sleep(500)
    const savedTasks2 = await getTasksFromFile()
    const activeTasks = savedTasks2.filter(t => t.status !== 'merged')
    
    console.log(`\n📊 Results:`)
    console.log(`   - Total tasks in file: ${savedTasks2.length}`)
    console.log(`   - Active tasks: ${activeTasks.length}`)
    console.log(`   - Merged tasks: ${savedTasks2.filter(t => t.status === 'merged').length}`)
    
    // Verify the fix worked
    if (savedTasks2.length === 5 && activeTasks.length === 4) {
      console.log('\n✅ SUCCESS: All tasks preserved after merge!')
      console.log('   The fix is working correctly.')
    } else {
      console.log('\n❌ FAILURE: Some tasks were lost!')
      console.log(`   Expected 5 total tasks, found ${savedTasks2.length}`)
      console.log(`   Expected 4 active tasks, found ${activeTasks.length}`)
    }
    
    // Step 6: Cleanup - remove test tasks
    console.log('\n🧹 Cleaning up test tasks...')
    for (const task of tasks) {
      try {
        await taskStore.removeTask(task.id)
      } catch (error) {
        // Task might already be removed or merged
      }
    }
    
  } catch (error) {
    console.error('\n❌ Test failed with error:', error)
  }
  
  console.log('\n✨ Test complete!')
  process.exit(0)
}

// Run the test
runTest().catch(console.error)