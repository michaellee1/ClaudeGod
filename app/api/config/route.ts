import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'
import { homedir } from 'os'

export async function GET() {
  let repoPath = taskStore.getRepoPath()
  
  // If no repo path is set, suggest the current working directory
  if (!repoPath) {
    repoPath = process.cwd()
  }
  
  return NextResponse.json({ 
    repoPath,
    suggestions: [
      process.cwd(),
      homedir() + '/projects',
      homedir() + '/code',
      homedir() + '/repos'
    ]
  })
}