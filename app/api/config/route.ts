import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'

export async function GET() {
  const repoPath = taskStore.getRepoPath()
  return NextResponse.json({ repoPath })
}