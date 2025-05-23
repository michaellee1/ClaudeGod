import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params
    await taskStore.mergeTask(taskId)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error merging task:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to merge task' },
      { status: 500 }
    )
  }
}