import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const task = taskStore.getTask(id)
  
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await taskStore.cleanupTask(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error removing task:', error)
    return NextResponse.json(
      { error: 'Failed to remove task' },
      { status: 500 }
    )
  }
}

// Ensure this route is always executed on every request (no static caching)
export const dynamic = 'force-dynamic'