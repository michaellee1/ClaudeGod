#!/usr/bin/env node

const WebSocket = require('ws')

// Connect to WebSocket
const ws = new WebSocket('ws://localhost:3000/ws')

const seenMessages = new Set()
const initiativeUpdates = []

ws.on('open', () => {
  console.log('Connected to WebSocket')
})

ws.on('message', (data) => {
  const message = JSON.parse(data)
  
  if (message.type === 'initiative-update') {
    const key = `${message.initiativeId}-${message.timestamp || Date.now()}`
    
    if (message.messageId && seenMessages.has(message.messageId)) {
      console.log('❌ DUPLICATE MESSAGE DETECTED:', message.messageId)
    } else if (message.messageId) {
      seenMessages.add(message.messageId)
    }
    
    initiativeUpdates.push({
      time: new Date().toISOString(),
      id: message.initiativeId,
      messageId: message.messageId,
      objective: message.data?.objective
    })
    
    console.log('📥 Initiative Update:', {
      id: message.initiativeId,
      messageId: message.messageId,
      objective: message.data?.objective?.substring(0, 50) + '...'
    })
  }
})

ws.on('error', (error) => {
  console.error('WebSocket error:', error)
})

// Create an initiative after connection is established
setTimeout(async () => {
  console.log('\n🚀 Creating new initiative...\n')
  
  const startTime = Date.now()
  
  try {
    const response = await fetch('http://localhost:3000/api/initiatives', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        objective: `Test initiative for duplicate detection - ${new Date().toISOString()}`
      })
    })
    
    const data = await response.json()
    console.log('✅ Initiative created:', data.id)
    
    // Wait a bit to see all updates
    setTimeout(() => {
      const endTime = Date.now()
      const duration = endTime - startTime
      
      console.log('\n📊 Summary:')
      console.log(`Total time: ${duration}ms`)
      console.log(`Total updates received: ${initiativeUpdates.length}`)
      
      // Check for duplicates
      const updatesByInitiative = {}
      initiativeUpdates.forEach(update => {
        if (!updatesByInitiative[update.id]) {
          updatesByInitiative[update.id] = []
        }
        updatesByInitiative[update.id].push(update)
      })
      
      Object.entries(updatesByInitiative).forEach(([id, updates]) => {
        console.log(`\nInitiative ${id}: ${updates.length} updates`)
        updates.forEach((update, i) => {
          console.log(`  ${i + 1}. ${update.time} - messageId: ${update.messageId}`)
        })
      })
      
      process.exit(0)
    }, 3000)
    
  } catch (error) {
    console.error('Error creating initiative:', error)
    process.exit(1)
  }
}, 1000)