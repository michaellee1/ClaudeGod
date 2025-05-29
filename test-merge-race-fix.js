#!/usr/bin/env node

// Test script to verify the race condition fix
// This simulates the exact scenario where tasks were being lost

const http = require('http');

async function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3456,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: data ? JSON.parse(data) : null
          });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testMergeRaceCondition() {
  console.log('=== Testing Merge Race Condition Fix ===\n');
  
  try {
    // Step 1: Get initial task count
    console.log('1. Getting initial task count...');
    const initialResponse = await makeRequest('/api/tasks');
    const initialTasks = initialResponse.data || [];
    console.log(`   Initial task count: ${initialTasks.length}`);
    
    // Step 2: Create a test task to merge
    console.log('\n2. Creating a task to merge...');
    const createResponse = await makeRequest('/api/tasks', 'POST', {
      prompt: 'Test task for merge race condition',
      repoPath: process.cwd(),
      thinkMode: 'none'
    });
    
    if (createResponse.status !== 200) {
      throw new Error(`Failed to create task: ${JSON.stringify(createResponse.data)}`);
    }
    
    const taskToMerge = createResponse.data;
    console.log(`   Created task: ${taskToMerge.id}`);
    
    // Step 3: Wait for task to complete
    console.log('\n3. Waiting for task to complete...');
    let taskComplete = false;
    let attempts = 0;
    while (!taskComplete && attempts < 30) {
      await sleep(1000);
      const taskResponse = await makeRequest(`/api/tasks/${taskToMerge.id}`);
      if (taskResponse.data && taskResponse.data.status === 'finished') {
        taskComplete = true;
      }
      attempts++;
    }
    
    if (!taskComplete) {
      console.log('   Task did not complete in time, continuing anyway...');
    } else {
      console.log('   Task completed');
    }
    
    // Step 4: Start merging the task
    console.log('\n4. Starting merge operation...');
    const mergePromise = makeRequest(`/api/tasks/${taskToMerge.id}/merge`, 'POST');
    
    // Step 5: Immediately create new tasks (this is where the race condition occurred)
    console.log('\n5. Creating new tasks during merge...');
    const newTaskPromises = [];
    for (let i = 0; i < 3; i++) {
      await sleep(50); // Small delay between creations
      console.log(`   Creating task ${i + 1}/3...`);
      newTaskPromises.push(
        makeRequest('/api/tasks', 'POST', {
          prompt: `New task ${i + 1} created during merge`,
          repoPath: process.cwd(),
          thinkMode: 'none'
        })
      );
    }
    
    // Wait for merge to complete
    const mergeResult = await mergePromise;
    console.log(`\n6. Merge completed with status: ${mergeResult.status}`);
    
    // Wait for all new tasks to be created
    const newTasks = await Promise.all(newTaskPromises);
    console.log(`   All new tasks created: ${newTasks.map(r => r.data?.id || 'failed').join(', ')}`);
    
    // Step 7: Wait a bit for any debounced saves to complete
    console.log('\n7. Waiting for debounced saves to complete...');
    await sleep(2000);
    
    // Step 8: Verify all tasks are still present
    console.log('\n8. Verifying task count...');
    const finalResponse = await makeRequest('/api/tasks');
    const finalTasks = finalResponse.data || [];
    console.log(`   Final task count: ${finalTasks.length}`);
    
    // Check if any tasks were lost
    const expectedCount = initialTasks.length + 1 + 3; // initial + merged + 3 new
    const actualNewTasks = newTasks.filter(r => r.status === 200).length;
    const expectedMinimum = initialTasks.length + actualNewTasks; // At least the new tasks should be there
    
    console.log(`\n=== Results ===`);
    console.log(`Initial tasks: ${initialTasks.length}`);
    console.log(`Tasks created: ${actualNewTasks}`);
    console.log(`Final tasks: ${finalTasks.length}`);
    console.log(`Expected minimum: ${expectedMinimum}`);
    
    if (finalTasks.length < expectedMinimum) {
      console.log('\n❌ RACE CONDITION DETECTED: Some tasks were lost!');
      console.log(`Missing ${expectedMinimum - finalTasks.length} tasks`);
      
      // Check which tasks are missing
      const finalTaskIds = new Set(finalTasks.map(t => t.id));
      for (const response of newTasks) {
        if (response.status === 200 && response.data?.id) {
          if (!finalTaskIds.has(response.data.id)) {
            console.log(`   Missing task: ${response.data.id}`);
          }
        }
      }
    } else {
      console.log('\n✅ All tasks preserved - race condition appears to be fixed!');
    }
    
  } catch (error) {
    console.error('\nError during test:', error.message);
  }
}

// Run the test
console.log('Starting race condition test...');
console.log('Make sure the server is running on port 3456\n');

testMergeRaceCondition().catch(console.error);