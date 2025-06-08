import { getPersistentState } from './persistent-state'
import { getPersistentLogger } from './persistent-logger'
import { taskStore } from './task-store'
import { ProcessManager } from './process-manager'
import { Task } from '../types/task'

export interface RecoveryReport {
  timestamp: Date
  tasksRecovered: number
  errors: Array<{ type: string; message: string; context?: any }>
  warnings: Array<{ type: string; message: string; context?: any }>
}

export interface RecoveryOptions {
  recoverTasks?: boolean
  recoverFromSnapshot?: string
  dryRun?: boolean
}

/**
 * RecoveryManager handles system recovery from crashes, restarts, or data corruption
 */
export class RecoveryManager {
  private persistentState = getPersistentState()
  private logger = getPersistentLogger()
  
  /**
   * Perform full system recovery
   */
  async performRecovery(options: RecoveryOptions = {}): Promise<RecoveryReport> {
    const report: RecoveryReport = {
      timestamp: new Date(),
      tasksRecovered: 0,
      errors: [],
      warnings: []
    }
    
    console.log('[RecoveryManager] Starting system recovery...')
    await this.logger.logSystemEvent('recovery-started', options)
    
    try {
      // If recovering from snapshot
      if (options.recoverFromSnapshot) {
        await this.recoverFromSnapshot(options.recoverFromSnapshot, report)
        return report
      }
      
      // Recover tasks
      if (options.recoverTasks !== false) {
        await this.recoverTasks(report, options.dryRun)
      }
      
      
      // Outputs are no longer tracked in iTerm-based workflow
      // Skip output recovery
      
      // Verify data integrity
      await this.verifyDataIntegrity(report)
      
      console.log(`[RecoveryManager] Recovery completed. Tasks: ${report.tasksRecovered}`)
      await this.logger.logSystemEvent('recovery-completed', report)
      
    } catch (error) {
      console.error('[RecoveryManager] Recovery failed:', error)
      report.errors.push({
        type: 'recovery-failed',
        message: error instanceof Error ? error.message : String(error)
      })
      await this.logger.logError(error as Error, { operation: 'performRecovery' })
    }
    
    return report
  }
  
  /**
   * Recover from a specific snapshot
   */
  private async recoverFromSnapshot(snapshotId: string, report: RecoveryReport): Promise<void> {
    try {
      console.log(`[RecoveryManager] Recovering from snapshot: ${snapshotId}`)
      await this.persistentState.restoreFromSnapshot(snapshotId)
      
      // Count recovered items
      const tasks = await this.persistentState.getAllTasks()
      report.tasksRecovered = tasks.length
      
      console.log(`[RecoveryManager] Snapshot recovery successful`)
    } catch (error) {
      report.errors.push({
        type: 'snapshot-recovery-failed',
        message: error instanceof Error ? error.message : String(error),
        context: { snapshotId }
      })
      throw error
    }
  }
  
