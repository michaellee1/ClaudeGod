import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    let message: string | undefined
    
    try {
      const body = await request.json()
      message = body.message
    } catch {
      // Body parsing is optional, continue without message
    }
    
    const commitHash = await taskStore.commitTask(id, message)
    return NextResponse.json({ success: true, commitHash })
  } catch (error) {
    console.error('Error committing task:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to commit task' },
      { status: 500 }
    )
  }
}