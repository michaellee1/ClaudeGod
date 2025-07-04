import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { EventEmitter } from 'events'
import { Task } from '../types/task'
import { FileLock } from './file-lock'
import { getPersistentLogger } from './persistent-logger'

export interface StateSnapshot {
  timestamp: Date
  version: string
  tasks: Record<string, Task>
  processStates: Record<string, ProcessState>
}

export interface ProcessState {
  taskId?: string
  pid?: number
  phase?: string
  startTime?: Date
  lastHeartbeat?: Date
  metadata?: any
}

export interface PersistentStateOptions {
  baseDir?: string
  snapshotInterval?: number // ms
  maxSnapshots?: number
  compressionEnabled?: boolean
}

/**
 * PersistentState provides redundant file-based state persistence
 * with automatic snapshots and recovery capabilities
 */
export class PersistentState extends EventEmitter {
  private baseDir: string
  private snapshotInterval: number
  private maxSnapshots: number
  private compressionEnabled: boolean
  
  private snapshotTimer: NodeJS.Timeout | null = null
  private stateVersion: string = '1.0.0'
  private isInitialized: boolean = false
  private logger = getPersistentLogger()
  
  // In-memory state caches
  private tasksCache: Map<string, Task> = new Map()
  private processStatesCache: Map<string, ProcessState> = new Map()
  
  // Paths
  private readonly CURRENT_STATE_FILE = 'current-state.json'
  private readonly TASKS_DIR = 'tasks'
  private readonly SNAPSHOTS_DIR = 'snapshots'
  private readonly RECOVERY_DIR = 'recovery'
  
  constructor(options: PersistentStateOptions = {}) {
    super()
    
    this.baseDir = options.baseDir || path.join(os.homedir(), '.claude-god-data', 'state')
    this.snapshotInterval = options.snapshotInterval || 5 * 60 * 1000 // 5 minutes default
    this.maxSnapshots = options.maxSnapshots || 24 // Keep 24 snapshots (2 hours at 5 min intervals)
    this.compressionEnabled = options.compressionEnabled || false
    
    this.initialize()
  }
  
  private async initialize(): Promise<void> {
    try {
      // Create directory structure
      await this.createDirectoryStructure()
      
      // Load existing state
      await this.loadState()
      
      // Start snapshot timer
      this.startSnapshotTimer()
      
      // Handle process termination
      process.on('exit', () => this.saveStateSync())
      process.on('SIGINT', () => this.saveStateSync())
      process.on('SIGTERM', () => this.saveStateSync())
      
      this.isInitialized = true
      this.emit('initialized')
      
      await this.logger.logSystemEvent('persistent-state-initialized', {
        baseDir: this.baseDir,
        snapshotInterval: this.snapshotInterval
      })
    } catch (error) {
      console.error('Failed to initialize PersistentState:', error)
      this.emit('error', error)
    }
  }
  
