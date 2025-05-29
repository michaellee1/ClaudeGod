import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'
import { mergeLock } from '@/lib/utils/merge-lock'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let taskId: string = ''
  
  try {
    const { id } = await params
    taskId = id
    
    // Check if another merge is in progress
    const currentOwner = mergeLock.getCurrentOwner()
    if (currentOwner && currentOwner !== taskId) {
      const queueLength = mergeLock.getQueueLength()
      return NextResponse.json(
        { 
          error: `Another merge is in progress (Task: ${currentOwner}). ${queueLength > 0 ? `${queueLength} task(s) waiting in queue.` : ''} Please wait...`,
          code: 'MERGE_IN_PROGRESS'
        },
        { status: 423 } // 423 Locked
      )
    }
    
    // Acquire the merge lock
    await mergeLock.acquireLock(taskId)
    
    try {
      await taskStore.mergeTask(taskId)
      return NextResponse.json({ success: true })
    } finally {
      // Always release the lock
      mergeLock.releaseLock(taskId)
    }
  } catch (error: any) {
    console.error('Error merging task:', error)
    
    // Make sure to release lock on error
    if (taskId && mergeLock.isLockedBy(taskId)) {
      mergeLock.releaseLock(taskId)
    }
    
    // Handle specific error types
    if (error.message?.startsWith('MERGE_CONFLICT_UNRESOLVED:')) {
      // Auto-resolution failed, return original conflict error
      const parts = error.message.split(':')
      const branchName = parts[1] || 'unknown'
      const details = parts.slice(2).join(':') || 'Unknown error'
      return NextResponse.json(
        { 
          error: `MERGE_CONFLICT:${branchName}`,
          details: `Automatic conflict resolution failed: ${details}`
        },
        { status: 409 } // 409 Conflict
      )
    }
    
    // For merge failures, include the full error details
    const errorMessage = error.message || 'Failed to merge task'
    const errorDetails: any = { error: errorMessage }
    
    // If the error includes manual command instructions, preserve them
    if (errorMessage.includes('You can try running this command manually:')) {
      errorDetails.manualCommand = errorMessage.split('You can try running this command manually:')[1]?.trim()
    }
    
    return NextResponse.json(errorDetails, { status: 500 })
  }
}