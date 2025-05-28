const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { WebSocketServer } = require('ws')

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = process.env.PORT || 3000
const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

// Store WebSocket server instance
let wss = null

// Store active connections by task ID
const taskConnections = new Map()

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

// Export functions for use in other modules
global.broadcastTaskUpdate = broadcastTaskUpdate
global.broadcastTaskOutput = broadcastTaskOutput
global.cleanupTaskConnections = cleanupTaskConnections

app.prepare().then(() => {
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
    
    // Validate taskId format (basic validation)
    if (taskId && /^[a-zA-Z0-9-_]+$/.test(taskId)) {
      // Add to task-specific connections
      if (!taskConnections.has(taskId)) {
        taskConnections.set(taskId, new Set())
      }
      taskConnections.get(taskId).add(ws)
      console.log(`Client subscribed to task ${taskId}`)
    }

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString())
        
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