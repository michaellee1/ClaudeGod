#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// This test simulates the race condition that occurs when:
// 1. A task is merged (saveTasksImmediately is called)
// 2. addOutput is called, which triggers debouncedSave
// 3. New tasks are created between the immediate save and the debounced save
// 4. The debounced save might not include the new tasks

async function simulateRaceCondition() {
  const dataDir = path.join(os.homedir(), '.claude-god-data');
  const tasksFile = path.join(dataDir, 'tasks.json');
  const backupFile = tasksFile + '.race-test-backup';
  
  console.log('=== Simulating Race Condition ===');
  
  // Backup existing tasks
  try {
    await fs.copyFile(tasksFile, backupFile);
    console.log('✓ Backed up existing tasks');
  } catch (error) {
    console.log('No existing tasks to backup');
  }
  
  // Read current tasks
  let currentTasks = [];
  try {
    const data = await fs.readFile(tasksFile, 'utf-8');
    currentTasks = JSON.parse(data);
    console.log(`✓ Current task count: ${currentTasks.length}`);
  } catch (error) {
    console.log('No existing tasks found');
  }
  
  // Simulate the race condition
  console.log('\nSimulating race condition sequence:');
  
  // Step 1: Immediate save (like in mergeTask)
  console.log('1. Immediate save triggered (mergeTask)');
  const immediateSnapshot = [...currentTasks];
  
  // Step 2: Add a new task to simulate concurrent task creation
  const newTask = {
    id: 'test-' + Math.random().toString(36).substring(7),
    prompt: 'Test task created during race condition',
    status: 'starting',
    createdAt: new Date().toISOString()
  };
  currentTasks.push(newTask);
  console.log(`2. New task created: ${newTask.id}`);
  
  // Step 3: Simulate debounced save overwriting with old data
  console.log('3. Debounced save fires (from addOutput)...');
  
  // In the bug scenario, the debounced save might use stale data
  // This demonstrates how tasks can be lost
  console.log('\nPotential outcomes:');
  console.log(`- Immediate save had ${immediateSnapshot.length} tasks`);
  console.log(`- New task was added, total should be ${currentTasks.length} tasks`);
  console.log('- If debounced save uses stale data, new task will be lost');
  
  // Restore backup
  try {
    await fs.copyFile(backupFile, tasksFile);
    await fs.unlink(backupFile);
    console.log('\n✓ Restored original tasks');
  } catch (error) {
    console.log('Could not restore backup');
  }
  
  console.log('\n=== Analysis Complete ===');
  console.log('\nThe race condition occurs because:');
  console.log('1. saveTasksImmediately() saves the current state');
  console.log('2. addOutput() is called, triggering debouncedSave()');
  console.log('3. New tasks are created between these saves');
  console.log('4. The debounced save might capture a stale state');
  console.log('5. Result: newly created tasks are lost');
}

simulateRaceCondition().catch(console.error);