import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'
import { getTaskDiff } from '@/lib/utils/git'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const task = taskStore.getTask(id)
    
    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      )
    }
    
    if (!task.worktree) {
      return NextResponse.json(
        { error: 'No worktree path found for this task' },
        { status: 400 }
      )
    }
    
    // Generate the diff between the worktree and main branch
    const diff = await getTaskDiff(task.worktree, 'main')
    
    return NextResponse.json({ diff })
  } catch (error: any) {
    console.error('Error generating diff:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate diff' },
      { status: 500 }
    )
  }
}

// Ensure this route is always executed on every request (no static caching)
export const dynamic = 'force-dynamic'