import fs from 'fs/promises'
import path from 'path'
import os from 'os'

export type InitiativePhase = 
  | 'exploration'
  | 'questions'
  | 'research_prep'
  | 'research_review'
  | 'task_generation'
  | 'ready'

export interface Initiative {
  id: string
  objective: string
  phase: InitiativePhase
  directory: string
  createdAt: Date
  updatedAt: Date
  completedAt?: Date
  phaseData?: any
  claudeCodePid?: number
  isActive: boolean
  status?: string
  tasksCreated?: number
  yoloMode?: boolean
  currentStepIndex?: number
}

class InitiativeStore {
  private static instance: InitiativeStore
  private initiatives: Map<string, Initiative> = new Map()
  private dataDir: string = path.join(os.homedir(), '.claude-god-data')
  private initiativesDir: string = path.join(os.homedir(), '.claude-god-data', 'initiatives')
  private initiativesFile: string = path.join(os.homedir(), '.claude-god-data', 'initiatives.json')
  private readonly MAX_CONCURRENT_INITIATIVES = 5
  private saveDebounceTimer: NodeJS.Timeout | null = null

  private constructor() {
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
      const data = await fs.readFile(this.initiativesFile, 'utf-8')
      const initiatives = JSON.parse(data)
      
      // Convert array back to Map and restore Date objects
      for (const initiative of initiatives) {
        initiative.createdAt = new Date(initiative.createdAt)
        initiative.updatedAt = new Date(initiative.updatedAt)
        if (initiative.completedAt) {
          initiative.completedAt = new Date(initiative.completedAt)
        }
        this.initiatives.set(initiative.id, initiative)
      }
      
      console.log(`Loaded ${this.initiatives.size} initiatives from disk`)
    } catch (error) {
      console.log('No existing initiatives found, starting fresh')
    }
  }

  private async saveInitiatives() {
    try {
      // Convert Map to array for JSON serialization
      const initiativesArray = Array.from(this.initiatives.values())
      await fs.writeFile(this.initiativesFile, JSON.stringify(initiativesArray, null, 2))
    } catch (error) {
      console.error('Error saving initiatives:', error)
    }
  }

  private debouncedSave() {
    // Clear existing timer
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer)
    }
    
    // Set new timer to save after 1 second of no changes
    this.saveDebounceTimer = setTimeout(async () => {
      await this.saveInitiatives()
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
      (global as any).broadcastInitiativeUpdate(initiativeId, initiative)
    }
  }

  async createInitiative(objective: string): Promise<Initiative> {
    // Check concurrent initiative limit
    const activeInitiatives = Array.from(this.initiatives.values()).filter(
      i => i.isActive
    )
    if (activeInitiatives.length >= this.MAX_CONCURRENT_INITIATIVES) {
      throw new Error(`Maximum concurrent initiatives (${this.MAX_CONCURRENT_INITIATIVES}) reached`)
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
      phase: 'exploration',
      directory,
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
      yoloMode: true,
      currentStepIndex: 0
    }

    this.initiatives.set(id, initiative)
    this.debouncedSave()
    this.broadcastInitiativeUpdate(id, initiative)

    console.log(`Created initiative ${id} with objective: ${objective}`)
    return initiative
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
    this.debouncedSave()
    this.broadcastInitiativeUpdate(id, updatedInitiative)

    return updatedInitiative
  }

  async updatePhase(id: string, phase: InitiativePhase, data?: any): Promise<void> {
    const initiative = this.initiatives.get(id)
    if (!initiative) {
      throw new Error(`Initiative ${id} not found`)
    }

    // Update phase and associated data
    initiative.phase = phase
    initiative.phaseData = data
    initiative.updatedAt = new Date()

    // Handle completion
    if (phase === 'ready') {
      initiative.completedAt = new Date()
      initiative.isActive = false
    }

    this.initiatives.set(id, initiative)
    this.debouncedSave()
    this.broadcastInitiativeUpdate(id, initiative)

    console.log(`Updated initiative ${id} to phase: ${phase}`)
  }

  async savePhaseFile(id: string, filename: string, content: string): Promise<void> {
    const initiative = this.initiatives.get(id)
    if (!initiative) {
      throw new Error(`Initiative ${id} not found`)
    }

    const filePath = path.join(initiative.directory, filename)
    
    try {
      await fs.writeFile(filePath, content, 'utf-8')
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

    const filePath = path.join(initiative.directory, filename)
    
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return content
    } catch (error) {
      console.error(`Error loading phase file ${filename} for initiative ${id}:`, error)
      throw new Error(`Failed to load phase file: ${error}`)
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
    try {
      await fs.rm(initiative.directory, { recursive: true, force: true })
      console.log(`Deleted initiative directory: ${initiative.directory}`)
    } catch (error) {
      console.error(`Error deleting initiative directory ${initiative.directory}:`, error)
    }

    // Remove from map
    this.initiatives.delete(id)
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
  getPhaseFilePath(id: string, phase: InitiativePhase): string {
    const initiative = this.initiatives.get(id)
    if (!initiative) {
      throw new Error(`Initiative ${id} not found`)
    }

    const phaseFiles: Record<InitiativePhase, string> = {
      'exploration': 'questions.md',
      'questions': 'answers.md',
      'research_prep': 'research-needs.md',
      'research_review': 'research-results.md',
      'task_generation': 'tasks.md',
      'ready': 'final-tasks.md'
    }

    return path.join(initiative.directory, phaseFiles[phase])
  }

  // Utility methods for common operations
  getActiveInitiatives(): Initiative[] {
    return Array.from(this.initiatives.values())
      .filter(i => i.isActive)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  getCompletedInitiatives(): Initiative[] {
    return Array.from(this.initiatives.values())
      .filter(i => !i.isActive && i.completedAt)
      .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime())
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