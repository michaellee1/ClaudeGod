import { NextRequest, NextResponse } from 'next/server'
import { taskStore } from '@/lib/utils/task-store'
import { validateGitRepo } from '@/lib/utils/git'
import { isSelfModification } from '@/lib/utils/self-modification-check'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { tmpdir, homedir } from 'os'

export async function GET() {
  const tasks = taskStore.getTasks()
  return NextResponse.json(tasks)
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const prompt = formData.get('prompt') as string
    let repoPath = formData.get('repoPath') as string
    const mode = formData.get('mode') as string
    const imageFile = formData.get('image') as File | null
    
    if (!prompt || !repoPath) {
      return NextResponse.json(
        { error: 'Prompt and repoPath are required' },
        { status: 400 }
      )
    }
    
    // Handle tilde expansion
    if (repoPath.startsWith('~')) {
      repoPath = repoPath.replace(/^~/, homedir())
    }
    
    // Validate mode if provided
    const validModes = ['planning', 'edit']
    if (mode && !validModes.includes(mode)) {
      return NextResponse.json(
        { error: 'Invalid mode. Valid modes are: planning, edit' },
        { status: 400 }
      )
    }
    
    // Validate the repo path
    console.log('Validating repo path:', repoPath)
    const isValidRepo = await validateGitRepo(repoPath)
    if (!isValidRepo) {
      console.error('Invalid git repository path:', repoPath)
      return NextResponse.json(
        { error: `Invalid git repository path: ${repoPath}. Please ensure the path exists and is a git repository.` },
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
      finalPrompt = `${finalPrompt}. See image: ${imagePath}`
    }
    
    const task = await taskStore.createTask(finalPrompt, repoPath, mode)
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