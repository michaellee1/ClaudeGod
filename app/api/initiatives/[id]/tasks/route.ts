import { NextRequest, NextResponse } from 'next/server'
import initiativeStore from '@/lib/utils/initiative-store'
import { InitiativeManager } from '@/lib/utils/initiative-manager'
import { taskStore } from '@/lib/utils/task-store'
import { InitiativeTaskStep, InitiativePhase, InitiativeStatus } from '@/lib/types/initiative'
import { withErrorHandler } from '@/lib/utils/error-handler'
import { ValidationError, NotFoundError } from '@/lib/utils/errors'

export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: { id: string } }
) => {
    const { id } = params

    if (!id || typeof id !== 'string') {
      throw new ValidationError('Invalid initiative ID')
    }

    let body
    try {
      body = await request.json()
    } catch (error) {
      throw new ValidationError('Invalid JSON in request body')
    }
    
    const { stepNumber, taskSelections } = body

    // Validate step number
    if (typeof stepNumber !== 'number' || stepNumber < 0) {
      throw new ValidationError('Step number must be a non-negative integer', 'stepNumber')
    }

    // Validate task selections (optional)
    if (taskSelections !== undefined) {
      if (!Array.isArray(taskSelections)) {
        throw new ValidationError('Task selections must be an array', 'taskSelections')
      }
      
      // Validate each selection is a number
      for (const selection of taskSelections) {
        if (typeof selection !== 'number' || selection < 0) {
          throw new ValidationError('Task selections must be non-negative integers', 'taskSelections')
        }
      }
    }

    const initiative = initiativeStore.get(id)
    if (!initiative) {
      throw new NotFoundError('Initiative not found')
    }

    if (initiative.currentPhase !== InitiativePhase.READY) {
      throw new ValidationError(`Cannot convert to tasks in phase: ${initiative.currentPhase}. Initiative must be in 'ready' phase.`)
    }

    // Get the generated tasks
    const manager = InitiativeManager.getInstance()
    const allTasks = await manager.generateTasks(id)

    if (!allTasks || allTasks.length === 0) {
      throw new ValidationError('No tasks available for this initiative')
    }

    // Find the requested step (stepNumber is 0-based index in the UI but order is 1-based)
    const step = allTasks.find((s, index) => index === stepNumber || s.order === stepNumber + 1)
    if (!step) {
      throw new ValidationError(`Step ${stepNumber} not found. Available steps: 0-${allTasks.length - 1}`)
    }

    // Get the tasks to create based on selections or all tasks in step
    let tasksToCreate = step.tasks
    if (taskSelections !== undefined && taskSelections.length > 0) {
      tasksToCreate = taskSelections
        .map((index: number) => step.tasks[index])
        .filter((task: any) => task !== undefined)
      
      if (tasksToCreate.length === 0) {
        throw new ValidationError('No valid tasks found for the provided selections')
      }
    }

    // Validate repo path exists (should be set from the original task creation)
    const repoPath = taskStore.getRepoPath()
    if (!repoPath) {
      throw new ValidationError('Repository path not configured. Please create a task first.')
    }

    // Create tasks in the task system
    const createdTasks: any[] = []
    
    // Try to get global context from tasks.json
    let globalContext = initiative.objective // Default to initiative objective
    try {
      const tasksContent = await initiativeStore.loadPhaseFile(id, 'tasks.json')
      const parsed = JSON.parse(tasksContent)
      if (parsed.globalContext) {
        globalContext = parsed.globalContext
      }
    } catch (error) {
      console.log('Could not load global context from tasks.json, using initiative objective')
    }
    
    for (const task of tasksToCreate) {
      const taskPrompt = task.description || task.title // Use description or title as prompt
      try {
        const createdTask = await taskStore.createTask(
          taskPrompt,
          repoPath,
          'none', // Default think mode for initiative tasks - YOLO mode
          {
            initiativeId: id,
            stepNumber: stepNumber,
            globalContext: globalContext
          }
        )
        createdTasks.push({
          id: createdTask.id,
          prompt: createdTask.prompt,
          status: createdTask.status
        })
      } catch (error) {
        console.error(`Error creating task: ${taskPrompt}`, error)
        // Continue creating other tasks even if one fails
      }
    }

    // Update initiative tasks created count
    const currentCount = initiative.submittedTasks || 0
    await initiativeStore.update(id, { 
      submittedTasks: currentCount + createdTasks.length,
      status: InitiativeStatus.TASKS_SUBMITTED
    })

    return NextResponse.json({
      initiativeId: id,
      stepNumber: stepNumber,
      tasksCreated: createdTasks.length,
      totalTasksCreated: (initiative.submittedTasks || 0) + createdTasks.length,
      tasks: createdTasks,
      message: `Successfully created ${createdTasks.length} tasks from step ${stepNumber}`
    })
})

// Prevent static caching
export const dynamic = 'force-dynamic'