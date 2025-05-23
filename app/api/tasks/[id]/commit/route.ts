import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const commitHash = await taskStore.commitTask(id)
    return NextResponse.json({ success: true, commitHash })
  } catch (error) {
    console.error('Error committing task:', error)
    return NextResponse.json(
      { error: 'Failed to commit task' },
      { status: 500 }
    )
  }
}