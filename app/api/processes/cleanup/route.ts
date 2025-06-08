import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'

export async function POST(request: NextRequest) {
  try {
    // In the new architecture, we just clear process managers
    // The iTerm sessions themselves remain open for the user to manage
    const cleared = await taskStore.clearAllProcessManagers()
    
    return NextResponse.json({
      success: true,
      message: `Cleared ${cleared} terminal references`
    })
  } catch (error) {
    console.error('Error clearing terminal references:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to clear terminal references' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    // Return active terminal sessions
    const activeSessions = taskStore.getActiveTerminalSessions()
    
    return NextResponse.json({
      success: true,
      sessions: activeSessions
    })
  } catch (error) {
    console.error('Error getting terminal sessions:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to get terminal sessions' },
      { status: 500 }
    )
  }
}