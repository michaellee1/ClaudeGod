#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

async function recoverFromOutputs() {
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
    
    // Create tasks from outputs
    const recoveredTasks = [];
    for (const taskId of taskIds) {
      const taskOutputs = outputs[taskId] || [];
      
      // Try to extract prompt from outputs
      let prompt = 'Recovered task - prompt unknown';
      const promptOutput = taskOutputs.find(o => o.content && o.content.includes('Task:'));
      if (promptOutput) {
        const match = promptOutput.content.match(/Task: (.+?)$/m);
        if (match) prompt = match[1];
      }
      
      // Determine status from outputs
      let status = 'finished';
      const lastOutput = taskOutputs[taskOutputs.length - 1];
      if (lastOutput) {
        if (lastOutput.content && lastOutput.content.includes('merged successfully')) {
          status = 'merged';
        } else if (lastOutput.content && lastOutput.content.includes('error')) {
          status = 'failed';
        }
      }
      
      // Create task object
      const task = {
        id: taskId,
        prompt: prompt,
        status: status,
        createdAt: taskOutputs[0]?.timestamp || new Date().toISOString(),
        repoPath: process.cwd(),
        worktree: `task-${taskId}`,
        worktreePath: `../claude-god-worktrees/task-${taskId}`,
        phase: 'done',
        recovered: true,
        lastActivity: lastOutput?.timestamp || new Date().toISOString()
      };
      
      recoveredTasks.push(task);
      console.log(`Recovered task ${taskId}: ${status}`);
    }
    
    // Save backup
    const backupPath = tasksFile + `.backup.recovery.${Date.now()}.json`;
    try {
      const currentData = await fs.readFile(tasksFile, 'utf-8');
      await fs.writeFile(backupPath, currentData);
      console.log(`Created backup: ${backupPath}`);
    } catch (e) {
      // No existing file
    }
    
    // Save recovered tasks
    await fs.writeFile(tasksFile, JSON.stringify(recoveredTasks, null, 2));
    console.log(`\nRecovered ${recoveredTasks.length} tasks successfully!`);
    console.log('Tasks should now appear in the UI.');
    
  } catch (error) {
    console.error('Error recovering tasks:', error);
    process.exit(1);
  }
}

recoverFromOutputs();