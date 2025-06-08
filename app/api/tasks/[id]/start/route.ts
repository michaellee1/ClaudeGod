import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params
    const taskId = params.id
    
    if (!taskId) {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      )
    }
    
    await taskStore.startTask(taskId)
    
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error(`Error starting task:`, error)
    return NextResponse.json(
      { error: error.message || 'Failed to start task' },
      { status: 500 }
    )
  }
}