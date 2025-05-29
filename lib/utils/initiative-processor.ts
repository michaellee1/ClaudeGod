import { EventEmitter } from 'events'
import { InitiativeManager } from './initiative-manager'
import initiativeStore from './initiative-store'
import { Initiative as StoreInitiative, InitiativePhase, InitiativeStatus } from '../types/initiative'
import {
  AppError,
  ErrorCode,
  InitiativeError,
  ProcessError,
  ClaudeOutputMalformedError,
  FileNotFoundError,
  ConcurrentModificationError,
  toAppError
} from './errors'
import { withRetry, ErrorLogger, CircuitBreaker } from './error-handler'
import { InitiativeRecovery, RecoveryWorkflows } from './error-recovery'
import { InitiativeTransaction } from './rollback-manager'

interface QueuedPhase {
  initiativeId: string
  phase: InitiativePhase
  priority: number
  timestamp: number
  retryCount: number
}

interface ActiveProcess {
  initiativeId: string
  phase: InitiativePhase
  startTime: number
  healthCheckInterval?: NodeJS.Timeout
}

interface ProcessMetrics {
  totalProcessed: number
  totalFailed: number
  totalRetried: number
  averageProcessingTime: number
  lastProcessedAt?: Date
}

interface ExtendedMetrics extends ProcessMetrics {
  activeProcesses: number
  queueLength: number
}

export class InitiativeProcessor extends EventEmitter {
  private static instance: InitiativeProcessor
  private initiativeManager: InitiativeManager
  private queue: QueuedPhase[] = []
  private activeProcesses: Map<string, ActiveProcess> = new Map()
  private isRunning: boolean = false
  private processingInterval: NodeJS.Timeout | null = null
  private metrics: ProcessMetrics = {
    totalProcessed: 0,
    totalFailed: 0,
    totalRetried: 0,
    averageProcessingTime: 0
  }
  private circuitBreaker: CircuitBreaker
  private errorLogger: ErrorLogger
  private queueLock: boolean = false
  
  private readonly MAX_CONCURRENT_PROCESSES = 3
  private readonly HEALTH_CHECK_INTERVAL = 30000 // 30 seconds
  private readonly PROCESS_CHECK_INTERVAL = 5000 // 5 seconds
  private readonly MAX_RETRY_COUNT = 3
  
  private constructor() {
    super()
    this.initiativeManager = InitiativeManager.getInstance()
    this.circuitBreaker = new CircuitBreaker(5, 60000, 'initiative-processor')
    this.errorLogger = ErrorLogger.getInstance()
    this.setupEventHandlers()
  }
  
  static getInstance(): InitiativeProcessor {
    if (!InitiativeProcessor.instance) {
      InitiativeProcessor.instance = new InitiativeProcessor()
    }
    return InitiativeProcessor.instance
  }
  
  private setupEventHandlers(): void {
    // Handle initiative manager events
    this.initiativeManager.on('completed', ({ initiativeId, phase }) => {
      this.handleProcessCompletion(initiativeId, phase)
    })
    
    this.initiativeManager.on('error', ({ initiativeId, phase, error }) => {
      this.handleProcessError(initiativeId, phase, error)
    })
    
    this.initiativeManager.on('timeout', ({ initiativeId, phase }) => {
      this.handleProcessTimeout(initiativeId, phase)
    })
    
    // Handle process termination
    process.on('SIGINT', () => this.shutdown())
    process.on('SIGTERM', () => this.shutdown())
    process.on('uncaughtException', (error) => {
      this.errorLogger.log(error, { source: 'uncaughtException' })
      console.error('Uncaught exception in InitiativeProcessor:', error)
      this.shutdown()
    })
    process.on('unhandledRejection', (reason, promise) => {
      const error = reason instanceof Error ? reason : new Error(String(reason))
      this.errorLogger.log(error, { source: 'unhandledRejection', promise })
      console.error('Unhandled rejection in InitiativeProcessor:', reason)
    })
  }
  
