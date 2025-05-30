import { getPersistentLogger } from './persistent-logger'
import { getPersistentState } from './persistent-state'
import { getSyncService } from './sync-service'
import { taskStore } from './task-store'

export interface ShutdownOptions {
  timeout?: number // ms
  forceful?: boolean
  saveState?: boolean
}

/**
 * GracefulShutdown handles clean server shutdown with data persistence
 */
export class GracefulShutdown {
  private logger = getPersistentLogger()
  private persistentState = getPersistentState()
  private syncService = getSyncService()
  private isShuttingDown = false
  private shutdownHandlers: Array<() => Promise<void>> = []
  
  constructor() {
    this.setupSignalHandlers()
  }
  
  /**
   * Register a shutdown handler
   */
  registerHandler(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler)
  }
  
  /**
   * Setup signal handlers
   */
  private setupSignalHandlers(): void {
    // Handle various shutdown signals
    const signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'] as const
    
    signals.forEach(signal => {
      process.on(signal, async () => {
        console.log(`\n[GracefulShutdown] Received ${signal}`)
        await this.shutdown({ 
          timeout: signal === 'SIGTERM' ? 30000 : 10000,
          saveState: true 
        })
      })
    })
    
    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      console.error('[GracefulShutdown] Uncaught exception:', error)
      await this.logger.logError(error, { type: 'uncaughtException' })
      await this.shutdown({ timeout: 5000, forceful: true })
    })
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason, promise) => {
      const error = reason instanceof Error ? reason : new Error(String(reason))
      console.error('[GracefulShutdown] Unhandled rejection:', error)
      await this.logger.logError(error, { 
        type: 'unhandledRejection',
        promise: String(promise)
      })
      // Don't shutdown on unhandled rejection, just log it
    })
    
    // Handle process exit
    process.on('exit', (code) => {
      console.log(`[GracefulShutdown] Process exiting with code ${code}`)
      this.logger.logSystemEvent('process-exit', { exitCode: code })
    })
  }
  
  /**
   * Perform graceful shutdown
   */
  async shutdown(options: ShutdownOptions = {}): Promise<void> {
    if (this.isShuttingDown) {
      console.log('[GracefulShutdown] Shutdown already in progress')
      return
    }
    
    this.isShuttingDown = true
    const timeout = options.timeout || 30000
    const startTime = Date.now()
    
    console.log('[GracefulShutdown] Starting graceful shutdown...')
    await this.logger.logSystemEvent('shutdown-started', { options })
    
    // Set up timeout
    const timeoutId = setTimeout(() => {
      console.error('[GracefulShutdown] Shutdown timeout exceeded, forcing exit')
      this.forceExit(1)
    }, timeout)
    
    try {
      // Step 1: Stop accepting new connections
      await this.stopAcceptingConnections()
      
      // Step 2: Close existing connections gracefully
      await this.closeConnections()
      
      // Step 3: Stop background services
      await this.stopServices()
      
      // Step 4: Save current state if requested
      if (options.saveState) {
        await this.saveCurrentState()
      }
      
      // Step 5: Run custom shutdown handlers
      await this.runShutdownHandlers()
      
      // Step 6: Close persistent services
      await this.closePersistentServices()
      
      const duration = Date.now() - startTime
      console.log(`[GracefulShutdown] Shutdown completed in ${duration}ms`)
      await this.logger.logSystemEvent('shutdown-completed', { duration })
      
      clearTimeout(timeoutId)
      
      // Exit cleanly
      process.exit(0)
      
    } catch (error) {
      console.error('[GracefulShutdown] Error during shutdown:', error)
      await this.logger.logError(error as Error, { phase: 'shutdown' })
      
      if (options.forceful) {
        this.forceExit(1)
      } else {
        // Try to exit cleanly anyway
        process.exit(1)
      }
    }
  }
  
  /**
   * Stop accepting new connections
   */
  private async stopAcceptingConnections(): Promise<void> {
    console.log('[GracefulShutdown] Stopping new connections...')
    
    // Close WebSocket server
    if ((global as any).wss) {
      await new Promise<void>((resolve) => {
        (global as any).wss.close(() => {
          console.log('[GracefulShutdown] WebSocket server closed')
          resolve()
        })
      })
    }
  }
  
  /**
   * Close existing connections
   */
  private async closeConnections(): Promise<void> {
    console.log('[GracefulShutdown] Closing existing connections...')
    
    // Close WebSocket connections
    if ((global as any).wss) {
      const wss = (global as any).wss
      const closePromises: Promise<void>[] = []
      
      wss.clients.forEach((client: any) => {
        if (client.readyState === 1) { // OPEN
          closePromises.push(new Promise<void>((resolve) => {
            client.close(1000, 'Server shutting down')
            client.once('close', resolve)
            // Timeout individual connection close
            setTimeout(resolve, 1000)
          }))
        }
      })
      
      await Promise.all(closePromises)
      console.log(`[GracefulShutdown] Closed ${closePromises.length} WebSocket connections`)
    }
  }
  
  /**
   * Stop background services
   */
  private async stopServices(): Promise<void> {
    console.log('[GracefulShutdown] Stopping background services...')
    
    // Stop sync service
    try {
      this.syncService.stop()
      console.log('[GracefulShutdown] Sync service stopped')
    } catch (error) {
      console.error('[GracefulShutdown] Error stopping sync service:', error)
    }
    
    // Stop task monitoring
    try {
      taskStore.cleanup()
      console.log('[GracefulShutdown] Task monitoring stopped')
    } catch (error) {
      console.error('[GracefulShutdown] Error stopping task monitoring:', error)
    }
  }
  
  /**
   * Save current state
   */
  private async saveCurrentState(): Promise<void> {
    console.log('[GracefulShutdown] Saving current state...')
    
    try {
      // Force a final sync
      const syncReport = await this.syncService.performSync()
      console.log(`[GracefulShutdown] Final sync completed: ${syncReport.tasksSynced} tasks synced`)
      
      // Create a snapshot
      const snapshotId = await this.persistentState.createSnapshot()
      console.log(`[GracefulShutdown] Created snapshot: ${snapshotId}`)
      
    } catch (error) {
      console.error('[GracefulShutdown] Error saving state:', error)
      // Don't throw - we still want to shutdown
    }
  }
  
  /**
   * Run custom shutdown handlers
   */
  private async runShutdownHandlers(): Promise<void> {
    console.log(`[GracefulShutdown] Running ${this.shutdownHandlers.length} shutdown handlers...`)
    
    for (const handler of this.shutdownHandlers) {
      try {
        await handler()
      } catch (error) {
        console.error('[GracefulShutdown] Error in shutdown handler:', error)
      }
    }
  }
  
  /**
   * Close persistent services
   */
  private async closePersistentServices(): Promise<void> {
    console.log('[GracefulShutdown] Closing persistent services...')
    
    try {
      // Close persistent state
      await this.persistentState.close()
      console.log('[GracefulShutdown] Persistent state closed')
    } catch (error) {
      console.error('[GracefulShutdown] Error closing persistent state:', error)
    }
    
    try {
      // Close logger last
      await this.logger.close()
      console.log('[GracefulShutdown] Logger closed')
    } catch (error) {
      console.error('[GracefulShutdown] Error closing logger:', error)
    }
  }
  
  /**
   * Force exit
   */
  private forceExit(code: number): void {
    console.error(`[GracefulShutdown] Force exiting with code ${code}`)
    process.exit(code)
  }
}

// Singleton instance
export const gracefulShutdown = new GracefulShutdown()