import { useEffect, useRef, useState, useCallback } from 'react'
import { Initiative, InitiativeOutput, InitiativePhase } from '../types/initiative'

export interface InitiativeWebSocketMessage {
  type: 'connected' | 'initiative-update' | 'initiative-output' | 'initiative-removed' | 
        'initiative-phase-complete' | 'initiative-error' | 'subscribe' | 'unsubscribe' |
        'ping' | 'pong'
  initiativeId?: string
  data?: Initiative | InitiativeOutput | any
  messageId?: string
  timestamp?: number
}

interface InitiativeUpdateHandler {
  onInitiativeUpdate?: (initiative: Initiative) => void
  onInitiativeOutput?: (output: InitiativeOutput) => void
  onPhaseComplete?: (phase: InitiativePhase) => void
  onError?: (error: string) => void
  onInitiativeRemoved?: (initiativeId: string) => void
  onConnectionError?: (error: string) => void
  onConnectionStatusChange?: (connected: boolean) => void
}

export function useInitiativeWebSocket(
  url: string,
  handlers?: InitiativeUpdateHandler
) {
  const ws = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<InitiativeWebSocketMessage | null>(null)
  const [subscribedInitiatives, setSubscribedInitiatives] = useState<Set<string>>(new Set())
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectAttempts = useRef(0)
  const handlersRef = useRef(handlers)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const missedHeartbeats = useRef(0)
  const processedMessages = useRef<Set<string>>(new Set())
  const messageCleanupInterval = useRef<NodeJS.Timeout | null>(null)

  // Update handlers ref when they change
  useEffect(() => {
    handlersRef.current = handlers
  }, [handlers])

  const connect = useCallback(() => {
    try {
      // Build WebSocket URL
      const wsUrl = new URL(url, window.location.href)
      wsUrl.protocol = wsUrl.protocol.replace('http', 'ws')

      ws.current = new WebSocket(wsUrl.toString())

      ws.current.onopen = () => {
        console.log('Initiative WebSocket connected')
        setIsConnected(true)
        setConnectionError(null)
        reconnectAttempts.current = 0
        missedHeartbeats.current = 0

        // Notify connection status change
        handlersRef.current?.onConnectionStatusChange?.(true)

        // Re-subscribe to all previously subscribed initiatives
        subscribedInitiatives.forEach(initiativeId => {
          ws.current?.send(JSON.stringify({
            type: 'subscribe',
            initiativeId
          }))
        })

        // Start heartbeat
        startHeartbeat()
        
        // Start message cleanup interval
        startMessageCleanup()
      }

      ws.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as InitiativeWebSocketMessage
          
          // Skip duplicate messages based on messageId
          if (message.messageId) {
            if (processedMessages.current.has(message.messageId)) {
              return // Skip duplicate message
            }
            processedMessages.current.add(message.messageId)
          }
          
          setLastMessage(message)

          // Handle different message types
          switch (message.type) {
            case 'initiative-update':
              if (message.data && handlersRef.current?.onInitiativeUpdate) {
                handlersRef.current.onInitiativeUpdate(message.data as Initiative)
              }
              break

            case 'initiative-output':
              if (message.data && handlersRef.current?.onInitiativeOutput) {
                handlersRef.current.onInitiativeOutput(message.data as InitiativeOutput)
              }
              break

            case 'initiative-phase-complete':
              if (message.data && handlersRef.current?.onPhaseComplete) {
                handlersRef.current.onPhaseComplete(message.data as InitiativePhase)
              }
              break

            case 'initiative-error':
              if (message.data && handlersRef.current?.onError) {
                handlersRef.current.onError(message.data as string)
              }
              break

            case 'initiative-removed':
              if (message.initiativeId) {
                setSubscribedInitiatives(prev => {
                  const next = new Set(prev)
                  next.delete(message.initiativeId!)
                  return next
                })
                if (handlersRef.current?.onInitiativeRemoved) {
                  handlersRef.current.onInitiativeRemoved(message.initiativeId)
                }
              }
              break

            case 'pong':
              // Reset missed heartbeats on pong
              missedHeartbeats.current = 0
              break
          }
        } catch (error) {
          console.error('Error parsing Initiative WebSocket message:', error)
        }
      }

      ws.current.onclose = (event) => {
        console.log('Initiative WebSocket disconnected', event.code, event.reason)
        setIsConnected(false)
        stopHeartbeat()
        stopMessageCleanup()

        // Notify connection status change
        handlersRef.current?.onConnectionStatusChange?.(false)
        
        // Determine error message based on close code
        let errorMessage = 'Connection lost'
        if (event.code === 1006) {
          errorMessage = 'Connection lost unexpectedly'
        } else if (event.code === 1001) {
          errorMessage = 'Server is going away'
        } else if (event.code === 1011) {
          errorMessage = 'Server error'
        }
        
        setConnectionError(errorMessage)
        
        // Attempt to reconnect with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000)
        reconnectAttempts.current++
        
        if (reconnectAttempts.current === 1) {
          handlersRef.current?.onConnectionError?.(`${errorMessage}. Attempting to reconnect...`)
        } else if (reconnectAttempts.current % 5 === 0) {
          handlersRef.current?.onConnectionError?.(`Still trying to reconnect (attempt ${reconnectAttempts.current})...`)
        }
        
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log(`Attempting to reconnect Initiative WebSocket (attempt ${reconnectAttempts.current})...`)
          connect()
        }, delay)
      }

      ws.current.onerror = (error) => {
        console.error('Initiative WebSocket error:', error)
        const errorMessage = 'Unable to connect to server'
        setConnectionError(errorMessage)
        handlersRef.current?.onConnectionError?.(errorMessage)
      }
    } catch (error) {
      console.error('Error creating Initiative WebSocket connection:', error)
    }
  }, [url, subscribedInitiatives])

  const startHeartbeat = useCallback(() => {
    heartbeatIntervalRef.current = setInterval(() => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'ping' }))
        missedHeartbeats.current++
        
        if (missedHeartbeats.current >= 3) {
          console.warn('Missed 3 heartbeats, closing connection')
          ws.current.close()
        }
      }
    }, 30000) // Send heartbeat every 30 seconds
  }, [])

  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current)
      heartbeatIntervalRef.current = null
    }
  }, [])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    stopHeartbeat()
    stopMessageCleanup()

    if (ws.current) {
      ws.current.close()
      ws.current = null
    }
  }, [stopHeartbeat])
  
  const startMessageCleanup = useCallback(() => {
    // Clean up old message IDs every 5 minutes to prevent memory leak
    messageCleanupInterval.current = setInterval(() => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
      processedMessages.current.clear() // Simple clear for now
    }, 5 * 60 * 1000)
  }, [])
  
  const stopMessageCleanup = useCallback(() => {
    if (messageCleanupInterval.current) {
      clearInterval(messageCleanupInterval.current)
      messageCleanupInterval.current = null
    }
  }, [])

  const sendMessage = useCallback((message: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message))
    }
  }, [])

  const subscribeToInitiative = useCallback((initiativeId: string) => {
    setSubscribedInitiatives(prev => {
      const next = new Set(prev)
      next.add(initiativeId)
      return next
    })

    sendMessage({
      type: 'subscribe',
      initiativeId
    })
  }, [sendMessage])

  const unsubscribeFromInitiative = useCallback((initiativeId: string) => {
    setSubscribedInitiatives(prev => {
      const next = new Set(prev)
      next.delete(initiativeId)
      return next
    })

    sendMessage({
      type: 'unsubscribe',
      initiativeId
    })
  }, [sendMessage])

  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, []) // Remove dependencies to avoid reconnection loops

  return {
    isConnected,
    lastMessage,
    sendMessage,
    subscribeToInitiative,
    unsubscribeFromInitiative,
    subscribedInitiatives,
    connectionError
  }
}