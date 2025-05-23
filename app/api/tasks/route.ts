import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'
import { validateGitRepo } from '@/lib/utils/git'
import { isSelfModification } from '@/lib/utils/self-modification-check'

export async function GET() {
  const tasks = taskStore.getTasks()
  return NextResponse.json(tasks)
}

export async function POST(request: NextRequest) {
  try {
    const { prompt, repoPath } = await request.json()
    
    if (!prompt || !repoPath) {
      return NextResponse.json(
        { error: 'Prompt and repoPath are required' },
        { status: 400 }
      )
    }
    
    // Validate the repo path
    const isValidRepo = await validateGitRepo(repoPath)
    if (!isValidRepo) {
      return NextResponse.json(
        { error: 'Invalid git repository path' },
        { status: 400 }
      )
    }
    
    // Check for self-modification but allow it with warning
    const isSelfMod = isSelfModification(repoPath)
    if (isSelfMod) {
      console.warn('Self-modification detected - task will modify Claude Task Manager codebase')
    }
    
    const task = await taskStore.createTask(prompt, repoPath)
    return NextResponse.json(task)
  } catch (error: any) {
    console.error('Error creating task:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create task' },
      { status: 500 }
    )
  }
}

// Prevent static caching for tasks list and creation
export const dynamic = 'force-dynamic'