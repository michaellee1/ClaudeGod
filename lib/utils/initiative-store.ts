import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { Initiative, InitiativePhase, InitiativeStatus } from '../types/initiative'
import { FileRecovery } from './file-recovery'
import { FileLock } from './file-lock'

class InitiativeStore {
  private static instance: InitiativeStore
  private initiatives: Map<string, Initiative> = new Map()
  private dataDir: string = path.join(os.homedir(), '.claude-god-data')
  private initiativesDir: string = path.join(os.homedir(), '.claude-god-data', 'initiatives')
  private initiativesFile: string = path.join(os.homedir(), '.claude-god-data', 'initiatives.json')
  private readonly MAX_CONCURRENT_INITIATIVES = 5
  private saveDebounceTimer: NodeJS.Timeout | null = null
  private fileRecovery: FileRecovery = new FileRecovery()
  private broadcastDebounceTimers: Map<string, NodeJS.Timeout> = new Map()

  private constructor() {
    // Clear any stale locks on startup
    FileLock.clearAllLocks()
    this.initializeDataDirs()
    this.loadInitiatives()
  }

  static getInstance(): InitiativeStore {
    if (!InitiativeStore.instance) {
      InitiativeStore.instance = new InitiativeStore()
    }
    return InitiativeStore.instance
  }

