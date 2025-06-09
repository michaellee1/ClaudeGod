import { EventEmitter } from 'events'
import { getPersistentState } from './persistent-state'
import { getPersistentLogger } from './persistent-logger'
import { taskStore } from './task-store'
import { Task } from '../types/task'

export interface SyncReport {
  timestamp: Date
  tasksInMemory: number
  tasksInPersistent: number
  tasksSynced: number
  conflicts: Array<{
    type: 'task'
    id: string
    resolution: 'memory-wins' | 'persistent-wins' | 'merged'
    details?: string
  }>
  errors: string[]
}

export interface SyncOptions {
  syncInterval?: number // ms
  conflictResolution?: 'memory-wins' | 'persistent-wins' | 'newest-wins'
  syncTasks?: boolean
}

/**
 * SyncService maintains consistency between in-memory state and persistent file storage
 */
export class SyncService extends EventEmitter {
  private syncInterval: number
  private conflictResolution: string
  private syncTimer: NodeJS.Timeout | null = null
  private isSyncing: boolean = false
  private persistentState = getPersistentState()
  private logger = getPersistentLogger()
  private lastSyncTime: Date | null = null
  
  constructor(options: SyncOptions = {}) {
    super()
    
    this.syncInterval = options.syncInterval || 30000 // 30 seconds default
    this.conflictResolution = options.conflictResolution || 'newest-wins'
  }
  
  /**
   * Start the sync service
   */
  start(): void {
    if (this.syncTimer) {
      return
    }
    
    console.log('[SyncService] Starting background sync service')
    this.logger.logSystemEvent('sync-service-started', {
      interval: this.syncInterval,
      conflictResolution: this.conflictResolution
    })
    
    // Perform initial sync
    this.performSync().catch(error => {
      console.error('[SyncService] Initial sync failed:', error)
    })
    
    // Set up periodic sync
    this.syncTimer = setInterval(() => {
      this.performSync().catch(error => {
        console.error('[SyncService] Sync failed:', error)
        this.emit('sync-error', error)
      })
    }, this.syncInterval)
    
    this.emit('started')
  }
  
