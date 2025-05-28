import { useEffect, useRef, useState, useCallback } from 'react'

export interface WebSocketMessage {
  type: string
  taskId?: string
  data?: any
}

export function useWebSocket(url: string, taskId?: string) {
  const ws = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttempts = useRef(0)

  const connect = useCallback(() => {
    try {
      // Build WebSocket URL
      const wsUrl = new URL(url, window.location.href)
      wsUrl.protocol = wsUrl.protocol.replace('http', 'ws')
      if (taskId) {
        wsUrl.searchParams.set('taskId', taskId)
      }

      ws.current = new WebSocket(wsUrl.toString())

      ws.current.onopen = () => {
        console.log('WebSocket connected')
        setIsConnected(true)
        reconnectAttempts.current = 0

        // Subscribe to specific task if provided
        if (taskId) {
          ws.current?.send(JSON.stringify({
            type: 'subscribe',
            taskId
          }))
        }
        
        // If reconnecting, show a notification
        if (reconnectAttempts.current > 0) {
          setLastMessage({
            type: 'connection-restored',
            taskId: taskId,
            data: { content: '✅ Connection restored', timestamp: new Date() }
          })
        }
      }

      ws.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage
          setLastMessage(message)
        } catch (error) {
          console.error('Error parsing WebSocket message:', error)
        }
      }

      ws.current.onclose = (event) => {
        console.log('WebSocket disconnected', event.code, event.reason)
        setIsConnected(false)
        
        // Don't reconnect if it was a normal closure
        if (event.code === 1000) {
          return
        }
        
        // Attempt to reconnect with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000)
        reconnectAttempts.current++
        
        // Show disconnection message if this is the first disconnect
        if (reconnectAttempts.current === 1) {
          setLastMessage({
            type: 'connection-lost',
            taskId: taskId,
            data: { content: '⚠️ Connection lost. Attempting to reconnect...', timestamp: new Date() }
          })
        }
        
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log(`Attempting to reconnect (attempt ${reconnectAttempts.current})...`)
          connect()
        }, delay)
      }

      ws.current.onerror = (error) => {
        console.error('WebSocket error:', error)
      }
    } catch (error) {
      console.error('Error creating WebSocket connection:', error)
      
      // Retry connection after a delay
      reconnectTimeoutRef.current = setTimeout(() => {
        connect()
      }, 5000)
    }
  }, [url, taskId])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (ws.current) {
      ws.current.close()
      ws.current = null
    }
  }, [])

  const sendMessage = useCallback((message: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message))
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return {
    isConnected,
    lastMessage,
    sendMessage
  }
}