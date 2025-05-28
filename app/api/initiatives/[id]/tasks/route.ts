import { NextRequest, NextResponse } from 'next/server'
import initiativeStore from '@/lib/utils/initiative-store'
import { InitiativeManager } from '@/lib/utils/initiative-manager'
import { taskStore } from '@/lib/utils/task-store'
import { InitiativeTaskStep } from '@/lib/types/initiative'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { error: 'Invalid initiative ID' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { stepNumber, taskSelections } = body

    // Validate step number
    if (typeof stepNumber !== 'number' || stepNumber < 0) {
      return NextResponse.json(
        { error: 'Step number must be a non-negative integer' },
        { status: 400 }
      )
    }

    // Validate task selections (optional)
    if (taskSelections !== undefined) {
      if (!Array.isArray(taskSelections)) {
        return NextResponse.json(
          { error: 'Task selections must be an array' },
          { status: 400 }
        )
      }
      
      // Validate each selection is a number
      for (const selection of taskSelections) {
        if (typeof selection !== 'number' || selection < 0) {
          return NextResponse.json(
            { error: 'Task selections must be non-negative integers' },
            { status: 400 }
          )
        }
      }
    }

    const initiative = initiativeStore.get(id)
    if (!initiative) {
      return NextResponse.json(
        { error: 'Initiative not found' },
        { status: 404 }
      )
    }

    if (initiative.phase !== 'ready') {
      return NextResponse.json(
        { error: `Cannot convert to tasks in phase: ${initiative.phase}. Initiative must be in 'ready' phase.` },
        { status: 400 }
      )
    }

    // Get the generated tasks
    const manager = InitiativeManager.getInstance()
    const allTasks = await manager.generateTasks(id)

    if (!allTasks || allTasks.length === 0) {
      return NextResponse.json(
        { error: 'No tasks available for this initiative' },
        { status: 400 }
      )
    }

    // Find the requested step
    const step = allTasks.find(s => s.order === stepNumber)
    if (!step) {
      return NextResponse.json(
        { error: `Step ${stepNumber} not found. Available steps: ${allTasks.map(s => s.order).join(', ')}` },
        { status: 400 }
      )
    }

    // Get the tasks to create based on selections or all tasks in step
    let tasksToCreate = step.tasks
    if (taskSelections !== undefined && taskSelections.length > 0) {
      tasksToCreate = taskSelections
        .map((index: number) => step.tasks[index])
        .filter((task: any) => task !== undefined)
      
      if (tasksToCreate.length === 0) {
        return NextResponse.json(
          { error: 'No valid tasks found for the provided selections' },
          { status: 400 }
        )
      }
    }

    // Validate repo path exists (should be set from the original task creation)
    const repoPath = taskStore.getRepoPath()
    if (!repoPath) {
      return NextResponse.json(
        { error: 'Repository path not configured. Please create a task first.' },
        { status: 400 }
      )
    }

    // Create tasks in the task system
    const createdTasks: any[] = []
    const globalContext = initiative.objective // Use the initiative objective as global context
    
    for (const task of tasksToCreate) {
      const taskPrompt = task.description || task.title // Use description or title as prompt
      try {
        const task = await taskStore.createTask(
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
          id: task.id,
          prompt: task.prompt,
          status: task.status
        })
      } catch (error) {
        console.error(`Error creating task: ${taskPrompt}`, error)
        // Continue creating other tasks even if one fails
      }
    }

    // Update initiative tasks created count
    // Track tasks created in phase data
    const currentCount = (initiative.phaseData?.tasksCreated as number) || 0
    await initiativeStore.update(id, { 
      phaseData: { ...initiative.phaseData, tasksCreated: currentCount + createdTasks.length }
    })

    return NextResponse.json({
      initiativeId: id,
      stepNumber: stepNumber,
      tasksCreated: createdTasks.length,
      totalTasksCreated: ((initiative.phaseData?.tasksCreated as number) || 0) + createdTasks.length,
      tasks: createdTasks,
      message: `Successfully created ${createdTasks.length} tasks from step ${stepNumber}`
    })
  } catch (error: any) {
    console.error('Error converting to tasks:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to convert to tasks' },
      { status: 500 }
    )
  }
}

// Prevent static caching
export const dynamic = 'force-dynamic'