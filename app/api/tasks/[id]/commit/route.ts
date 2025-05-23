import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await taskStore.commitTask(params.id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error committing task:', error)
    return NextResponse.json(
      { error: 'Failed to commit task' },
      { status: 500 }
    )
  }
}