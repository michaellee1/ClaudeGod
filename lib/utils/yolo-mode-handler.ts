import { taskStore } from './task-store'
import initiativeStore from './initiative-store'
import { Initiative } from '@/lib/types/initiative'
import { Task } from '@/lib/types/task'

export class YoloModeHandler {
  private static instance: YoloModeHandler
  private taskCompletionHandlers: Map<string, NodeJS.Timeout> = new Map()
  
  private constructor() {
    this.setupGlobalTaskListener()
  }
  
  static getInstance(): YoloModeHandler {
    if (!YoloModeHandler.instance) {
      YoloModeHandler.instance = new YoloModeHandler()
    }
    return YoloModeHandler.instance
  }
  
  private setupGlobalTaskListener() {
    // Monitor task updates via global broadcast
    if (typeof global !== 'undefined') {
      const originalBroadcast = (global as any).broadcastTaskUpdate
      
      (global as any).broadcastTaskUpdate = (taskId: string, task: Task) => {
        // Call original broadcast
        if (originalBroadcast) {
          originalBroadcast(taskId, task)
        }
        
        // Handle YOLO mode task completion
        if (task.initiativeId && task.status === 'finished') {
          this.handleTaskCompletion(task)
        }
      }
    }
  }
  
  private async handleTaskCompletion(completedTask: Task) {
    const initiative = initiativeStore.get(completedTask.initiativeId!)
    if (!initiative || !initiative.yoloMode) {
      return
    }
    
    console.log(`[YOLO] Task ${completedTask.id} completed for initiative ${completedTask.initiativeId}`)
    
    // Get all tasks for this initiative
    const initiativeTasks = taskStore.getTasksByInitiative(completedTask.initiativeId!)
    
    // Get current step tasks
    const currentStepTasks = initiativeTasks.filter(t => t.stepNumber === completedTask.stepNumber)
    
    // Check if all tasks in current step are finished
    const allStepTasksComplete = currentStepTasks.every(t => t.status === 'finished')
    
    if (allStepTasksComplete && currentStepTasks.length > 0) {
      console.log(`[YOLO] All tasks in step ${completedTask.stepNumber} are complete`)
      
      // Add a small delay to ensure all task outputs are saved
      setTimeout(async () => {
        try {
          // Auto-merge all tasks in the step
          await this.mergeStepTasks(currentStepTasks, initiative)
          
          // Submit next step if available
          if (initiative.yoloMode && !initiative.lastError) {
            await this.submitNextStep(initiative)
          }
        } catch (error) {
          console.error('[YOLO] Error in auto-progression:', error)
          await this.disableYoloMode(initiative.id, error instanceof Error ? error.message : 'Unknown error')
        }
      }, 2000) // 2 second delay
    }
  }
  
  private async mergeStepTasks(tasks: Task[], initiative: Initiative) {
    console.log(`[YOLO] Auto-merging ${tasks.length} tasks for step`)
    
    for (const task of tasks) {
      try {
        // Only merge if task has a commit
        if (task.commitHash) {
          console.log(`[YOLO] Merging task ${task.id}`)
          await taskStore.mergeTask(task.id)
          
          // Add small delay between merges to avoid git conflicts
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      } catch (error) {
        console.error(`[YOLO] Failed to merge task ${task.id}:`, error)
        throw error
      }
    }
  }
  
  private async submitNextStep(initiative: Initiative) {
    // Get the generated tasks
    const phaseData = await this.loadPhaseData(initiative.directory, 'tasks.json')
    if (!phaseData || !phaseData.steps) {
      console.log('[YOLO] No task steps found')
      return
    }
    
    const nextStepIndex = (initiative.currentStepIndex || 0) + 1
    if (nextStepIndex >= phaseData.steps.length) {
      console.log('[YOLO] All steps completed!')
      await initiativeStore.update(initiative.id, {
        status: 'completed',
        currentStepIndex: phaseData.steps.length - 1
      })
      return
    }
    
    const nextStep = phaseData.steps[nextStepIndex]
    console.log(`[YOLO] Submitting step ${nextStepIndex}: ${nextStep.name}`)
    
    try {
      // Submit the step via API
      const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/initiatives/${initiative.id}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stepNumber: nextStepIndex,
          // Submit all tasks in the step
          taskSelections: nextStep.tasks.map((_: any, index: number) => index)
        })
      })
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to submit step')
      }
      
      // Update current step index
      await initiativeStore.update(initiative.id, {
        currentStepIndex: nextStepIndex
      })
      
      console.log(`[YOLO] Successfully submitted step ${nextStepIndex}`)
    } catch (error) {
      console.error('[YOLO] Failed to submit next step:', error)
      throw error
    }
  }
  
  private async loadPhaseData(directory: string, filename: string): Promise<any> {
    try {
      const fs = require('fs/promises')
      const path = require('path')
      const filePath = path.join(directory, filename)
      const data = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(data)
    } catch (error) {
      console.error(`[YOLO] Failed to load ${filename}:`, error)
      return null
    }
  }
  
  private async disableYoloMode(initiativeId: string, error: string) {
    console.error(`[YOLO] Disabling YOLO mode for initiative ${initiativeId} due to error: ${error}`)
    
    await initiativeStore.update(initiativeId, {
      yoloMode: false,
      lastError: `YOLO mode disabled: ${error}`
    })
  }
  
  // Public method to manually trigger step submission
  async triggerStepSubmission(initiativeId: string) {
    const initiative = initiativeStore.get(initiativeId)
    if (!initiative || !initiative.yoloMode) {
      throw new Error('Initiative not found or YOLO mode not enabled')
    }
    
    await this.submitNextStep(initiative)
  }
}

// Initialize the singleton
export const yoloModeHandler = YoloModeHandler.getInstance()