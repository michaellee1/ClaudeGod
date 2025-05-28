import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'
import { validateGitRepo } from '@/lib/utils/git'
import { isSelfModification } from '@/lib/utils/self-modification-check'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'

export async function GET() {
  const tasks = taskStore.getTasks()
  return NextResponse.json(tasks)
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const prompt = formData.get('prompt') as string
    const repoPath = formData.get('repoPath') as string
    const thinkMode = formData.get('thinkMode') as string
    const imageFile = formData.get('image') as File | null
    const initiativeId = formData.get('initiativeId') as string | null
    const stepNumber = formData.get('stepNumber') as string | null
    const globalContext = formData.get('globalContext') as string | null
    
    if (!prompt || !repoPath) {
      return NextResponse.json(
        { error: 'Prompt and repoPath are required' },
        { status: 400 }
      )
    }
    
    // Validate thinkMode if provided
    const validThinkModes = ['no_review', 'none', 'level1', 'level2', 'planning']
    if (thinkMode && !validThinkModes.includes(thinkMode)) {
      return NextResponse.json(
        { error: 'Invalid think mode' },
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
    
    // Handle image upload if provided
    let imagePath: string | null = null
    if (imageFile) {
      // Validate file type and size
      const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
      if (!validTypes.includes(imageFile.type)) {
        return NextResponse.json(
          { error: 'Invalid image type. Supported types: JPEG, PNG, GIF, WebP' },
          { status: 400 }
        )
      }
      
      // 10MB limit
      if (imageFile.size > 10 * 1024 * 1024) {
        return NextResponse.json(
          { error: 'Image size must be less than 10MB' },
          { status: 400 }
        )
      }
      
      try {
        const bytes = await imageFile.arrayBuffer()
        const buffer = Buffer.from(bytes)
        
        // Create safe filename with UUID to prevent collisions and path traversal
        const fileExt = imageFile.name.split('.').pop()?.toLowerCase() || 'png'
        const safeFileName = `${randomUUID()}.${fileExt}`
        
        // Use system temp directory and create task-specific subdirectory
        const tempDir = join(tmpdir(), 'claude-god-images')
        await mkdir(tempDir, { recursive: true })
        
        const filePath = join(tempDir, safeFileName)
        imagePath = filePath
        
        await writeFile(filePath, buffer)
        console.log(`Image saved to: ${filePath}`)
      } catch (error) {
        console.error('Error saving image:', error)
        return NextResponse.json(
          { error: 'Failed to save image. Please try again.' },
          { status: 500 }
        )
      }
    }
    
    // Check for self-modification but allow it with warning
    const isSelfMod = isSelfModification(repoPath)
    if (isSelfMod) {
      console.warn('Self-modification detected - task will modify Claude Task Manager codebase')
    }
    
    // Modify prompt to include image reference if uploaded
    let finalPrompt = prompt
    if (imagePath) {
      // Insert image reference before think mode (which is already appended)
      const thinkModeRegex = /\. (Think hard|Think harder|Ultrathink)$/
      const thinkModeMatch = finalPrompt.match(thinkModeRegex)
      
      if (thinkModeMatch) {
        // Insert before think mode
        finalPrompt = finalPrompt.replace(thinkModeRegex, `. See image: ${imagePath}${thinkModeMatch[0]}`)
      } else {
        // No think mode, append at end
        finalPrompt = `${finalPrompt}. See image: ${imagePath}`
      }
    }
    
    // Build initiative parameters if provided
    const initiativeParams = (initiativeId || stepNumber !== null || globalContext) ? {
      ...(initiativeId && { initiativeId }),
      ...(stepNumber !== null && { stepNumber: parseInt(stepNumber, 10) }),
      ...(globalContext && { globalContext })
    } : undefined
    
    const task = await taskStore.createTask(finalPrompt, repoPath, thinkMode, initiativeParams)
    return NextResponse.json(task)
  } catch (error: any) {
    console.error('Error creating task:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create task' },
      { status: 500 }
    )
  }
}

export async function DELETE() {
  try {
    await taskStore.removeAllTasks()
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting all tasks:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete all tasks' },
      { status: 500 }
    )
  }
}

// Prevent static caching for tasks list and creation
export const dynamic = 'force-dynamic'