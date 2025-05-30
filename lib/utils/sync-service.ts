import { EventEmitter } from 'events'
import { getPersistentState } from './persistent-state'
import { getPersistentLogger } from './persistent-logger'
import { taskStore } from './task-store'
import { Task, TaskOutput } from '../types/task'

export interface SyncReport {
  timestamp: Date
  tasksInMemory: number
  tasksInPersistent: number
  tasksSynced: number
  outputsSynced: number
  conflicts: Array<{
    type: 'task' | 'output' | 'initiative'
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
  syncOutputs?: boolean
  syncInitiatives?: boolean
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
      outputsSynced: 0,
      conflicts: [],
      errors: []
    }
    
    try {
      console.log('[SyncService] Starting sync operation')
      
      // Sync tasks
      await this.syncTasks(report)
      
      // Sync outputs
      await this.syncOutputs(report)
      
      // Update WebSocket connections with any changes
      await this.updateWebSocketState(report)
      
      const duration = Date.now() - startTime
      this.lastSyncTime = new Date()
      
      console.log(`[SyncService] Sync completed in ${duration}ms. Synced ${report.tasksSynced} tasks, ${report.outputsSynced} outputs`)
      
      await this.logger.logSystemEvent('sync-completed', {
        duration,
        report: {
          tasksSynced: report.tasksSynced,
          outputsSynced: report.outputsSynced,
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
   * Sync outputs between memory and persistent storage
   */
  private async syncOutputs(report: SyncReport): Promise<void> {
    try {
      const tasks = taskStore.getTasks()
      
      for (const task of tasks) {
        const memoryOutputs = taskStore.getOutputs(task.id)
        const persistentOutputs = await this.persistentState.getTaskOutputs(task.id)
        
        // Simple comparison by length - could be more sophisticated
        if (memoryOutputs.length !== persistentOutputs.length) {
          if (memoryOutputs.length > persistentOutputs.length) {
            // Memory has more outputs, update persistent
            await this.persistentState.saveTaskOutputs(task.id, memoryOutputs)
            report.outputsSynced += memoryOutputs.length - persistentOutputs.length
            console.log(`[SyncService] Updated persistent outputs for task ${task.id}`)
          } else {
            // Persistent has more outputs, this is unusual
            report.conflicts.push({
              type: 'output',
              id: task.id,
              resolution: 'memory-wins',
              details: `Persistent has ${persistentOutputs.length} outputs, memory has ${memoryOutputs.length}`
            })
          }
        }
      }
    } catch (error) {
      report.errors.push(`Output sync error: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }
  
  /**
   * Detect if there's a conflict between two task versions
   */
  private detectTaskConflict(task1: Task, task2: Task): boolean {
    // Compare key fields that might change
    return (
      task1.status !== task2.status ||
      task1.phase !== task2.phase ||
      task1.commitHash !== task2.commitHash ||
      task1.mergedAt?.getTime() !== task2.mergedAt?.getTime() ||
      task1.lastActivityTime?.getTime() !== task2.lastActivityTime?.getTime()
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
        // Compare last activity times
        const memoryTime = memoryTask.lastActivityTime?.getTime() || 0
        const persistentTime = persistentTask.lastActivityTime?.getTime() || 0
        
        if (memoryTime > persistentTime) {
          winningTask = memoryTask
          resolution = 'memory-wins'
        } else {
          winningTask = persistentTask
          resolution = 'persistent-wins'
        }
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
      details: `Status: ${memoryTask.status} vs ${persistentTask.status}`
    })
    
    console.log(`[SyncService] Resolved conflict for task ${memoryTask.id}: ${resolution}`)
  }
  
  /**
   * Update WebSocket connections with sync results
   */
  private async updateWebSocketState(report: SyncReport): Promise<void> {
    // Broadcast sync status to connected clients
    if (typeof global !== 'undefined' && (global as any).broadcastTaskUpdate) {
      for (const conflict of report.conflicts) {
        if (conflict.type === 'task') {
          const task = taskStore.getTask(conflict.id)
          if (task) {
            (global as any).broadcastTaskUpdate(conflict.id, task)
          }
        }
      }
    }
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
    const outputs = taskStore.getOutputs(taskId)
    await this.persistentState.saveTaskOutputs(taskId, outputs)
    
    await this.logger.logTaskEvent(taskId, 'force-synced', {
      status: task.status,
      outputCount: outputs.length
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
      outputsSynced: 0,
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