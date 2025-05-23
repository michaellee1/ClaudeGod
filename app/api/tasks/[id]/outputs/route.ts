import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const outputs = taskStore.getOutputs(params.id)
  return NextResponse.json(outputs)
}