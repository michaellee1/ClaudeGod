import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer, WebSocket } from 'ws'
import { mergeProtectionMiddleware } from './lib/utils/merge-protection'
import { runStartupMigrations } from './lib/utils/initiative-migration'
import { getPersistentLogger } from './lib/utils/persistent-logger'
import { getSyncService } from './lib/utils/sync-service'
import { recoveryManager } from './lib/utils/recovery-manager'
import { gracefulShutdown } from './lib/utils/graceful-shutdown'

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = parseInt(process.env.PORT || '3000', 10)
const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

// Store WebSocket server instance
let wss: WebSocketServer | null = null

// Extend WebSocket type to include custom properties
interface ExtendedWebSocket extends WebSocket {
  connectionId?: string
  isAlive?: boolean
}

// Store active connections by task ID
const taskConnections = new Map<string, Set<ExtendedWebSocket>>()

// Store active connections by initiative ID
const initiativeConnections = new Map<string, Set<ExtendedWebSocket>>()

// Initialize persistent logger
const logger = getPersistentLogger()

// Broadcast task update to all connected clients
function broadcastTaskUpdate(taskId: string, update: any): void {
  if (!wss) return

  const message = JSON.stringify({
    type: 'task-update',
    taskId,
    data: update
  })

  // Log the broadcast event
  logger.logWebSocketEvent('task-update-broadcast', {
    taskId,
    updateType: update.status || 'unknown',
    clientCount: wss.clients.size
  }, { taskId })

  // Broadcast to all clients (for task list)
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(message)
      } catch (error) {
        console.error('Error sending task update to client:', error)
        logger.logError(error as Error, { taskId, event: 'task-update-broadcast' })
      }
    }
  })
}

// Broadcast output to task-specific connections
function broadcastTaskOutput(taskId: string, output: any): void {
  if (!wss) return

  const message = JSON.stringify({
    type: 'task-output',
    taskId,
    data: output
  })

  // Log the output event
  logger.logTaskEvent(taskId, 'output-broadcast', {
    outputType: output.type || 'unknown',
    contentLength: output.content?.length || 0,
    timestamp: output.timestamp
  })

  // Send to task-specific connections only
  const connections = taskConnections.get(taskId)
  if (connections) {
    connections.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(message)
        } catch (error) {
          console.error(`Error sending output to client for task ${taskId}:`, error)
          logger.logError(error as Error, { taskId, event: 'task-output-broadcast' })
        }
      }
    })
  }
}

// Clean up connections for a removed task
function cleanupTaskConnections(taskId: string): void {
  const connections = taskConnections.get(taskId)
  if (connections) {
    connections.forEach((client) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({
          type: 'task-removed',
          taskId
        }))
      }
    })
    taskConnections.delete(taskId)
  }
}

// Broadcast initiative update to all connected clients
function broadcastInitiativeUpdate(initiative: any): void {
  if (!wss) return

  // Ensure dates are properly serializable
  const safeInitiative = {
    ...initiative,
    createdAt: initiative.createdAt instanceof Date ? initiative.createdAt.toISOString() : 
               initiative.createdAt || new Date().toISOString(),
    updatedAt: initiative.updatedAt instanceof Date ? initiative.updatedAt.toISOString() : 
               initiative.updatedAt || new Date().toISOString(),
    completedAt: initiative.completedAt instanceof Date ? initiative.completedAt.toISOString() : 
                 initiative.completedAt || null
  }

  const message = JSON.stringify({
    type: 'initiative-update',
    initiativeId: initiative.id,
    data: safeInitiative,
    messageId: `init-${initiative.id}-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    timestamp: Date.now()
  })

  // Broadcast to all clients (for initiative list)
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(message)
      } catch (error) {
        console.error('Error sending initiative update to client:', error)
      }
    }
  })
}

// Broadcast output to initiative-specific connections
function broadcastInitiativeOutput(initiativeId: string, output: any): void {
  if (!wss) {
    console.warn('[Server] WebSocket server not initialized')
    return
  }

  const message = JSON.stringify({
    type: 'initiative-output',
    initiativeId,
    data: output,
    messageId: `output-${initiativeId}-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    timestamp: Date.now()
  })

  // Send to initiative-specific connections only
  const connections = initiativeConnections.get(initiativeId)
  console.log(`[Server] Broadcasting to initiative ${initiativeId}, ${connections ? connections.size : 0} connections`)
  
  if (connections && connections.size > 0) {
    connections.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(message)
          console.log(`[Server] Sent output to client for initiative ${initiativeId}`)
        } catch (error) {
          console.error(`[Server] Error sending output to client for initiative ${initiativeId}:`, error)
        }
      }
    })
  } else {
    console.warn(`[Server] No active connections for initiative ${initiativeId}`)
  }
}

