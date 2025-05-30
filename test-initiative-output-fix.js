const axios = require('axios');

const API_URL = 'http://localhost:3000/api';

async function testInitiativeOutput() {
  console.log('Testing initiative output fix...\n');

  try {
    // Create a new initiative
    console.log('1. Creating new initiative...');
    const createResponse = await axios.post(`${API_URL}/initiatives`, {
      objective: 'Test initiative to verify output is working'
    });
    
    const initiative = createResponse.data;
    console.log(`✓ Initiative created: ${initiative.id}`);
    console.log(`  Status: ${initiative.status}`);
    console.log(`  Phase: ${initiative.currentPhase}\n`);

    // Connect WebSocket to monitor output
    console.log('2. Connecting WebSocket to monitor output...');
    const WebSocket = require('ws');
    const ws = new WebSocket(`ws://localhost:3000?type=initiative`);
    
    let outputReceived = false;
    const outputs = [];
    
    ws.on('open', () => {
      console.log('✓ WebSocket connected');
      
      // Subscribe to the initiative
      ws.send(JSON.stringify({
        type: 'subscribe',
        initiativeId: initiative.id
      }));
      console.log(`✓ Subscribed to initiative ${initiative.id}\n`);
    });
    
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'initiative-output' && message.data) {
        outputReceived = true;
        outputs.push(message.data);
        console.log(`📨 Received output: ${message.data.content?.substring(0, 100)}...`);
      }
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    // Wait a bit for exploration to start and produce output
    console.log('3. Waiting for exploration output...');
    await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
    
    // Check results
    console.log('\n4. Results:');
    console.log(`   - Outputs received: ${outputs.length}`);
    console.log(`   - Output received via WebSocket: ${outputReceived ? 'YES ✓' : 'NO ✗'}`);
    
    if (outputs.length > 0) {
      console.log('\n   Sample outputs:');
      outputs.slice(0, 5).forEach((output, i) => {
        console.log(`   ${i + 1}. [${output.phase}] ${output.content?.substring(0, 80)}...`);
      });
    }
    
    ws.close();
    
    if (outputReceived) {
      console.log('\n✅ SUCCESS: Initiative output is working correctly!');
    } else {
      console.log('\n❌ FAILED: No output received from initiative');
    }
    
  } catch (error) {
    console.error('Test failed:', error.response?.data || error.message);
  }
}

// Run the test
testInitiativeOutput();