  private async createDirectoryStructure(): Promise<void> {
    const dirs = [
      this.baseDir,
      path.join(this.baseDir, this.TASKS_DIR),
      path.join(this.baseDir, this.SNAPSHOTS_DIR),
      path.join(this.baseDir, this.RECOVERY_DIR)
    ]
    
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true })
    }
  }
  
  /**
   * Save task state
   */
  async saveTask(task: Task): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('PersistentState not initialized')
    }
    
    // Update cache
    this.tasksCache.set(task.id, task)
    
    // Save to individual file
    const taskFile = path.join(this.baseDir, this.TASKS_DIR, `${task.id}.json`)
    await FileLock.withLock(taskFile, async () => {
      await fs.writeFile(taskFile, JSON.stringify(task, null, 2))
    })
    
    // Log the event
    await this.logger.logTaskEvent(task.id, 'task-saved', {
      mode: task.mode,
      worktree: task.worktree
    })
    
    // Save current state
    await this.saveCurrentState()
    
    this.emit('task-saved', task)
  }
  
  
  
  /**
   * Save process state
   */
  async saveProcessState(processId: string, state: ProcessState): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('PersistentState not initialized')
    }
    
    // Update cache
    this.processStatesCache.set(processId, state)
    
    // Log the event
    await this.logger.logSystemEvent('process-state-saved', {
      processId,
      ...state
    })
    
    // Save current state
    await this.saveCurrentState()
    
    this.emit('process-state-saved', { processId, state })
  }
  
  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<Task | null> {
    // Check cache first
    if (this.tasksCache.has(taskId)) {
      return this.tasksCache.get(taskId)!
    }
    
    // Load from file
    try {
      const taskFile = path.join(this.baseDir, this.TASKS_DIR, `${taskId}.json`)
      const data = await fs.readFile(taskFile, 'utf-8')
      const task = JSON.parse(data)
      
      // Restore Date objects
      task.createdAt = new Date(task.createdAt)
      if (task.mergedAt) task.mergedAt = new Date(task.mergedAt)
      if (task.lastActivityTime) task.lastActivityTime = new Date(task.lastActivityTime)
      if (task.lastHeartbeatTime) task.lastHeartbeatTime = new Date(task.lastHeartbeatTime)
      
      // Update cache
      this.tasksCache.set(taskId, task)
      
      return task
    } catch (error) {
      return null
    }
  }
  
  /**
   * Get all tasks
   */
  async getAllTasks(): Promise<Task[]> {
    const tasks: Task[] = []
    
    try {
      const files = await fs.readdir(path.join(this.baseDir, this.TASKS_DIR))
      const taskFiles = files.filter(f => f.endsWith('.json') && !f.includes('-outputs'))
      
      for (const file of taskFiles) {
        const taskId = file.replace('.json', '')
        const task = await this.getTask(taskId)
        if (task) {
          tasks.push(task)
        }
      }
    } catch (error) {
      console.error('Error loading tasks:', error)
    }
    
    return tasks
  }
  
  
  
  /**
   * Delete task
   */
  async deleteTask(taskId: string): Promise<void> {
    // Remove from cache
    this.tasksCache.delete(taskId)
    
    // Delete files
    try {
      await fs.unlink(path.join(this.baseDir, this.TASKS_DIR, `${taskId}.json`))
    } catch (error) {
      // Ignore if file doesn't exist
    }
    
    
    await this.logger.logTaskEvent(taskId, 'task-deleted', {})
    this.emit('task-deleted', taskId)
  }
  
  /**
   * Create snapshot
   */
  async createSnapshot(): Promise<string> {
    const snapshot: StateSnapshot = {
      timestamp: new Date(),
      version: this.stateVersion,
      tasks: Object.fromEntries(this.tasksCache),
      processStates: Object.fromEntries(this.processStatesCache)
    }
    
    const snapshotId = `snapshot-${Date.now()}`
    const snapshotFile = path.join(this.baseDir, this.SNAPSHOTS_DIR, `${snapshotId}.json`)
    
    await FileLock.withLock(snapshotFile, async () => {
      await fs.writeFile(snapshotFile, JSON.stringify(snapshot, null, 2))
    })
    
    // Clean up old snapshots
    await this.cleanupOldSnapshots()
    
    await this.logger.logSystemEvent('snapshot-created', { snapshotId })
    this.emit('snapshot-created', snapshotId)
    
    return snapshotId
  }
  
  /**
   * Restore from snapshot
   */
  async restoreFromSnapshot(snapshotId: string): Promise<void> {
    const snapshotFile = path.join(this.baseDir, this.SNAPSHOTS_DIR, `${snapshotId}.json`)
    
    try {
      const data = await fs.readFile(snapshotFile, 'utf-8')
      const snapshot: StateSnapshot = JSON.parse(data)
      
      // Validate version compatibility
      if (snapshot.version !== this.stateVersion) {
        throw new Error(`Incompatible snapshot version: ${snapshot.version}`)
      }
      
      // Create recovery backup first
      await this.createRecoveryBackup()
      
      // Restore state
      this.tasksCache.clear()
      this.processStatesCache.clear()
      
      // Restore tasks
      for (const [taskId, task] of Object.entries(snapshot.tasks)) {
        // Restore Date objects
        task.createdAt = new Date(task.createdAt)
        
        this.tasksCache.set(taskId, task)
        await this.saveTask(task)
      }
      
      
      // Restore process states
      for (const [processId, state] of Object.entries(snapshot.processStates)) {
        if (state.startTime) state.startTime = new Date(state.startTime)
        if (state.lastHeartbeat) state.lastHeartbeat = new Date(state.lastHeartbeat)
        
        this.processStatesCache.set(processId, state)
      }
      
      await this.logger.logSystemEvent('snapshot-restored', { snapshotId })
      this.emit('snapshot-restored', snapshotId)
    } catch (error) {
      console.error(`Failed to restore from snapshot ${snapshotId}:`, error)
      throw error
    }
  }
  
  /**
   * Get available snapshots
   */
  async getAvailableSnapshots(): Promise<Array<{ id: string, timestamp: Date, size: number }>> {
    try {
      const files = await fs.readdir(path.join(this.baseDir, this.SNAPSHOTS_DIR))
      const snapshots = []
      
      for (const file of files) {
        if (file.startsWith('snapshot-') && file.endsWith('.json')) {
          const filePath = path.join(this.baseDir, this.SNAPSHOTS_DIR, file)
          const stats = await fs.stat(filePath)
          const id = file.replace('.json', '')
          
          snapshots.push({
            id,
            timestamp: stats.mtime,
            size: stats.size
          })
        }
      }
      
      // Sort by timestamp descending
      snapshots.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      
      return snapshots
    } catch (error) {
      console.error('Error getting snapshots:', error)
      return []
    }
  }
  
  /**
   * Save current state
   */
  private async saveCurrentState(): Promise<void> {
    const stateFile = path.join(this.baseDir, this.CURRENT_STATE_FILE)
    const state = {
      version: this.stateVersion,
      lastUpdate: new Date(),
      taskCount: this.tasksCache.size,
      processCount: this.processStatesCache.size
    }
    
    await FileLock.withLock(stateFile, async () => {
      await fs.writeFile(stateFile, JSON.stringify(state, null, 2))
    })
  }
  
  /**
   * Load state from disk
   */
  private async loadState(): Promise<void> {
    // Load tasks
    await this.loadTasks()
    
    // Load current state metadata
    await this.loadCurrentStateMetadata()
    
    this.emit('state-loaded', {
      taskCount: this.tasksCache.size
    })
  }
  
  private async loadTasks(): Promise<void> {
    try {
      const files = await fs.readdir(path.join(this.baseDir, this.TASKS_DIR))
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const taskId = file.replace('.json', '')
          await this.getTask(taskId)
        }
      }
    } catch (error) {
      console.error('Error loading tasks:', error)
    }
  }
  
  
  private async loadCurrentStateMetadata(): Promise<void> {
    try {
      const stateFile = path.join(this.baseDir, this.CURRENT_STATE_FILE)
      const data = await fs.readFile(stateFile, 'utf-8')
      const metadata = JSON.parse(data)
      
      console.log('Loaded state metadata:', metadata)
    } catch (error) {
      // State file doesn't exist yet
    }
  }
  
  /**
   * Create recovery backup
   */
  private async createRecoveryBackup(): Promise<void> {
    const backupId = `recovery-${Date.now()}`
    const backupDir = path.join(this.baseDir, this.RECOVERY_DIR, backupId)
    
    await fs.mkdir(backupDir, { recursive: true })
    
    // Copy current state
    await fs.cp(
      path.join(this.baseDir, this.TASKS_DIR),
      path.join(backupDir, this.TASKS_DIR),
      { recursive: true }
    )
    
  }
  
  /**
   * Clean up old snapshots
   */
  private async cleanupOldSnapshots(): Promise<void> {
    try {
      const snapshots = await this.getAvailableSnapshots()
      
      if (snapshots.length > this.maxSnapshots) {
        const toDelete = snapshots.slice(this.maxSnapshots)
        
        for (const snapshot of toDelete) {
          const file = path.join(this.baseDir, this.SNAPSHOTS_DIR, `${snapshot.id}.json`)
          await fs.unlink(file)
        }
      }
    } catch (error) {
      console.error('Error cleaning up snapshots:', error)
    }
  }
  
  /**
   * Start snapshot timer
   */
  private startSnapshotTimer(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer)
    }
    
    this.snapshotTimer = setInterval(() => {
      this.createSnapshot().catch(error => {
        console.error('Error creating snapshot:', error)
      })
    }, this.snapshotInterval)
  }
  
  /**
   * Save state synchronously (for process exit)
   */
  private saveStateSync(): void {
    try {
      const stateFile = path.join(this.baseDir, this.CURRENT_STATE_FILE)
      const state = {
        version: this.stateVersion,
        lastUpdate: new Date(),
        taskCount: this.tasksCache.size,
        processCount: this.processStatesCache.size,
        shutdownClean: true
      }
      
      require('fs').writeFileSync(stateFile, JSON.stringify(state, null, 2))
    } catch (error) {
      console.error('Error saving state on shutdown:', error)
    }
  }
  
  /**
   * Close persistent state
   */
  async close(): Promise<void> {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer)
      this.snapshotTimer = null
    }
    
    // Create final snapshot
    await this.createSnapshot()
    
    // Save current state
    await this.saveCurrentState()
    
    this.emit('closed')
  }
}

// Singleton instance
let stateInstance: PersistentState | null = null

export function getPersistentState(): PersistentState {
  if (!stateInstance) {
    stateInstance = new PersistentState()
  }
  return stateInstance
}