  private async initializeDataDirs() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true })
      await fs.mkdir(this.initiativesDir, { recursive: true })
    } catch (error) {
      console.error('Error creating data directories:', error)
    }
  }

  private async loadInitiatives() {
    try {
      const initiatives = await this.fileRecovery.readJsonFile<Initiative[]>(this.initiativesFile)
      
      // Convert array back to Map and restore Date objects
      for (const initiative of initiatives) {
        initiative.createdAt = new Date(initiative.createdAt)
        // Handle missing updatedAt field for older initiatives
        initiative.updatedAt = initiative.updatedAt ? new Date(initiative.updatedAt) : new Date(initiative.createdAt || new Date())
        if (initiative.completedAt) {
          initiative.completedAt = new Date(initiative.completedAt)
        }
        this.initiatives.set(initiative.id, initiative)
      }
      
      console.log(`Loaded ${this.initiatives.size} initiatives from disk`)
    } catch (error: any) {
      if (error.message?.includes('File not found')) {
        console.log('No existing initiatives found, starting fresh')
      } else {
        console.error('Error loading initiatives:', error)
        // Try to recover from backup if available
        try {
          const backupPath = `${this.initiativesFile}.backup`
          if (await this.fileRecovery.fileExists(backupPath)) {
            console.log('Attempting to recover from backup...')
            const backup = await this.fileRecovery.readJsonFile<Initiative[]>(backupPath)
            for (const initiative of backup) {
              initiative.createdAt = new Date(initiative.createdAt)
              initiative.updatedAt = initiative.updatedAt ? new Date(initiative.updatedAt) : new Date(initiative.createdAt || new Date())
              if (initiative.completedAt) {
                initiative.completedAt = new Date(initiative.completedAt)
              }
              this.initiatives.set(initiative.id, initiative)
            }
            console.log(`Recovered ${this.initiatives.size} initiatives from backup`)
          }
        } catch (backupError) {
          console.error('Failed to recover from backup:', backupError)
        }
      }
    }
  }

  private async saveInitiatives() {
    try {
      // Use file locking for the main initiatives file
      await FileLock.withLock(this.initiativesFile, async () => {
        // Create backup before saving
        if (await this.fileRecovery.fileExists(this.initiativesFile)) {
          await fs.copyFile(this.initiativesFile, `${this.initiativesFile}.backup`)
        }
        
        // Convert Map to array for JSON serialization
        const initiativesArray = Array.from(this.initiatives.values())
        await this.fileRecovery.writeJsonFile(this.initiativesFile, initiativesArray)
      }, 5000)
    } catch (error) {
      console.error('Error saving initiatives:', error)
      throw error // Re-throw to handle in callers
    }
  }

  private debouncedSave() {
    // Clear existing timer
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer)
    }
    
    // Set new timer to save after 1 second of no changes
    this.saveDebounceTimer = setTimeout(async () => {
      try {
        await this.saveInitiatives()
      } catch (error) {
        console.error('Error in debouncedSave:', error)
        // Broadcast error to WebSocket clients if available
        if (typeof global !== 'undefined' && (global as any).broadcastError) {
          (global as any).broadcastError({
            type: 'save-error',
            message: 'Failed to save initiatives',
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }, 1000)
  }

  private generateId(): string {
    // Generate short alphanumeric ID matching task ID format
    let id: string
    do {
      id = Math.random().toString(36).substring(7)
    } while (this.initiatives.has(id))
    return id
  }

  private broadcastInitiativeUpdate(initiativeId: string, initiative: Initiative) {
    // Broadcast via WebSocket if available
    if (typeof global !== 'undefined' && (global as any).broadcastInitiativeUpdate) {
      // Cancel any pending broadcast for this initiative
      const existingTimer = this.broadcastDebounceTimers.get(initiativeId)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }
      
      // Debounce broadcasts per initiative to prevent duplicates
      const timer = setTimeout(() => {
        (global as any).broadcastInitiativeUpdate(initiative)
        this.broadcastDebounceTimers.delete(initiativeId)
      }, 100)
      
      this.broadcastDebounceTimers.set(initiativeId, timer)
    }
  }

  async createInitiative(objective: string, repositoryPath?: string): Promise<Initiative> {
    // Use file lock to prevent concurrent creation with 5 second timeout
    return await FileLock.withLock(this.initiativesFile, async () => {
      // Re-check concurrent initiative limit inside lock
      const activeInitiatives = Array.from(this.initiatives.values()).filter(
        i => i.status !== InitiativeStatus.COMPLETED && i.status !== InitiativeStatus.TASKS_SUBMITTED
      )
      if (activeInitiatives.length >= this.MAX_CONCURRENT_INITIATIVES) {
        throw new Error(`Resource limit reached: ${activeInitiatives.length}/${this.MAX_CONCURRENT_INITIATIVES} concurrent initiatives`)
      }

      // Validate repository path if provided
      if (repositoryPath) {
        const resolvedPath = path.resolve(repositoryPath)
        
        try {
          const stats = await fs.stat(resolvedPath)
          if (!stats.isDirectory()) {
            throw new Error(`Repository path is not a directory: ${repositoryPath}`)
          }
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            throw new Error(`Repository path does not exist: ${repositoryPath}`)
          }
          throw error
        }
        
        // Check if it's a git repository
        try {
          await fs.access(path.join(resolvedPath, '.git'))
        } catch {
          throw new Error(`Repository path is not a git repository: ${repositoryPath}`)
        }
        
        // Use the resolved absolute path
        repositoryPath = resolvedPath
      }

      const id = this.generateId()
      const directory = path.join(this.initiativesDir, id)
      
      // Create initiative directory
      try {
        await fs.mkdir(directory, { recursive: true })
      } catch (error) {
        console.error(`Error creating initiative directory ${directory}:`, error)
        throw new Error('Failed to create initiative directory')
      }

      const initiative: Initiative = {
        id,
        objective,
        repositoryPath,
        status: InitiativeStatus.EXPLORING,
        currentPhase: InitiativePhase.EXPLORATION,
        createdAt: new Date(),
        updatedAt: new Date(),
        yoloMode: true,
        currentStepIndex: 0
      }

      this.initiatives.set(id, initiative)
      
      try {
        // Save immediately and wait for completion to avoid race conditions
        await this.saveInitiatives()
        // Only broadcast after save is complete
        this.broadcastInitiativeUpdate(id, initiative)
      } catch (error) {
        // If save failed, remove from memory to maintain consistency
        this.initiatives.delete(id)
        console.error(`Failed to save initiative ${id}, rolled back:`, error)
        throw error
      }

      console.log(`Created initiative ${id} with objective: ${objective}`)
      return initiative
    })
  }

  get(id: string): Initiative | undefined {
    return this.initiatives.get(id)
  }

  getAll(): Initiative[] {
    return Array.from(this.initiatives.values())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  async update(id: string, updates: Partial<Initiative>): Promise<Initiative> {
    const initiative = this.initiatives.get(id)
    if (!initiative) {
      throw new Error(`Initiative ${id} not found`)
    }

    // Update initiative with new data
    const updatedInitiative = {
      ...initiative,
      ...updates,
      updatedAt: new Date()
    }

    this.initiatives.set(id, updatedInitiative)
    // For critical updates like status changes, save immediately
    if (updates.status || updates.currentPhase || updates.processId) {
      await this.saveInitiatives()
    } else {
      this.debouncedSave()
    }
    this.broadcastInitiativeUpdate(id, updatedInitiative)

    return updatedInitiative
  }

  async updatePhase(id: string, phase: string, data?: any): Promise<void> {
    const initiative = this.initiatives.get(id)
    if (!initiative) {
      throw new Error(`Initiative ${id} not found`)
    }

    // Map phase string to enum values
    const phaseMap: Record<string, InitiativePhase> = {
      'exploration': InitiativePhase.EXPLORATION,
      'questions': InitiativePhase.QUESTIONS,
      'research_prep': InitiativePhase.RESEARCH_PREP,
      'research_review': InitiativePhase.RESEARCH_REVIEW,
      'task_generation': InitiativePhase.TASK_GENERATION,
      'ready': InitiativePhase.READY
    }

    const statusMap: Record<string, InitiativeStatus> = {
      'exploration': InitiativeStatus.EXPLORING,
      'questions': InitiativeStatus.AWAITING_ANSWERS,
      'research_prep': InitiativeStatus.RESEARCHING,
      'research_review': InitiativeStatus.AWAITING_RESEARCH,
      'task_generation': InitiativeStatus.PLANNING,
      'ready': InitiativeStatus.READY_FOR_TASKS
    }
    
    // Validate phase transition
    const newPhase = phaseMap[phase]
    if (!newPhase) {
      throw new Error(`Invalid phase: ${phase}`)
    }
    
    // Get phase order for validation
    const phaseOrder = [
      InitiativePhase.EXPLORATION,
      InitiativePhase.QUESTIONS,
      InitiativePhase.RESEARCH_PREP,
      InitiativePhase.RESEARCH_REVIEW,
      InitiativePhase.TASK_GENERATION,
      InitiativePhase.READY
    ]
    
    const currentIndex = phaseOrder.indexOf(initiative.currentPhase)
    const newIndex = phaseOrder.indexOf(newPhase)
    
    // Allow moving forward or staying in same phase, but not backwards
    if (newIndex < currentIndex) {
      throw new Error(`Cannot transition from ${initiative.currentPhase} back to ${phase}`)
    }

    // Store original state for rollback
    const originalPhase = initiative.currentPhase
    const originalStatus = initiative.status
    const originalUpdatedAt = initiative.updatedAt

    // Update phase and status
    initiative.currentPhase = newPhase
    initiative.status = statusMap[phase] || InitiativeStatus.EXPLORING
    initiative.updatedAt = new Date()

    // Handle completion
    if (phase === 'ready') {
      initiative.status = InitiativeStatus.READY_FOR_TASKS
    }

    this.initiatives.set(id, initiative)
    
    try {
      // Phase updates are critical, save immediately
      await this.saveInitiatives()
      this.broadcastInitiativeUpdate(id, initiative)
      console.log(`Updated initiative ${id} to phase: ${phase}`)
    } catch (error) {
      // Rollback on save failure
      initiative.currentPhase = originalPhase
      initiative.status = originalStatus
      initiative.updatedAt = originalUpdatedAt
      this.initiatives.set(id, initiative)
      console.error(`Failed to save phase update for ${id}, rolled back:`, error)
      throw error
    }
  }

  async savePhaseFile(id: string, filename: string, content: string): Promise<void> {
    const initiative = this.initiatives.get(id)
    if (!initiative) {
      throw new Error(`Initiative ${id} not found`)
    }

    const directory = path.join(this.initiativesDir, id)
    const filePath = path.join(directory, filename)
    
    try {
      await this.fileRecovery.safeWriteFile(filePath, content)
      console.log(`Saved phase file ${filename} for initiative ${id}`)
    } catch (error) {
      console.error(`Error saving phase file ${filename} for initiative ${id}:`, error)
      throw new Error(`Failed to save phase file: ${error}`)
    }
  }

  async loadPhaseFile(id: string, filename: string): Promise<string> {
    const initiative = this.initiatives.get(id)
    if (!initiative) {
      throw new Error(`Initiative ${id} not found`)
    }

    const directory = path.join(this.initiativesDir, id)
    const filePath = path.join(directory, filename)
    
    try {
      const content = await this.fileRecovery.safeReadFile(filePath)
      return content
    } catch (error: any) {
      console.error(`Error loading phase file ${filename} for initiative ${id}:`, error)
      // Check for alternative file extensions
      if (error.message?.includes('File not found') && filename.endsWith('.json')) {
        try {
          // Try .md extension
          const mdPath = filePath.replace('.json', '.md')
          const mdContent = await this.fileRecovery.safeReadFile(mdPath)
          console.log(`Found .md file instead of .json for ${filename}`)
          return mdContent
        } catch {
          // Ignore and throw original error
        }
      }
      throw new Error(`Failed to load phase file: ${error.message || error}`)
    }
  }

  async delete(id: string): Promise<void> {
    const initiative = this.initiatives.get(id)
    if (!initiative) {
      console.warn(`Initiative ${id} not found, skipping deletion`)
      return
    }

    console.log(`Deleting initiative ${id}`)

    // Clean up directory
    const directory = path.join(this.initiativesDir, id)
    try {
      await fs.rm(directory, { recursive: true, force: true })
      console.log(`Deleted initiative directory: ${directory}`)
    } catch (error) {
      console.error(`Error deleting initiative directory ${directory}:`, error)
    }

    // Remove from map
    this.initiatives.delete(id)
    
    // Clean up debounce timer to prevent memory leak
    const timer = this.broadcastDebounceTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.broadcastDebounceTimers.delete(id)
    }
    
    this.debouncedSave()

    // Clean up WebSocket connections if available
    if (typeof global !== 'undefined' && (global as any).cleanupInitiativeConnections) {
      (global as any).cleanupInitiativeConnections(id)
    }
  }

  async deleteAll(): Promise<void> {
    console.log('Deleting all initiatives...')
    
    const initiativeIds = Array.from(this.initiatives.keys())
    
    // Delete each initiative one by one
    for (const id of initiativeIds) {
      try {
        await this.delete(id)
        console.log(`Deleted initiative ${id}`)
      } catch (error) {
        console.error(`Failed to delete initiative ${id}:`, error)
      }
    }

    // Ensure everything is cleared
    this.initiatives.clear()
    
    // Save the empty state
    await this.saveInitiatives()
    
    console.log('All initiatives deleted successfully')
  }

  // Get phase-specific file paths
  getPhaseFilePath(id: string, phase: InitiativePhase | string): string {
    const initiative = this.initiatives.get(id)
    if (!initiative) {
      throw new Error(`Initiative ${id} not found`)
    }

    const phaseFiles: Record<string, string> = {
      [InitiativePhase.EXPLORATION]: 'questions.md',
      [InitiativePhase.QUESTIONS]: 'answers.md',
      [InitiativePhase.RESEARCH_PREP]: 'research-needs.md',
      [InitiativePhase.RESEARCH_REVIEW]: 'research-results.md',
      [InitiativePhase.TASK_GENERATION]: 'tasks.md',
      [InitiativePhase.READY]: 'final-tasks.md'
    }

    const directory = path.join(this.initiativesDir, id)
    return path.join(directory, phaseFiles[phase as string])
  }

  // Utility methods for common operations
  getActiveInitiatives(): Initiative[] {
    return Array.from(this.initiatives.values())
      .filter(i => i.status !== InitiativeStatus.COMPLETED && i.status !== InitiativeStatus.TASKS_SUBMITTED)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  getCompletedInitiatives(): Initiative[] {
    return Array.from(this.initiatives.values())
      .filter(i => i.status === InitiativeStatus.COMPLETED || i.status === InitiativeStatus.TASKS_SUBMITTED)
      .sort((a, b) => (b.updatedAt || b.createdAt).getTime() - (a.updatedAt || a.createdAt).getTime())
  }

  // Check if we can create a new initiative
  canCreateInitiative(): boolean {
    const activeCount = this.getActiveInitiatives().length
    return activeCount < this.MAX_CONCURRENT_INITIATIVES
  }

  // Get remaining initiative slots
  getRemainingSlots(): number {
    const activeCount = this.getActiveInitiatives().length
    return Math.max(0, this.MAX_CONCURRENT_INITIATIVES - activeCount)
  }
}

export const initiativeStore = InitiativeStore.getInstance()
export default initiativeStore