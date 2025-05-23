import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { prompt } = await request.json()
    
    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      )
    }
    
    await taskStore.sendPromptToTask(id, prompt)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error sending prompt:', error)
    return NextResponse.json(
      { error: 'Failed to send prompt' },
      { status: 500 }
    )
  }
}