// Clean up connections for a removed initiative
function cleanupInitiativeConnections(initiativeId: string): void {
  const connections = initiativeConnections.get(initiativeId)
  if (connections) {
    connections.forEach((client) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({
          type: 'initiative-removed',
          initiativeId
        }))
      }
    })
    initiativeConnections.delete(initiativeId)
  }
}

// WebSocket reconnection trigger
function triggerWebSocketReconnection(taskId: string): void {
  console.log(`[Server] Triggering WebSocket reconnection for task ${taskId}`)
  const connections = taskConnections.get(taskId)
  if (connections) {
    const message = JSON.stringify({
      type: 'reconnect-required',
      taskId,
      reason: 'No activity detected'
    })
    connections.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(message)
        } catch (error) {
          console.error(`Error sending reconnection request for task ${taskId}:`, error)
        }
      }
    })
  }
}

// Export functions for use in other modules
declare global {
  var broadcastTaskUpdate: (taskId: string, update: any) => void
  var broadcastTaskOutput: (taskId: string, output: any) => void
  var cleanupTaskConnections: (taskId: string) => void
  var broadcastInitiativeUpdate: (initiativeId: string, update: any) => void
  var broadcastInitiativeOutput: (initiativeId: string, output: any) => void
  var cleanupInitiativeConnections: (initiativeId: string) => void
  var triggerWebSocketReconnection: (taskId: string) => void
  var server: any
  var wss: WebSocketServer | null
}

global.broadcastTaskUpdate = broadcastTaskUpdate
global.broadcastTaskOutput = broadcastTaskOutput
global.cleanupTaskConnections = cleanupTaskConnections
global.broadcastInitiativeUpdate = broadcastInitiativeUpdate
global.broadcastInitiativeOutput = broadcastInitiativeOutput
global.cleanupInitiativeConnections = cleanupInitiativeConnections
global.triggerWebSocketReconnection = triggerWebSocketReconnection

// Enable merge protection
mergeProtectionMiddleware()

// Initialize YOLO mode handler
// TODO: Fix TypeScript module loading issue
// import { YoloModeHandler } from './lib/utils/yolo-mode-handler'
// YoloModeHandler.getInstance()

// Initialize initiative processor (commented out for now - manual start only)
// import initiativeProcessor from './lib/utils/initiative-processor'
// initiativeProcessor.start()

