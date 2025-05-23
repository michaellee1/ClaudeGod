import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const task = taskStore.getTask(params.id)
  
  if (!task) {
    return NextResponse.json(
      { error: 'Task not found' },
      { status: 404 }
    )
  }
  
  return NextResponse.json(task)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await taskStore.removeTask(params.id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing task:', error)
    return NextResponse.json(
      { error: 'Failed to remove task' },
      { status: 500 }
    )
  }
}