  /**
   * Stop the sync service
   */
  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
    }
    
    console.log('[SyncService] Stopping background sync service')
    this.logger.logSystemEvent('sync-service-stopped', {})
    
    this.emit('stopped')
  }
  
  /**
   * Perform a sync operation
   */
  async performSync(): Promise<SyncReport> {
    if (this.isSyncing) {
      console.log('[SyncService] Sync already in progress, skipping')
      return this.createEmptyReport()
    }
    
    this.isSyncing = true
    const startTime = Date.now()
    
    const report: SyncReport = {
      timestamp: new Date(),
      tasksInMemory: 0,
      tasksInPersistent: 0,
      tasksSynced: 0,
      conflicts: [],
      errors: []
    }
    
    try {
      console.log('[SyncService] Starting sync operation')
      
      // Sync tasks
      await this.syncTasks(report)
      
      
      // No longer need to update WebSocket connections
      
      const duration = Date.now() - startTime
      this.lastSyncTime = new Date()
      
      console.log(`[SyncService] Sync completed in ${duration}ms. Synced ${report.tasksSynced} tasks`)
      
      await this.logger.logSystemEvent('sync-completed', {
        duration,
        report: {
          tasksSynced: report.tasksSynced,
          conflicts: report.conflicts.length,
          errors: report.errors.length
        }
      })
      
      this.emit('sync-completed', report)
      
    } catch (error) {
      report.errors.push(error instanceof Error ? error.message : String(error))
      console.error('[SyncService] Sync error:', error)
      await this.logger.logError(error as Error, { operation: 'performSync' })
      this.emit('sync-error', error)
    } finally {
      this.isSyncing = false
    }
    
    return report
  }
  
  /**
   * Sync tasks between memory and persistent storage
   */
  private async syncTasks(report: SyncReport): Promise<void> {
    try {
      // Get tasks from both sources
      const memoryTasks = taskStore.getTasks()
      const persistentTasks = await this.persistentState.getAllTasks()
      
      report.tasksInMemory = memoryTasks.length
      report.tasksInPersistent = persistentTasks.length
      
      // Create maps for efficient lookup
      const memoryTaskMap = new Map(memoryTasks.map(t => [t.id, t]))
      const persistentTaskMap = new Map(persistentTasks.map(t => [t.id, t]))
      
      // Find tasks only in memory (need to persist)
      for (const memoryTask of memoryTasks) {
        const persistentTask = persistentTaskMap.get(memoryTask.id)
        
        if (!persistentTask) {
          // Task exists only in memory, save to persistent
          await this.persistentState.saveTask(memoryTask)
          report.tasksSynced++
          console.log(`[SyncService] Persisted task ${memoryTask.id} from memory`)
        } else {
          // Task exists in both, check for conflicts
          const conflict = this.detectTaskConflict(memoryTask, persistentTask)
          if (conflict) {
            await this.resolveTaskConflict(memoryTask, persistentTask, report)
            report.tasksSynced++
          }
        }
      }
      
      // Find tasks only in persistent storage (need to load to memory)
      for (const persistentTask of persistentTasks) {
        if (!memoryTaskMap.has(persistentTask.id)) {
          // Task exists only in persistent storage
          // This might happen after a restart - the task store should handle this
          console.log(`[SyncService] Found task ${persistentTask.id} only in persistent storage`)
          report.conflicts.push({
            type: 'task',
            id: persistentTask.id,
            resolution: 'persistent-wins',
            details: 'Task found only in persistent storage, may need recovery'
          })
        }
      }
      
    } catch (error) {
      report.errors.push(`Task sync error: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }
  
  
  /**
   * Detect if there's a conflict between two task versions
   */
  private detectTaskConflict(task1: Task, task2: Task): boolean {
    // Compare key fields that might change
    return (
      task1.commitHash !== task2.commitHash ||
      task1.terminalTag !== task2.terminalTag ||
      task1.mode !== task2.mode
    )
  }
  
  /**
   * Resolve conflict between memory and persistent task versions
   */
  private async resolveTaskConflict(memoryTask: Task, persistentTask: Task, report: SyncReport): Promise<void> {
    let resolution: 'memory-wins' | 'persistent-wins' | 'merged' = 'memory-wins'
    let winningTask: Task = memoryTask
    
    switch (this.conflictResolution) {
      case 'memory-wins':
        winningTask = memoryTask
        resolution = 'memory-wins'
        break
        
      case 'persistent-wins':
        winningTask = persistentTask
        resolution = 'persistent-wins'
        break
        
      case 'newest-wins':
        // Compare creation times (we no longer have lastActivityTime)
        const memoryTime = memoryTask.createdAt.getTime()
        const persistentTime = persistentTask.createdAt.getTime()
        
        // Since creation time should be the same, prefer memory version
        // as it's the most recent state
        winningTask = memoryTask
        resolution = 'memory-wins'
        break
    }
    
    // Apply resolution
    if (resolution === 'memory-wins') {
      await this.persistentState.saveTask(memoryTask)
    } else if (resolution === 'persistent-wins') {
      // Would need to update task store - this is a limitation
      console.warn(`[SyncService] Cannot update memory task ${persistentTask.id} from persistent state`)
    }
    
    report.conflicts.push({
      type: 'task',
      id: memoryTask.id,
      resolution,
      details: `Mode: ${memoryTask.mode} vs ${persistentTask.mode}`
    })
    
    console.log(`[SyncService] Resolved conflict for task ${memoryTask.id}: ${resolution}`)
  }
  
  
  /**
   * Force sync a specific task
   */
  async syncTask(taskId: string): Promise<void> {
    const task = taskStore.getTask(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }
    
    await this.persistentState.saveTask(task)
    
    await this.logger.logTaskEvent(taskId, 'force-synced', {
      mode: task.mode
    })
    
    console.log(`[SyncService] Force synced task ${taskId}`)
  }
  
  /**
   * Get sync status
   */
  getSyncStatus(): {
    isRunning: boolean
    isSyncing: boolean
    lastSyncTime: Date | null
    nextSyncTime: Date | null
  } {
    const nextSyncTime = this.lastSyncTime && this.syncTimer
      ? new Date(this.lastSyncTime.getTime() + this.syncInterval)
      : null
    
    return {
      isRunning: !!this.syncTimer,
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime,
      nextSyncTime
    }
  }
  
  private createEmptyReport(): SyncReport {
    return {
      timestamp: new Date(),
      tasksInMemory: 0,
      tasksInPersistent: 0,
      tasksSynced: 0,
      conflicts: [],
      errors: []
    }
  }
}

// Singleton instance
let syncServiceInstance: SyncService | null = null

export function getSyncService(options?: SyncOptions): SyncService {
  if (!syncServiceInstance) {
    syncServiceInstance = new SyncService(options)
  }
  return syncServiceInstance
}