  /**
   * Recover tasks from persistent state
   */
  private async recoverTasks(report: RecoveryReport, dryRun?: boolean): Promise<void> {
    console.log('[RecoveryManager] Recovering tasks...')
    
    try {
      // Get all tasks from persistent state
      const persistedTasks = await this.persistentState.getAllTasks()
      
      for (const task of persistedTasks) {
        try {
          // Check if task already exists in memory
          const existingTask = taskStore.getTask(task.id)
          
          if (!existingTask) {
            if (!dryRun) {
              // Restore task to task store
              await this.restoreTask(task)
            }
            report.tasksRecovered++
            
            console.log(`[RecoveryManager] Recovered task ${task.id} (status: ${task.status})`)
          } else {
            // Verify task integrity
            if (this.isTaskCorrupted(existingTask, task)) {
              report.warnings.push({
                type: 'task-integrity-mismatch',
                message: `Task ${task.id} has integrity issues`,
                context: { taskId: task.id }
              })
            }
          }
          
          // Recover processes for in-progress tasks
          if (task.status === 'in_progress' || task.status === 'starting') {
            await this.recoverTaskProcess(task, report, dryRun)
          }
        } catch (error) {
          report.errors.push({
            type: 'task-recovery-failed',
            message: error instanceof Error ? error.message : String(error),
            context: { taskId: task.id }
          })
        }
      }
    } catch (error) {
      report.errors.push({
        type: 'tasks-recovery-failed',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
  
  
  
  /**
   * Handle iTerm terminal recovery
   */
  private async recoverTaskProcess(task: Task, report: RecoveryReport, dryRun?: boolean): Promise<void> {
    if (dryRun) return
    
    try {
      // With iTerm integration, we can't automatically recover terminals
      // Just note that the task needs manual intervention
      console.log(`[RecoveryManager] Task ${task.id} was in progress - iTerm terminal needs to be reopened manually`)
      
      if (!dryRun && task.terminalTag) {
        report.warnings.push({
          type: 'terminal-needs-reopening',
          message: `Task ${task.id} was in progress - iTerm terminal with tag '${task.terminalTag}' needs to be reopened`,
          context: { taskId: task.id, terminalTag: task.terminalTag }
        })
      }
    } catch (error) {
      report.warnings.push({
        type: 'process-recovery-failed',
        message: error instanceof Error ? error.message : String(error),
        context: { taskId: task.id }
      })
    }
  }
  
  /**
   * Verify data integrity
   */
  private async verifyDataIntegrity(report: RecoveryReport): Promise<void> {
    console.log('[RecoveryManager] Verifying data integrity...')
    
    try {
      // Check for orphaned outputs
      const allTaskIds = new Set((await this.persistentState.getAllTasks()).map(t => t.id))
      const logs = await this.logger.queryLogs({ type: 'task', limit: 1000 })
      
      for (const log of logs) {
        if (log.metadata?.taskId && !allTaskIds.has(log.metadata.taskId)) {
          report.warnings.push({
            type: 'orphaned-data',
            message: `Found orphaned data for task ${log.metadata.taskId}`,
            context: { taskId: log.metadata.taskId }
          })
        }
      }
      
      // Check for data consistency
      const snapshots = await this.persistentState.getAvailableSnapshots()
      if (snapshots.length === 0) {
        report.warnings.push({
          type: 'no-snapshots',
          message: 'No snapshots available for recovery'
        })
      }
      
    } catch (error) {
      report.errors.push({
        type: 'integrity-check-failed',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
  
  /**
   * Check if task is corrupted
   */
  private isTaskCorrupted(task1: Task, task2: Task): boolean {
    // Simple integrity check - can be expanded
    return (
      task1.id !== task2.id ||
      task1.status !== task2.status ||
      task1.createdAt.getTime() !== task2.createdAt.getTime()
    )
  }
  
  /**
   * Restore task to task store
   */
  private async restoreTask(task: Task): Promise<void> {
    // This would need to be implemented in TaskStore as a restore method
    // For now, we'll use the existing API
    console.log(`[RecoveryManager] Restoring task ${task.id} to task store`)
    
    // The task store would need a method to restore tasks without recreating worktrees
    // This is a simplified approach
    await this.logger.logTaskEvent(task.id, 'task-restored', {
      status: task.status,
      phase: task.phase
    })
  }
  
  
  /**
   * Get recovery status
   */
  async getRecoveryStatus(): Promise<{
    lastRecovery?: Date
    availableSnapshots: number
    dataIntegrity: 'healthy' | 'warning' | 'error'
    recommendations: string[]
  }> {
    const snapshots = await this.persistentState.getAvailableSnapshots()
    const logs = await this.logger.queryLogs({
      type: 'system',
      category: 'recovery-completed',
      limit: 1
    })
    
    const lastRecovery = logs.length > 0 ? new Date(logs[0].timestamp) : undefined
    
    // Simple integrity check
    let dataIntegrity: 'healthy' | 'warning' | 'error' = 'healthy'
    const recommendations: string[] = []
    
    if (snapshots.length === 0) {
      dataIntegrity = 'warning'
      recommendations.push('No snapshots available. System should create snapshots regularly.')
    }
    
    if (snapshots.length > 0) {
      const latestSnapshot = snapshots[0]
      const hoursSinceSnapshot = (Date.now() - latestSnapshot.timestamp.getTime()) / (1000 * 60 * 60)
      
      if (hoursSinceSnapshot > 24) {
        dataIntegrity = 'warning'
        recommendations.push('Latest snapshot is over 24 hours old. Consider creating a new snapshot.')
      }
    }
    
    return {
      lastRecovery,
      availableSnapshots: snapshots.length,
      dataIntegrity,
      recommendations
    }
  }
}

// Singleton instance
export const recoveryManager = new RecoveryManager()