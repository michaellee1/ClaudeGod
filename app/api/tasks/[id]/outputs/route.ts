import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const outputs = taskStore.getOutputs(id)
  return NextResponse.json(outputs)
}

// Always run this route dynamically so every request gets the latest task output
export const dynamic = 'force-dynamic'