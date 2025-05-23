import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await taskStore.startPreview(id)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error starting preview:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to start preview' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await taskStore.stopPreview(id)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error stopping preview:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to stop preview' },
      { status: 500 }
    )
  }
}