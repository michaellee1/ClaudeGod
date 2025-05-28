const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { WebSocketServer } = require('ws')
const { mergeProtectionMiddleware } = require('./lib/utils/merge-protection')
const { runStartupMigrations } = require('./lib/utils/initiative-migration')

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = process.env.PORT || 3000
const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

// Store WebSocket server instance
let wss = null

// Store active connections by task ID
const taskConnections = new Map()

// Store active connections by initiative ID
const initiativeConnections = new Map()

// Broadcast task update to all connected clients
function broadcastTaskUpdate(taskId, update) {
  if (!wss) return

  const message = JSON.stringify({
    type: 'task-update',
    taskId,
    data: update
  })

  // Broadcast to all clients (for task list)
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      try {
        client.send(message)
      } catch (error) {
        console.error('Error sending task update to client:', error)
      }
    }
  })
}

// Broadcast output to task-specific connections
function broadcastTaskOutput(taskId, output) {
  if (!wss) return

  const message = JSON.stringify({
    type: 'task-output',
    taskId,
    data: output
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
        }
      }
    })
  }
}

// Clean up connections for a removed task
function cleanupTaskConnections(taskId) {
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
function broadcastInitiativeUpdate(initiative) {
  if (!wss) return

  const message = JSON.stringify({
    type: 'initiative-update',
    initiativeId: initiative.id,
    data: initiative
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
function broadcastInitiativeOutput(initiativeId, output) {
  if (!wss) return

  const message = JSON.stringify({
    type: 'initiative-output',
    initiativeId,
    data: output
  })

  // Send to initiative-specific connections only
  const connections = initiativeConnections.get(initiativeId)
  if (connections) {
    connections.forEach((client) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(message)
        } catch (error) {
          console.error(`Error sending output to client for initiative ${initiativeId}:`, error)
        }
      }
    })
  }
}

// Clean up connections for a removed initiative
function cleanupInitiativeConnections(initiativeId) {
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
function triggerWebSocketReconnection(taskId) {
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
const { YoloModeHandler } = require('./lib/utils/yolo-mode-handler')
YoloModeHandler.getInstance()

app.prepare().then(async () => {
  // Run database migrations on startup
  try {
    await runStartupMigrations()
  } catch (error) {
    console.error('Failed to run startup migrations:', error)
    // Continue startup even if migrations fail
  }

  const server = createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true)
    await handle(req, res, parsedUrl)
  })

  // Initialize WebSocket server
  wss = new WebSocketServer({
    server,
    path: '/ws'
  })

  wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection')
    
    // Set up ping/pong heartbeat
    ws.isAlive = true
    ws.on('pong', () => {
      ws.isAlive = true
    })
    
    // Parse task ID from query params if provided
    const url = new URL(req.url || '', `http://${req.headers.host}`)
    const taskId = url.searchParams.get('taskId')
    const initiativeId = url.searchParams.get('initiativeId')
    
    // Validate taskId format (basic validation)
    if (taskId && /^[a-zA-Z0-9-_]+$/.test(taskId)) {
      // Add to task-specific connections
      if (!taskConnections.has(taskId)) {
        taskConnections.set(taskId, new Set())
      }
      taskConnections.get(taskId).add(ws)
      console.log(`Client subscribed to task ${taskId}`)
    }
    
    // Validate initiativeId format (basic validation)
    if (initiativeId && /^[a-zA-Z0-9-_]+$/.test(initiativeId)) {
      // Add to initiative-specific connections
      if (!initiativeConnections.has(initiativeId)) {
        initiativeConnections.set(initiativeId, new Set())
      }
      initiativeConnections.get(initiativeId).add(ws)
      console.log(`Client subscribed to initiative ${initiativeId}`)
    }

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString())
        
        // Update heartbeat for task-specific messages
        if (data.taskId) {
          const { taskStore } = require('./lib/utils/task-store')
          if (taskStore.updateTaskHeartbeat) {
            taskStore.updateTaskHeartbeat(data.taskId)
          }
        }
        
        if (data.type === 'subscribe' && data.taskId && /^[a-zA-Z0-9-_]+$/.test(data.taskId)) {
          // Subscribe to a specific task
          if (!taskConnections.has(data.taskId)) {
            taskConnections.set(data.taskId, new Set())
          }
          taskConnections.get(data.taskId).add(ws)
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
          initiativeConnections.get(data.initiativeId).add(ws)
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
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        // Remove from all task connections before terminating
        for (const [taskId, connections] of taskConnections) {
          connections.delete(ws)
          if (connections.size === 0) {
            taskConnections.delete(taskId)
          }
        }
        // Remove from all initiative connections before terminating
        for (const [initiativeId, connections] of initiativeConnections) {
          connections.delete(ws)
          if (connections.size === 0) {
            initiativeConnections.delete(initiativeId)
          }
        }
        return ws.terminate()
      }
      
      ws.isAlive = false
      ws.ping()
    })
  }, 30000) // 30 seconds

  wss.on('close', () => {
    clearInterval(heartbeatInterval)
  })

  server.listen(port, (err) => {
    if (err) throw err
    console.log(`> Ready on http://${hostname}:${port}`)
    console.log('> WebSocket server running on ws://localhost:3000/ws')
  })
})