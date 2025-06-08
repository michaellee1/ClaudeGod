import next from 'next'
import { createServer } from 'http'
import { parse } from 'url'
import { gracefulShutdown } from './lib/utils/graceful-shutdown'
import { getSyncService } from './lib/utils/sync-service'
import { recoveryManager } from './lib/utils/recovery-manager'
import { getPersistentLogger } from './lib/utils/persistent-logger'
import { mergeProtectionMiddleware } from './lib/utils/merge-protection'

const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()
const port = process.env.PORT || 3000

const logger = getPersistentLogger()

// Export server for use in other modules
declare global {
  var server: any
}

// Enable merge protection
mergeProtectionMiddleware()

app.prepare().then(async () => {
  // Initialize persistent logger
  logger.logSystemEvent('server-starting', {
    env: dev ? 'development' : 'production',
    port,
    timestamp: new Date()
  })

  // Perform recovery if needed
  try {
    console.log('Checking for recovery needs...')
    const recoveryReport = await recoveryManager.performRecovery({
      recoverTasks: true
    })
    
    if (recoveryReport.tasksRecovered > 0 || recoveryReport.errors.length > 0) {
      console.log('Recovery report:', recoveryReport)
    }
  } catch (error) {
    console.error('Recovery failed:', error)
    logger.logError(error as Error, { phase: 'startup-recovery' })
  }

  // Start sync service
  const syncService = getSyncService({
    syncInterval: 30000, // 30 seconds
    conflictResolution: 'newest-wins'
  })
  syncService.start()
  
  syncService.on('sync-error', (error: Error) => {
    console.error('Sync service error:', error)
    logger.logError(error, { service: 'sync-service' })
  })
  
  syncService.on('sync-completed', (report: any) => {
    if (report.conflicts.length > 0 || report.errors.length > 0) {
      console.log('Sync report:', report)
    }
  })

  const server = createServer(async (req, res) => {
    const parsedUrl = parse(req.url!, true)
    await handle(req, res, parsedUrl)
  })

  // Store server reference
  global.server = server

  // Register shutdown handler for sync service
  gracefulShutdown.registerHandler(async () => {
    console.log('[GracefulShutdown] Stopping sync service...')
    syncService.stop()
    console.log('[GracefulShutdown] Sync service stopped')
  })

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`)
    logger.logSystemEvent('server-started', {
      port,
      timestamp: new Date()
    })
  })

  server.on('error', (error: any) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Please use a different port.`)
      process.exit(1)
    } else {
      console.error('Server error:', error)
      logger.logError(error, { phase: 'server-runtime' })
    }
  })
})