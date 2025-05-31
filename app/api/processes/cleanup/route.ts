import { NextRequest, NextResponse } from 'next/server'
import { processStateManager } from '@/lib/utils/process-state'

export async function POST(request: NextRequest) {
  try {
    const killed = await processStateManager.killAllProcesses()
    
    return NextResponse.json({
      success: true,
      message: `Killed ${killed} tracked processes`
    })
  } catch (error) {
    console.error('Error killing processes:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to kill processes' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const processes = await processStateManager.getAllProcesses()
    
    return NextResponse.json({
      success: true,
      processes: processes.map(p => ({
        pid: p.pid,
        taskId: p.taskId,
        phase: p.phase,
        startTime: p.startTime
      }))
    })
  } catch (error) {
    console.error('Error getting processes:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to get processes' },
      { status: 500 }
    )
  }
}