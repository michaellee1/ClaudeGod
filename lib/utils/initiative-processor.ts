import { EventEmitter } from 'events'
import { InitiativeManager } from './initiative-manager'
import initiativeStore, { type Initiative as StoreInitiative } from './initiative-store'
import { InitiativePhase, InitiativeStatus } from '../types/initiative'

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
  
  private readonly MAX_CONCURRENT_PROCESSES = 3
  private readonly HEALTH_CHECK_INTERVAL = 30000 // 30 seconds
  private readonly PROCESS_CHECK_INTERVAL = 5000 // 5 seconds
  private readonly MAX_RETRY_COUNT = 3
  
  private constructor() {
    super()
    this.initiativeManager = InitiativeManager.getInstance()
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
  retryFailedPhase(initiativeId: string): void {
    const initiative = initiativeStore.get(initiativeId)
    if (!initiative) {
      throw new Error(`Initiative ${initiativeId} not found`)
    }
    
    // Store interfaces don't have lastError, check phase data
    const hasError = initiative.phaseData?.error
    if (!hasError) {
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
    initiativeStore.update(initiativeId, { phaseData: { ...initiative.phaseData, error: undefined } })
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
    this.queue = this.queue.filter(
      item => item.initiativeId !== initiativeId
    )
    
    // Update initiative status
    initiativeStore.update(initiativeId, {
      claudeCodePid: undefined,
      phaseData: { error: 'Process cancelled by user' }
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
      await this.startProcess(nextItem)
    } catch (error) {
      console.error(`Failed to start process for ${nextItem.initiativeId}:`, error)
      
      // Re-queue if under retry limit
      if (nextItem.retryCount < this.MAX_RETRY_COUNT) {
        nextItem.retryCount++
        nextItem.timestamp = Date.now()
        this.queue.push(nextItem)
        this.sortQueue()
      } else {
        // Max retries reached
        initiativeStore.update(nextItem.initiativeId, {
          phaseData: { error: `Failed to start process after ${this.MAX_RETRY_COUNT} attempts: ${(error as Error).message}` }
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
    
    // Create active process entry
    const activeProcess: ActiveProcess = {
      initiativeId,
      phase,
      startTime
    }
    
    // Set up health monitoring
    activeProcess.healthCheckInterval = setInterval(() => {
      this.performHealthCheck(initiativeId)
    }, this.HEALTH_CHECK_INTERVAL)
    
    this.activeProcesses.set(initiativeId, activeProcess)
    
    // Update initiative with process info
    initiativeStore.update(initiativeId, {
      claudeCodePid: process.pid, // Using current process PID as placeholder
      isActive: true
    })
    
    // Broadcast status update
    this.broadcastStatusUpdate(initiativeId, 'processing', phase)
    
    // Start the actual process based on phase
    switch (phase) {
      case InitiativePhase.EXPLORATION:
        await this.initiativeManager.startExploration(initiativeId)
        break
        
      case InitiativePhase.RESEARCH_PREP:
        // This requires answers to be already saved
        const answers = await initiativeStore.loadPhaseFile(initiativeId, 'answers.json')
        await this.initiativeManager.processAnswers(initiativeId, JSON.parse(answers))
        break
        
      case InitiativePhase.TASK_GENERATION:
        // This requires research to be already saved
        const research = await initiativeStore.loadPhaseFile(initiativeId, 'research.md')
        await this.initiativeManager.processResearch(initiativeId, research)
        break
        
      default:
        throw new Error(`Cannot process phase ${phase} automatically`)
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
      claudeCodePid: undefined,
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
      claudeCodePid: undefined,
      isActive: false,
      phaseData: { error: error.message }
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
  private performHealthCheck(initiativeId: string): void {
    const activeProcess = this.activeProcesses.get(initiativeId)
    if (!activeProcess) {
      return
    }
    
    const initiative = initiativeStore.get(initiativeId)
    if (!initiative) {
      // Initiative was deleted, clean up process
      console.warn(`Initiative ${initiativeId} no longer exists, cleaning up process`)
      if (activeProcess.healthCheckInterval) {
        clearInterval(activeProcess.healthCheckInterval)
      }
      this.activeProcesses.delete(initiativeId)
      return
    }
    
    // Check if process is still running (basic check)
    const runningTime = Date.now() - activeProcess.startTime
    console.log(`Health check for ${initiativeId}: running for ${runningTime}ms`)
    
    // Broadcast health status
    this.broadcastHealthStatus(initiativeId, {
      phase: activeProcess.phase,
      runningTime,
      healthy: true
    })
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
}

// Export singleton instance
export default InitiativeProcessor.getInstance()