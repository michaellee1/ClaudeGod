const WebSocket = require('ws');

// Test WebSocket initiative events
async function testInitiativeWebSocket() {
  console.log('Testing WebSocket initiative events...\n');

  // Connect to WebSocket server
  const ws = new WebSocket('ws://localhost:3000/ws');

  ws.on('open', () => {
    console.log('✅ Connected to WebSocket server');

    // Test 1: Subscribe to an initiative
    console.log('\n📝 Test 1: Subscribing to initiative...');
    ws.send(JSON.stringify({
      type: 'subscribe',
      initiativeId: 'test-initiative-123'
    }));
  });

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log('📨 Received message:', JSON.stringify(message, null, 2));

    if (message.type === 'subscribed' && message.initiativeId) {
      console.log('✅ Successfully subscribed to initiative:', message.initiativeId);

      // Test 2: Simulate initiative update
      console.log('\n📝 Test 2: Testing initiative update broadcast...');
      // Note: In real usage, this would be called from the initiative manager
      if (global.broadcastInitiativeUpdate) {
        global.broadcastInitiativeUpdate({
          id: 'test-initiative-123',
          objective: 'Test Initiative',
          status: 'exploring',
          currentPhase: 'exploration',
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      // Test 3: Simulate initiative output
      setTimeout(() => {
        console.log('\n📝 Test 3: Testing initiative output broadcast...');
        if (global.broadcastInitiativeOutput) {
          global.broadcastInitiativeOutput('test-initiative-123', {
            timestamp: new Date(),
            type: 'info',
            content: 'Test output message',
            phase: 'exploration'
          });
        }
      }, 1000);

      // Test 4: Unsubscribe
      setTimeout(() => {
        console.log('\n📝 Test 4: Unsubscribing from initiative...');
        ws.send(JSON.stringify({
          type: 'unsubscribe',
          initiativeId: 'test-initiative-123'
        }));
      }, 2000);

      // Test 5: Test cleanup
      setTimeout(() => {
        console.log('\n📝 Test 5: Testing initiative removal...');
        if (global.cleanupInitiativeConnections) {
          global.cleanupInitiativeConnections('test-initiative-123');
        }
      }, 3000);

      // Close connection
      setTimeout(() => {
        console.log('\n🔚 Closing WebSocket connection...');
        ws.close();
      }, 4000);
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });

  ws.on('close', () => {
    console.log('✅ WebSocket connection closed');
    console.log('\n✨ All tests completed!');
  });
}

// Note: This test requires the server to be running
console.log('⚠️  Make sure the server is running (npm run dev) before running this test.\n');
console.log('To test: node test-websocket-initiatives.js\n');

// Export for use if needed
module.exports = { testInitiativeWebSocket };

// Run test if executed directly
if (require.main === module) {
  testInitiativeWebSocket().catch(console.error);
}