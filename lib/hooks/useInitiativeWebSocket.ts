import { useEffect, useRef, useState, useCallback } from 'react'
import { Initiative } from '../utils/initiative-store'
import { InitiativeOutput, InitiativePhase } from '../types/initiative'

export interface InitiativeWebSocketMessage {
  type: 'connected' | 'initiative-update' | 'initiative-output' | 'initiative-removed' | 
        'initiative-phase-complete' | 'initiative-error' | 'subscribe' | 'unsubscribe'
  initiativeId?: string
  data?: Initiative | InitiativeOutput | any
}

interface InitiativeUpdateHandler {
  onInitiativeUpdate?: (initiative: Initiative) => void
  onInitiativeOutput?: (output: InitiativeOutput) => void
  onPhaseComplete?: (phase: InitiativePhase) => void
  onError?: (error: string) => void
  onInitiativeRemoved?: (initiativeId: string) => void
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
        reconnectAttempts.current = 0

        // Re-subscribe to all previously subscribed initiatives
        subscribedInitiatives.forEach(initiativeId => {
          ws.current?.send(JSON.stringify({
            type: 'subscribe',
            initiativeId
          }))
        })
      }

      ws.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as InitiativeWebSocketMessage
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
          }
        } catch (error) {
          console.error('Error parsing Initiative WebSocket message:', error)
        }
      }

      ws.current.onclose = () => {
        console.log('Initiative WebSocket disconnected')
        setIsConnected(false)
        
        // Attempt to reconnect with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000)
        reconnectAttempts.current++
        
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log(`Attempting to reconnect Initiative WebSocket (attempt ${reconnectAttempts.current})...`)
          connect()
        }, delay)
      }

      ws.current.onerror = (error) => {
        console.error('Initiative WebSocket error:', error)
      }
    } catch (error) {
      console.error('Error creating Initiative WebSocket connection:', error)
    }
  }, [url, subscribedInitiatives])

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
  }, [connect, disconnect])

  return {
    isConnected,
    lastMessage,
    sendMessage,
    subscribeToInitiative,
    unsubscribeFromInitiative,
    subscribedInitiatives
  }
}