  /**
   * Start the processor service
   */
  start(): void {
    if (this.isRunning) {
      console.log('Initiative processor is already running')
      return
    }
    
    this.isRunning = true
    console.log('Initiative processor started')
    
    // Start processing interval
    this.processingInterval = setInterval(() => {
      this.processNextInQueue()
    }, this.PROCESS_CHECK_INTERVAL)
    
    this.emit('started')
  }
  
  /**
   * Stop the processor service
   */
  stop(): void {
    if (!this.isRunning) {
      return
    }
    
    this.isRunning = false
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval)
      this.processingInterval = null
    }
    
    // Clear all health check intervals
    this.activeProcesses.forEach(process => {
      if (process.healthCheckInterval) {
        clearInterval(process.healthCheckInterval)
      }
    })
    
    console.log('Initiative processor stopped')
    this.emit('stopped')
  }
  
  /**
   * Queue an initiative phase for processing
   */
  queueInitiativePhase(initiativeId: string, phase: InitiativePhase): void {
    if (!this.isValidPhase(phase)) {
      throw new Error(`Invalid phase: ${phase}`)
    }
    
    // Check if already queued
    const existingIndex = this.queue.findIndex(
      item => item.initiativeId === initiativeId && item.phase === phase
    )
    
    if (existingIndex !== -1) {
      console.log(`Phase ${phase} for initiative ${initiativeId} is already queued`)
      return
    }
    
    // Add to queue with priority (lower number = higher priority)
    const queueItem: QueuedPhase = {
      initiativeId,
      phase,
      priority: this.getPhasePriority(phase),
      timestamp: Date.now(),
      retryCount: 0
    }
    
    this.queue.push(queueItem)
    this.sortQueue()
    
    console.log(`Queued phase ${phase} for initiative ${initiativeId}`)
    this.broadcastQueueUpdate()
    
    // Trigger immediate processing if not at capacity
    if (this.isRunning && this.activeProcesses.size < this.MAX_CONCURRENT_PROCESSES) {
      this.processNextInQueue()
    }
  }
  
  /**
   * Manually retry a failed phase
   */
  async retryFailedPhase(initiativeId: string): Promise<void> {
    try {
      const initiative = await this.getInitiativeWithLock(initiativeId)
      if (!initiative) {
        throw new InitiativeError(
          `Initiative ${initiativeId} not found`,
          ErrorCode.INITIATIVE_NOT_FOUND,
          { initiativeId }
        )
      }
    
      // Check if initiative has an error
      if (!initiative.lastError) {
        throw new Error(`No failed phase to retry for initiative ${initiativeId}`)
      }
    
      // Determine the phase to retry based on current status
      const phaseToRetry = this.getPhaseForStatus(initiative.status as InitiativeStatus)
      if (!phaseToRetry) {
        throw new Error(`Cannot determine phase to retry for status ${initiative.status}`)
      }
    
      // Find existing queue item or create new one
      const existingIndex = this.queue.findIndex(
        item => item.initiativeId === initiativeId
      )
      
      if (existingIndex !== -1) {
        // Increment retry count
        this.queue[existingIndex].retryCount++
        this.queue[existingIndex].timestamp = Date.now()
      } else {
        // Add to queue as retry
        const queueItem: QueuedPhase = {
          initiativeId,
          phase: phaseToRetry,
          priority: 0, // High priority for retries
          timestamp: Date.now(),
          retryCount: 1
        }
        this.queue.push(queueItem)
      }
      
      this.sortQueue()
      console.log(`Queued retry for phase ${phaseToRetry} of initiative ${initiativeId}`)
      this.broadcastQueueUpdate()
      
      // Clear error state
      await this.updateInitiativeWithRetry(initiativeId, { 
        lastError: undefined 
      })
    } catch (error) {
      throw error
    }
  }
  
  /**
   * Cancel an active process
   */
  async cancelActiveProcess(initiativeId: string): Promise<void> {
    const activeProcess = this.activeProcesses.get(initiativeId)
    if (!activeProcess) {
      throw new Error(`No active process found for initiative ${initiativeId}`)
    }
    
    console.log(`Cancelling process for initiative ${initiativeId}`)
    
    // Stop health checks
    if (activeProcess.healthCheckInterval) {
      clearInterval(activeProcess.healthCheckInterval)
    }
    
    // Remove from active processes
    this.activeProcesses.delete(initiativeId)
    
    // Remove from queue if present
    await this.modifyQueueSafely(() => {
      this.queue = this.queue.filter(
        item => item.initiativeId !== initiativeId
      )
    })
    
    // Update initiative status
    initiativeStore.update(initiativeId, {
      processId: undefined,
      lastError: 'Process cancelled by user'
    })
    
    this.broadcastStatusUpdate(initiativeId, 'cancelled')
    this.broadcastQueueUpdate()
  }
  
  /**
   * Process the next item in queue
   */
  private async processNextInQueue(): Promise<void> {
    if (!this.isRunning) {
      return
    }
    
    // Check capacity
    if (this.activeProcesses.size >= this.MAX_CONCURRENT_PROCESSES) {
      return
    }
    
    // Get next item from queue
    const nextItem = this.queue.shift()
    if (!nextItem) {
      return
    }
    
    // Verify initiative still exists and is in correct state
    const initiative = initiativeStore.get(nextItem.initiativeId)
    if (!initiative) {
      console.warn(`Initiative ${nextItem.initiativeId} no longer exists`)
      return
    }
    
    try {
      await this.circuitBreaker.execute(async () => {
        await this.startProcess(nextItem)
      })
    } catch (error) {
      const appError = toAppError(error)
      this.errorLogger.log(appError, { initiativeId: nextItem.initiativeId, phase: nextItem.phase })
      console.error(`Failed to start process for ${nextItem.initiativeId}:`, appError.message)
      
      // Re-queue if under retry limit
      if (nextItem.retryCount < this.MAX_RETRY_COUNT) {
        nextItem.retryCount++
        nextItem.timestamp = Date.now()
        this.queue.push(nextItem)
        this.sortQueue()
      } else {
        // Max retries reached
        initiativeStore.update(nextItem.initiativeId, {
          lastError: `Failed to start process after ${this.MAX_RETRY_COUNT} attempts: ${(error as Error).message}`
        })
        this.metrics.totalFailed++
      }
    }
  }
  
  /**
   * Start processing an initiative phase
   */
  private async startProcess(queueItem: QueuedPhase): Promise<void> {
    const { initiativeId, phase } = queueItem
    const startTime = Date.now()
    
    console.log(`Starting process for initiative ${initiativeId}, phase ${phase}`)
    
    // Validate required files exist before processing
    const validationError = await this.validatePhasePrerequisites(initiativeId, phase)
    if (validationError) {
      throw new InitiativeError(
        validationError,
        ErrorCode.INITIATIVE_INVALID_STATE,
        { initiativeId, phase }
      )
    }
    
    // Create recovery context
    const recovery = new InitiativeRecovery(initiativeId)
    const transaction = new InitiativeTransaction(initiativeId)
    
    // Create active process entry
    const activeProcess: ActiveProcess = {
      initiativeId,
      phase,
      startTime
    }
    
    // Set up health monitoring
    activeProcess.healthCheckInterval = setInterval(() => {
      this.performHealthCheck(initiativeId).catch(error => {
        console.error(`Health check failed for ${initiativeId}:`, error)
        this.handleProcessError(initiativeId, phase, error)
      })
    }, this.HEALTH_CHECK_INTERVAL)
    
    this.activeProcesses.set(initiativeId, activeProcess)
    
    // Update initiative with process info
    initiativeStore.update(initiativeId, {
      processId: String(process.pid), // Convert PID to string
      isActive: true
    })
    
    // Broadcast status update
    this.broadcastStatusUpdate(initiativeId, 'processing', phase)
    
    // Add rollback for process cleanup
    recovery.addRollback(
      'cleanup-process',
      `Cleanup process for ${initiativeId}`,
      async () => {
        if (activeProcess.healthCheckInterval) {
          clearInterval(activeProcess.healthCheckInterval)
        }
        this.activeProcesses.delete(initiativeId)
      }
    )
    
    try {
      // Start the actual process based on phase
      await recovery.executeWithRecovery(async () => {
        switch (phase) {
          case InitiativePhase.EXPLORATION:
            await withRetry(
              () => this.initiativeManager.startExploration(initiativeId),
              { maxRetries: 3, retryableErrors: ['NETWORK_ERROR', 'NETWORK_TIMEOUT'] }
            )
            break
            
          case InitiativePhase.RESEARCH_PREP:
            // This requires answers to be already saved
            const answers = await this.loadPhaseFileWithRetry(initiativeId, 'answers.json')
            try {
              const parsedAnswers = JSON.parse(answers)
              await withRetry(
                () => this.initiativeManager.processAnswers(initiativeId, parsedAnswers),
                { maxRetries: 3 }
              )
            } catch (parseError) {
              throw new ClaudeOutputMalformedError(answers, parseError instanceof Error ? parseError.message : String(parseError))
            }
            break
            
          case InitiativePhase.TASK_GENERATION:
            // This requires research to be already saved
            const research = await this.loadPhaseFileWithRetry(initiativeId, 'research.md')
            await withRetry(
              () => this.initiativeManager.processResearch(initiativeId, research),
              { maxRetries: 3 }
            )
            break
            
          default:
            throw new InitiativeError(
              `Cannot process phase ${phase} automatically`,
              ErrorCode.INITIATIVE_INVALID_STATE,
              { phase }
            )
        }
      }, {
        maxRetries: 2,
        rollbackOnFailure: true
      })
      
      transaction.commit()
    } catch (error) {
      // Recovery failed, handle the error
      throw error
    }
  }
  
  /**
   * Handle process completion
   */
  private handleProcessCompletion(initiativeId: string, phase: InitiativePhase): void {
    const activeProcess = this.activeProcesses.get(initiativeId)
    if (!activeProcess) {
      return
    }
    
    // Calculate processing time
    const processingTime = Date.now() - activeProcess.startTime
    this.updateMetrics(processingTime, true)
    
    // Clean up
    if (activeProcess.healthCheckInterval) {
      clearInterval(activeProcess.healthCheckInterval)
    }
    this.activeProcesses.delete(initiativeId)
    
    // Update initiative
    initiativeStore.update(initiativeId, {
      processId: undefined,
      isActive: false
    })
    
    console.log(`Process completed for initiative ${initiativeId}, phase ${phase} (${processingTime}ms)`)
    this.broadcastStatusUpdate(initiativeId, 'completed', phase)
    
    // Process next item in queue
    if (this.isRunning) {
      this.processNextInQueue()
    }
  }
  
  /**
   * Handle process error
   */
  private handleProcessError(initiativeId: string, phase: InitiativePhase, error: Error): void {
    const activeProcess = this.activeProcesses.get(initiativeId)
    if (!activeProcess) {
      return
    }
    
    // Calculate processing time
    const processingTime = Date.now() - activeProcess.startTime
    this.updateMetrics(processingTime, false)
    
    // Clean up
    if (activeProcess.healthCheckInterval) {
      clearInterval(activeProcess.healthCheckInterval)
    }
    this.activeProcesses.delete(initiativeId)
    
    // Update initiative with error
    initiativeStore.update(initiativeId, {
      processId: undefined,
      isActive: false,
      lastError: error.message
    })
    
    console.error(`Process failed for initiative ${initiativeId}, phase ${phase}:`, error)
    this.broadcastStatusUpdate(initiativeId, 'failed', phase, error.message)
    
    // Process next item in queue
    if (this.isRunning) {
      this.processNextInQueue()
    }
  }
  
  /**
   * Handle process timeout
   */
  private handleProcessTimeout(initiativeId: string, phase: InitiativePhase): void {
    this.handleProcessError(initiativeId, phase, new Error('Process timed out'))
  }
  
  /**
   * Perform health check on active process
   */
  private async performHealthCheck(initiativeId: string): Promise<void> {
    const activeProcess = this.activeProcesses.get(initiativeId)
    if (!activeProcess) {
      return
    }
    
    try {
      const initiative = await this.getInitiativeWithLock(initiativeId)
      if (!initiative) {
        // Initiative was deleted, clean up process
        console.warn(`Initiative ${initiativeId} no longer exists, cleaning up process`)
        if (activeProcess.healthCheckInterval) {
          clearInterval(activeProcess.healthCheckInterval)
        }
        this.activeProcesses.delete(initiativeId)
        return
      }
      
      // Check if Claude Code process is actually running
      const isProcessAlive = await this.checkProcessHealth(initiative.processId ? parseInt(initiative.processId) : undefined)
      
      if (!isProcessAlive) {
        // Process crashed, attempt recovery
        console.error(`Process crashed for initiative ${initiativeId}`)
        await RecoveryWorkflows.recoverFromProcessCrash(initiativeId, activeProcess.phase)
        throw new ProcessError(
          `Claude Code process crashed`,
          ErrorCode.CLAUDE_PROCESS_CRASHED,
          { initiativeId, phase: activeProcess.phase }
        )
      }
      
      // Check if process is stuck (running too long)
      const runningTime = Date.now() - activeProcess.startTime
      const maxRuntime = 30 * 60 * 1000 // 30 minutes
      
      if (runningTime > maxRuntime) {
        throw new ProcessError(
          `Process timeout after ${runningTime}ms`,
          ErrorCode.PROCESS_TIMEOUT,
          { initiativeId, runningTime }
        )
      }
      
      console.log(`Health check for ${initiativeId}: running for ${runningTime}ms`)
      
      // Broadcast health status
      this.broadcastHealthStatus(initiativeId, {
        phase: activeProcess.phase,
        runningTime,
        healthy: true
      })
    } catch (error) {
      // Health check failed, let the caller handle it
      throw error
    }
  }
  
  /**
   * Broadcast status update via WebSocket
   */
  private broadcastStatusUpdate(initiativeId: string, status: string, phase?: InitiativePhase, error?: string): void {
    if ((global as any).broadcastInitiativeOutput) {
      (global as any).broadcastInitiativeOutput(initiativeId, {
        type: 'status',
        status,
        phase,
        error,
        timestamp: new Date()
      })
    }
  }
  
  /**
   * Broadcast health status via WebSocket
   */
  private broadcastHealthStatus(initiativeId: string, health: any): void {
    if ((global as any).broadcastInitiativeOutput) {
      (global as any).broadcastInitiativeOutput(initiativeId, {
        type: 'health',
        ...health,
        timestamp: new Date()
      })
    }
  }
  
  /**
   * Broadcast queue update
   */
  private broadcastQueueUpdate(): void {
    this.emit('queueUpdate', {
      queueLength: this.queue.length,
      activeProcesses: this.activeProcesses.size,
      queue: this.queue.map(item => ({
        initiativeId: item.initiativeId,
        phase: item.phase,
        priority: item.priority,
        retryCount: item.retryCount
      }))
    })
  }
  
  /**
   * Update metrics
   */
  private updateMetrics(processingTime: number, success: boolean): void {
    if (success) {
      this.metrics.totalProcessed++
    } else {
      this.metrics.totalFailed++
    }
    
    // Update average processing time
    const totalProcesses = this.metrics.totalProcessed + this.metrics.totalFailed
    this.metrics.averageProcessingTime = 
      (this.metrics.averageProcessingTime * (totalProcesses - 1) + processingTime) / totalProcesses
    
    this.metrics.lastProcessedAt = new Date()
  }
  
  /**
   * Get metrics
   */
  getMetrics(): ExtendedMetrics {
    return {
      ...this.metrics,
      activeProcesses: this.activeProcesses.size,
      queueLength: this.queue.length
    }
  }
  
  /**
   * Get queue status
   */
  getQueueStatus(): any {
    return {
      isRunning: this.isRunning,
      queueLength: this.queue.length,
      activeProcesses: this.activeProcesses.size,
      maxConcurrent: this.MAX_CONCURRENT_PROCESSES,
      queue: this.queue.map(item => ({
        initiativeId: item.initiativeId,
        phase: item.phase,
        priority: item.priority,
        retryCount: item.retryCount,
        queuedAt: new Date(item.timestamp)
      })),
      active: Array.from(this.activeProcesses.entries()).map(([id, process]) => ({
        initiativeId: id,
        phase: process.phase,
        startTime: new Date(process.startTime),
        runningTime: Date.now() - process.startTime
      }))
    }
  }
  
  /**
   * Graceful shutdown
   */
  private async shutdown(): Promise<void> {
    console.log('Shutting down initiative processor...')
    this.stop()
    
    // Wait for active processes to complete (give them 5 seconds)
    const shutdownTimeout = setTimeout(() => {
      console.warn('Forced shutdown after timeout')
      process.exit(0)
    }, 5000)
    
    // Wait for all active processes to complete
    while (this.activeProcesses.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    clearTimeout(shutdownTimeout)
    console.log('Initiative processor shutdown complete')
    process.exit(0)
  }
  
  /**
   * Sort queue by priority and timestamp
   */
  private sortQueue(): void {
    this.queue.sort((a, b) => {
      // First sort by priority (lower number = higher priority)
      if (a.priority !== b.priority) {
        return a.priority - b.priority
      }
      // Then by timestamp (older first)
      return a.timestamp - b.timestamp
    })
  }
  
  /**
   * Get phase priority
   */
  private getPhasePriority(phase: InitiativePhase): number {
    const priorities: Record<InitiativePhase, number> = {
      [InitiativePhase.EXPLORATION]: 1,
      [InitiativePhase.QUESTIONS]: 2,
      [InitiativePhase.RESEARCH_PREP]: 3,
      [InitiativePhase.RESEARCH_REVIEW]: 4,
      [InitiativePhase.TASK_GENERATION]: 5,
      [InitiativePhase.READY]: 6
    }
    return priorities[phase] || 10
  }
  
  /**
   * Check if phase is valid for processing
   */
  private isValidPhase(phase: InitiativePhase): boolean {
    return [
      InitiativePhase.EXPLORATION,
      InitiativePhase.RESEARCH_PREP,
      InitiativePhase.TASK_GENERATION
    ].includes(phase)
  }
  
  /**
   * Get phase for status
   */
  private getPhaseForStatus(status: InitiativeStatus): InitiativePhase | null {
    const statusPhaseMap: Record<InitiativeStatus, InitiativePhase> = {
      [InitiativeStatus.EXPLORING]: InitiativePhase.EXPLORATION,
      [InitiativeStatus.AWAITING_ANSWERS]: InitiativePhase.QUESTIONS,
      [InitiativeStatus.RESEARCHING]: InitiativePhase.RESEARCH_PREP,
      [InitiativeStatus.AWAITING_RESEARCH]: InitiativePhase.RESEARCH_REVIEW,
      [InitiativeStatus.PLANNING]: InitiativePhase.TASK_GENERATION,
      [InitiativeStatus.READY_FOR_TASKS]: InitiativePhase.READY,
      [InitiativeStatus.TASKS_SUBMITTED]: InitiativePhase.READY,
      [InitiativeStatus.COMPLETED]: InitiativePhase.READY
    }
    return statusPhaseMap[status] || null
  }
  
  /**
   * Helper methods for error handling
   */
  
  private async getInitiativeWithLock(initiativeId: string): Promise<StoreInitiative | undefined> {
    const maxRetries = 5
    let retries = 0
    
    while (retries < maxRetries) {
      try {
        const initiative = initiativeStore.get(initiativeId)
        if (!initiative) return undefined
        
        // Check if initiative is locked by another process
        if (initiative.isActive && !this.activeProcesses.has(initiativeId)) {
          // Another process has it, wait
          await new Promise(resolve => setTimeout(resolve, 1000))
          retries++
          continue
        }
        
        return initiative
      } catch (error) {
        if (retries === maxRetries - 1) {
          throw new ConcurrentModificationError('initiative', 'read')
        }
        await new Promise(resolve => setTimeout(resolve, 500))
        retries++
      }
    }
    
    throw new ConcurrentModificationError('initiative', 'read')
  }
  
  private async updateInitiativeWithRetry(initiativeId: string, updates: Partial<StoreInitiative>): Promise<void> {
    await withRetry(
      async () => {
        try {
          await initiativeStore.update(initiativeId, updates)
        } catch (error) {
          throw new ConcurrentModificationError('initiative', 'update')
        }
      },
      { maxRetries: 3, initialDelay: 500 }
    )
  }
  
  private async loadPhaseFileWithRetry(initiativeId: string, filename: string): Promise<string> {
    return await withRetry(
      async () => {
        try {
          return await initiativeStore.loadPhaseFile(initiativeId, filename)
        } catch (error) {
          const err = error as any
          if (err.code === 'ENOENT') {
            throw new FileNotFoundError(`${initiativeId}/${filename}`)
          }
          throw error
        }
      },
      { maxRetries: 3, retryableErrors: ['FILE_OPERATION_FAILED'] }
    )
  }
  
  private async modifyQueueSafely(modifier: () => void): Promise<void> {
    const maxRetries = 10
    let retries = 0
    
    while (retries < maxRetries) {
      if (!this.queueLock) {
        this.queueLock = true
        try {
          modifier()
          return
        } finally {
          this.queueLock = false
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 50))
      retries++
    }
    
    throw new ConcurrentModificationError('queue', 'modify')
  }
  
  private async checkProcessHealth(pid?: number): Promise<boolean> {
    if (!pid || isNaN(pid)) return false
    
    try {
      // Check if process exists by sending signal 0
      process.kill(pid, 0)
      return true
    } catch (error) {
      // Process doesn't exist
      return false
    }
  }
  
  /**
   * Validate that required files exist for a phase
   */
  private async validatePhasePrerequisites(initiativeId: string, phase: InitiativePhase): Promise<string | null> {
    try {
      switch (phase) {
        case InitiativePhase.EXPLORATION:
          // No prerequisites for exploration
          return null
          
        case InitiativePhase.RESEARCH_PREP:
          // Requires answers.json from questions phase
          try {
            await initiativeStore.loadPhaseFile(initiativeId, 'answers.json')
          } catch (error) {
            return 'Missing required file: answers.json. Questions phase must be completed first.'
          }
          
          // Also validate exploration output exists
          try {
            await initiativeStore.loadPhaseFile(initiativeId, 'exploration.md')
          } catch (error) {
            return 'Missing required file: exploration.md. Exploration phase must be completed first.'
          }
          return null
          
        case InitiativePhase.TASK_GENERATION:
          // Requires research.md from research phase
          try {
            await initiativeStore.loadPhaseFile(initiativeId, 'research.md')
          } catch (error) {
            return 'Missing required file: research.md. Research phase must be completed first.'
          }
          
          // Also validate previous phase outputs exist
          const requiredFiles = ['exploration.md', 'questions.json', 'answers.json', 'research-needs.md']
          for (const file of requiredFiles) {
            try {
              await initiativeStore.loadPhaseFile(initiativeId, file)
            } catch (error) {
              console.warn(`Optional file missing for better context: ${file}`)
              // These are optional for better context, don't fail
            }
          }
          return null
          
        default:
          return `Phase ${phase} cannot be processed automatically`
      }
    } catch (error) {
      return `Error validating prerequisites: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

// Export singleton instance
export default InitiativeProcessor.getInstance()