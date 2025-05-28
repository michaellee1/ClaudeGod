import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { InitiativeQuestion, InitiativePlan, InitiativeTaskStep } from '@/lib/types/initiative'
import { 
  validateQuestions, 
  validatePlan, 
  validateFilePath,
  VALIDATION_LIMITS 
} from './initiative-validation'

// Lock mechanism for concurrent file operations
const fileLocks = new Map<string, Promise<void>>()

async function withFileLock<T>(filepath: string, operation: () => Promise<T>): Promise<T> {
  // Wait for any existing operation on this file to complete
  const existingLock = fileLocks.get(filepath)
  if (existingLock) {
    await existingLock
  }

  // Create a new lock for this operation
  let releaseLock: () => void
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  fileLocks.set(filepath, lockPromise)

  try {
    return await operation()
  } finally {
    // Release the lock and remove it from the map
    releaseLock!()
    fileLocks.delete(filepath)
  }
}

// Atomic write with backup
async function atomicWrite(filepath: string, content: string): Promise<void> {
  const tempPath = `${filepath}.tmp`
  const backupPath = `${filepath}.bak`
  
  try {
    // Write to temporary file
    await fs.writeFile(tempPath, content, 'utf-8')
    
    // Create backup if original exists
    try {
      await fs.access(filepath)
      await fs.copyFile(filepath, backupPath)
    } catch {
      // Original doesn't exist, no backup needed
    }
    
    // Atomically replace original with temp
    await fs.rename(tempPath, filepath)
    
    // Remove backup after successful write
    try {
      await fs.unlink(backupPath)
    } catch {
      // Backup removal failed, not critical
    }
  } catch (error) {
    // Restore from backup if available
    try {
      await fs.access(backupPath)
      await fs.rename(backupPath, filepath)
    } catch {
      // No backup to restore
    }
    
    // Clean up temp file
    try {
      await fs.unlink(tempPath)
    } catch {
      // Temp file cleanup failed, not critical
    }
    
    throw error
  }
}

// Base directory for initiatives
const getInitiativesBaseDir = (): string => {
  return path.join(os.homedir(), '.claude-god-data', 'initiatives')
}

// Get directory path for a specific initiative
export function getInitiativeDir(id: string): string {
  return path.join(getInitiativesBaseDir(), id)
}

