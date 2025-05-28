#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

async function recoverTasks() {
  const dataDir = path.join(os.homedir(), '.claude-god-data');
  const tasksFile = path.join(dataDir, 'tasks.json');
  const outputsFile = path.join(dataDir, 'outputs.json');
  
  try {
    // Read outputs file
    const outputsData = await fs.readFile(outputsFile, 'utf-8');
    const outputs = JSON.parse(outputsData);
    
    // Get all task IDs from outputs
    const taskIds = Object.keys(outputs);
    console.log(`Found ${taskIds.length} tasks in outputs file`);
    
    // Read current tasks
    let currentTasks = [];
    try {
      const tasksData = await fs.readFile(tasksFile, 'utf-8');
      currentTasks = JSON.parse(tasksData);
      if (!Array.isArray(currentTasks)) {
        currentTasks = [];
      }
    } catch (e) {
      console.log('No existing tasks file or empty');
    }
    
    // Create a map of existing task IDs
    const existingIds = new Set(currentTasks.map(t => t.id));
    console.log(`Current tasks: ${existingIds.size}, IDs: ${Array.from(existingIds).join(', ')}`);
    
    // Recover missing tasks
    const recoveredTasks = [];
    for (const taskId of taskIds) {
      if (!existingIds.has(taskId)) {
        console.log(`Checking task ${taskId}...`);
        // Check if worktree exists
        // Try with task- prefix first, then without
        let worktreePath = path.join('/Users/michaellee/Code/personal/claude-god/claude-god-worktrees', `task-${taskId}`);
        let worktreeExists = await fs.access(worktreePath).then(() => true).catch(() => false);
        
        if (!worktreeExists) {
          // Try without task- prefix
          worktreePath = path.join('/Users/michaellee/Code/personal/claude-god/claude-god-worktrees', taskId);
          worktreeExists = await fs.access(worktreePath).then(() => true).catch(() => false);
        }
        
        if (worktreeExists) {
          // Create a basic task object
          const task = {
            id: taskId,
            prompt: 'Recovered task - prompt unknown',
            status: 'finished',
            createdAt: new Date().toISOString(),
            repoPath: process.cwd(),
            worktree: `task-${taskId}`,
            worktreePath: worktreePath,
            phase: 'done',
            recovered: true
          };
          
          recoveredTasks.push(task);
          console.log(`Recovered task: ${taskId}`);
        }
      }
    }
    
    if (recoveredTasks.length > 0) {
      // Merge with existing tasks
      const allTasks = [...currentTasks, ...recoveredTasks];
      
      // Save backup
      const backupPath = tasksFile + `.backup.${Date.now()}.json`;
      if (currentTasks.length > 0) {
        await fs.writeFile(backupPath, JSON.stringify(currentTasks, null, 2));
        console.log(`Created backup: ${backupPath}`);
      }
      
      // Save recovered tasks
      await fs.writeFile(tasksFile, JSON.stringify(allTasks, null, 2));
      console.log(`Recovered ${recoveredTasks.length} tasks successfully`);
    } else {
      console.log('No tasks to recover');
    }
    
  } catch (error) {
    console.error('Error recovering tasks:', error);
    process.exit(1);
  }
}

recoverTasks();