app.prepare().then(async () => {
  // Run database migrations on startup
  try {
    await runStartupMigrations()
  } catch (error) {
    console.error('Failed to run startup migrations:', error)
    // Continue startup even if migrations fail
  }

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
      recoverTasks: true,
      recoverInitiatives: true,
      recoverOutputs: true
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

  // Initialize WebSocket server
  wss = new WebSocketServer({
    server,
    path: '/ws'
  })

  wss.on('connection', (ws: ExtendedWebSocket, req) => {
    console.log('New WebSocket connection')
    
    // Generate connection ID for tracking
    const connectionId = `conn-${Date.now()}-${Math.random().toString(36).substring(7)}`
    ws.connectionId = connectionId
    
    // Set up ping/pong heartbeat
    ws.isAlive = true
    ws.on('pong', () => {
      ws.isAlive = true
    })
    
    // Parse task ID from query params if provided
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const taskId = url.searchParams.get('taskId')
    const initiativeId = url.searchParams.get('initiativeId')
    
    // Log connection event
    logger.logWebSocketEvent('connection-established', {
      connectionId,
      taskId,
      initiativeId,
      clientAddress: req.socket.remoteAddress,
      headers: req.headers
    })
    
    // Validate taskId format (basic validation)
    if (taskId && /^[a-zA-Z0-9-_]+$/.test(taskId)) {
      // Add to task-specific connections
      if (!taskConnections.has(taskId)) {
        taskConnections.set(taskId, new Set())
      }
      taskConnections.get(taskId)!.add(ws)
      console.log(`Client subscribed to task ${taskId}`)
    }
    
    // Validate initiativeId format (basic validation)
    if (initiativeId && /^[a-zA-Z0-9-_]+$/.test(initiativeId)) {
      // Add to initiative-specific connections
      if (!initiativeConnections.has(initiativeId)) {
        initiativeConnections.set(initiativeId, new Set())
      }
      initiativeConnections.get(initiativeId)!.add(ws)
      console.log(`Client subscribed to initiative ${initiativeId}`)
    }

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString())
        
        // Update heartbeat for task-specific messages
        // TODO: Fix TypeScript module loading issue
        // if (data.taskId) {
        //   import('./lib/utils/task-store').then(({ taskStore }) => {
        //     if (taskStore.updateTaskHeartbeat) {
        //       taskStore.updateTaskHeartbeat(data.taskId)
        //     }
        //   })
        // }
        
        if (data.type === 'subscribe' && data.taskId && /^[a-zA-Z0-9-_]+$/.test(data.taskId)) {
          // Subscribe to a specific task
          if (!taskConnections.has(data.taskId)) {
            taskConnections.set(data.taskId, new Set())
          }
          taskConnections.get(data.taskId)!.add(ws)
          console.log(`Client subscribed to task ${data.taskId}`)
          // Send acknowledgment
          ws.send(JSON.stringify({ type: 'subscribed', taskId: data.taskId }))
        } else if (data.type === 'unsubscribe' && data.taskId && /^[a-zA-Z0-9-_]+$/.test(data.taskId)) {
          // Unsubscribe from a task
          const connections = taskConnections.get(data.taskId)
          if (connections) {
            connections.delete(ws)
            if (connections.size === 0) {
              taskConnections.delete(data.taskId)
            }
          }
          console.log(`Client unsubscribed from task ${data.taskId}`)
          // Send acknowledgment
          ws.send(JSON.stringify({ type: 'unsubscribed', taskId: data.taskId }))
        } else if (data.type === 'subscribe' && data.initiativeId && /^[a-zA-Z0-9-_]+$/.test(data.initiativeId)) {
          // Subscribe to a specific initiative
          if (!initiativeConnections.has(data.initiativeId)) {
            initiativeConnections.set(data.initiativeId, new Set())
          }
          initiativeConnections.get(data.initiativeId)!.add(ws)
          console.log(`Client subscribed to initiative ${data.initiativeId}`)
          // Send acknowledgment
          ws.send(JSON.stringify({ type: 'subscribed', initiativeId: data.initiativeId }))
        } else if (data.type === 'unsubscribe' && data.initiativeId && /^[a-zA-Z0-9-_]+$/.test(data.initiativeId)) {
          // Unsubscribe from an initiative
          const connections = initiativeConnections.get(data.initiativeId)
          if (connections) {
            connections.delete(ws)
            if (connections.size === 0) {
              initiativeConnections.delete(data.initiativeId)
            }
          }
          console.log(`Client unsubscribed from initiative ${data.initiativeId}`)
          // Send acknowledgment
          ws.send(JSON.stringify({ type: 'unsubscribed', initiativeId: data.initiativeId }))
        } else if (data.type === 'ping') {
          // Respond to ping with pong
          ws.send(JSON.stringify({ type: 'pong' }))
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error)
      }
    })

    ws.on('close', () => {
      // Remove from all task connections
      for (const [taskId, connections] of taskConnections) {
        connections.delete(ws)
        if (connections.size === 0) {
          taskConnections.delete(taskId)
        }
      }
      // Remove from all initiative connections
      for (const [initiativeId, connections] of initiativeConnections) {
        connections.delete(ws)
        if (connections.size === 0) {
          initiativeConnections.delete(initiativeId)
        }
      }
      console.log('WebSocket connection closed')
    })

    ws.on('error', (error) => {
      console.error('WebSocket error:', error)
    })

    // Send initial connection acknowledgment
    ws.send(JSON.stringify({ type: 'connected' }))
  })

  // Set up heartbeat interval to detect broken connections
  const heartbeatInterval = setInterval(() => {
    wss!.clients.forEach((ws) => {
      const extWs = ws as ExtendedWebSocket
      if (extWs.isAlive === false) {
        // Remove from all task connections before terminating
        for (const [taskId, connections] of taskConnections) {
          connections.delete(extWs)
          if (connections.size === 0) {
            taskConnections.delete(taskId)
          }
        }
        // Remove from all initiative connections before terminating
        for (const [initiativeId, connections] of initiativeConnections) {
          connections.delete(extWs)
          if (connections.size === 0) {
            initiativeConnections.delete(initiativeId)
          }
        }
        return extWs.terminate()
      }
      
      extWs.isAlive = false
      extWs.ping()
    })
  }, 30000) // 30 seconds

  wss.on('close', () => {
    clearInterval(heartbeatInterval)
  })

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
    console.log('> WebSocket server running on ws://localhost:3000/ws')
    
    // Log successful startup
    logger.logSystemEvent('server-started', {
      port,
      hostname,
      env: dev ? 'development' : 'production'
    })
    
    // Store server reference for graceful shutdown
    global.server = server
    global.wss = wss
    
    // Register shutdown handler for HTTP server
    gracefulShutdown.registerHandler(async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
      console.log('[Server] HTTP server closed')
    })
  })
  
  // Handle server startup errors
  server.on('error', (error: any) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[Server] Port ${port} is already in use`)
      console.error('[Server] Please stop the existing server or use a different port')
      
      // Log the error
      logger.logError(error, {
        type: 'server-startup-error',
        code: 'EADDRINUSE',
        port
      })
      
      // Exit cleanly without triggering uncaught exception handler
      process.exit(1)
    } else {
      console.error('[Server] Server error:', error)
      logger.logError(error, { type: 'server-error' })
      
      // For other errors, let the graceful shutdown handle it
      throw error
    }
  })
})