// Ensure initiative directory exists
export async function ensureInitiativeDirectory(id: string): Promise<void> {
  const dir = getInitiativeDir(id)
  try {
    await fs.mkdir(dir, { recursive: true })
    // Set appropriate permissions (read/write for owner only)
    await fs.chmod(dir, 0o700)
  } catch (error) {
    console.error(`Error creating initiative directory ${dir}:`, error)
    throw new Error(`Failed to create initiative directory: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// Save questions file
export async function saveQuestions(id: string, questions: InitiativeQuestion[]): Promise<void> {
  const filepath = path.join(getInitiativeDir(id), 'questions.json')
  
  // Validate questions using validation utility
  const validationErrors = validateQuestions(questions)
  if (validationErrors.length > 0) {
    throw new Error(`Question validation failed: ${validationErrors[0].message}`)
  }
  
  await withFileLock(filepath, async () => {
    await ensureInitiativeDirectory(id)
    const content = JSON.stringify(questions, null, 2)
    
    // Check file size limit
    if (Buffer.byteLength(content, 'utf-8') > 1024 * 1024) { // 1MB limit for JSON files
      throw new Error('Questions file exceeds 1MB limit')
    }
    
    await atomicWrite(filepath, content)
  })
}

// Save answers file
export async function saveAnswers(id: string, answers: Record<string, string>): Promise<void> {
  const filepath = path.join(getInitiativeDir(id), 'answers.json')
  
  // Validate answers
  if (typeof answers !== 'object' || answers === null) {
    throw new Error('Answers must be an object')
  }
  
  // Validate each answer length
  for (const [key, value] of Object.entries(answers)) {
    if (typeof value !== 'string') {
      throw new Error(`Answer for question ${key} must be a string`)
    }
    if (value.length > VALIDATION_LIMITS.ANSWER_MAX_LENGTH) {
      throw new Error(`Answer for question ${key} exceeds ${VALIDATION_LIMITS.ANSWER_MAX_LENGTH} character limit`)
    }
  }
  
  await withFileLock(filepath, async () => {
    await ensureInitiativeDirectory(id)
    const content = JSON.stringify(answers, null, 2)
    
    // Check file size limit
    if (Buffer.byteLength(content, 'utf-8') > 1024 * 1024) { // 1MB limit for JSON files
      throw new Error('Answers file exceeds 1MB limit')
    }
    
    await atomicWrite(filepath, content)
  })
}

// Save research needs document
export async function saveResearchNeeds(id: string, content: string): Promise<void> {
  const filepath = path.join(getInitiativeDir(id), 'research_needs.md')
  
  // Validate content
  if (typeof content !== 'string') {
    throw new Error('Research needs content must be a string')
  }
  
  if (content.length < VALIDATION_LIMITS.RESEARCH_MIN_LENGTH) {
    throw new Error(`Research needs content must be at least ${VALIDATION_LIMITS.RESEARCH_MIN_LENGTH} characters`)
  }
  
  if (content.length > VALIDATION_LIMITS.RESEARCH_MAX_LENGTH) {
    throw new Error(`Research needs content exceeds ${VALIDATION_LIMITS.RESEARCH_MAX_LENGTH} character limit`)
  }
  
  await withFileLock(filepath, async () => {
    await ensureInitiativeDirectory(id)
    await atomicWrite(filepath, content)
  })
}

// Save research results document
export async function saveResearchResults(id: string, content: string): Promise<void> {
  const filepath = path.join(getInitiativeDir(id), 'research_results.md')
  
  // Validate content
  if (typeof content !== 'string') {
    throw new Error('Research results content must be a string')
  }
  
  if (content.length < VALIDATION_LIMITS.RESEARCH_MIN_LENGTH) {
    throw new Error(`Research results content must be at least ${VALIDATION_LIMITS.RESEARCH_MIN_LENGTH} characters`)
  }
  
  if (content.length > VALIDATION_LIMITS.RESEARCH_MAX_LENGTH) {
    throw new Error(`Research results content exceeds ${VALIDATION_LIMITS.RESEARCH_MAX_LENGTH} character limit`)
  }
  
  await withFileLock(filepath, async () => {
    await ensureInitiativeDirectory(id)
    await atomicWrite(filepath, content)
  })
}

// Save plan file
export async function savePlan(id: string, plan: InitiativePlan): Promise<void> {
  const filepath = path.join(getInitiativeDir(id), 'plan.json')
  
  // Validate plan using validation utility
  const validationErrors = validatePlan(plan)
  if (validationErrors.length > 0) {
    throw new Error(`Plan validation failed: ${validationErrors[0].message}`)
  }
  
  await withFileLock(filepath, async () => {
    await ensureInitiativeDirectory(id)
    const content = JSON.stringify(plan, null, 2)
    
    // Check file size limit
    if (Buffer.byteLength(content, 'utf-8') > 1024 * 1024) { // 1MB limit for JSON files
      throw new Error('Plan file exceeds 1MB limit')
    }
    
    await atomicWrite(filepath, content)
  })
}

// Save task steps file
export async function saveTaskSteps(id: string, taskSteps: InitiativeTaskStep[]): Promise<void> {
  const filepath = path.join(getInitiativeDir(id), 'task_steps.json')
  
  // Validate task steps
  if (!Array.isArray(taskSteps)) {
    throw new Error('Task steps must be an array')
  }
  
  for (const step of taskSteps) {
    if (!step.id || !step.name || typeof step.order !== 'number') {
      throw new Error('Each task step must have id, name, and order')
    }
  }
  
  await withFileLock(filepath, async () => {
    await ensureInitiativeDirectory(id)
    const content = JSON.stringify(taskSteps, null, 2)
    await atomicWrite(filepath, content)
  })
}

// Interface for all phase files
export interface InitiativeContext {
  questions?: InitiativeQuestion[]
  answers?: Record<string, string>
  researchNeeds?: string
  researchResults?: string
  plan?: InitiativePlan
  taskSteps?: InitiativeTaskStep[]
}

// Load all phase files for an initiative
export async function loadAllPhaseFiles(id: string): Promise<InitiativeContext> {
  const dir = getInitiativeDir(id)
  const context: InitiativeContext = {}
  
  // Helper to safely read JSON files
  async function readJsonFile<T>(filename: string): Promise<T | undefined> {
    try {
      const filepath = path.join(dir, filename)
      const content = await fs.readFile(filepath, 'utf-8')
      return JSON.parse(content)
    } catch (error) {
      // File doesn't exist or is invalid - that's okay
      return undefined
    }
  }
  
  // Helper to safely read text files
  async function readTextFile(filename: string): Promise<string | undefined> {
    try {
      const filepath = path.join(dir, filename)
      return await fs.readFile(filepath, 'utf-8')
    } catch (error) {
      // File doesn't exist - that's okay
      return undefined
    }
  }
  
  // Load all files concurrently
  const [questions, answers, researchNeeds, researchResults, plan, taskSteps] = await Promise.all([
    readJsonFile<InitiativeQuestion[]>('questions.json'),
    readJsonFile<Record<string, string>>('answers.json'),
    readTextFile('research_needs.md'),
    readTextFile('research_results.md'),
    readJsonFile<InitiativePlan>('plan.json'),
    readJsonFile<InitiativeTaskStep[]>('task_steps.json')
  ])
  
  // Only add defined values to context
  if (questions) context.questions = questions
  if (answers) context.answers = answers
  if (researchNeeds) context.researchNeeds = researchNeeds
  if (researchResults) context.researchResults = researchResults
  if (plan) context.plan = plan
  if (taskSteps) context.taskSteps = taskSteps
  
  return context
}

// Create a backup of an initiative directory
export async function backupInitiative(id: string): Promise<string> {
  const sourceDir = getInitiativeDir(id)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = path.join(getInitiativesBaseDir(), `.backups`, id, timestamp)
  
  try {
    // Ensure backup directory exists
    await fs.mkdir(path.dirname(backupDir), { recursive: true })
    
    // Copy entire directory
    await fs.cp(sourceDir, backupDir, { recursive: true })
    
    return backupDir
  } catch (error) {
    console.error(`Error backing up initiative ${id}:`, error)
    throw new Error(`Failed to backup initiative: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// Restore an initiative from backup
export async function restoreInitiative(id: string, backupPath: string): Promise<void> {
  const targetDir = getInitiativeDir(id)
  
  try {
    // Create a backup of current state before restoring
    await backupInitiative(id)
    
    // Remove current directory
    await fs.rm(targetDir, { recursive: true, force: true })
    
    // Copy backup to target
    await fs.cp(backupPath, targetDir, { recursive: true })
  } catch (error) {
    console.error(`Error restoring initiative ${id} from ${backupPath}:`, error)
    throw new Error(`Failed to restore initiative: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}