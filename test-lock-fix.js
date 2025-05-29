const fetch = require('node-fetch');

async function testInitiativeCreation() {
  console.log('Testing initiative creation with lock fix...');
  
  try {
    // Create multiple initiatives in parallel to test lock handling
    const promises = [];
    for (let i = 0; i < 3; i++) {
      promises.push(
        fetch('http://localhost:3000/api/initiatives', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            objective: `Test initiative ${i + 1}: Testing lock timeout fix`
          })
        }).then(res => res.json())
      );
    }
    
    const results = await Promise.allSettled(promises);
    
    console.log('\nResults:');
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        console.log(`Initiative ${index + 1}: SUCCESS - ID: ${result.value.id}`);
      } else {
        console.log(`Initiative ${index + 1}: FAILED - ${result.reason}`);
      }
    });
    
    // Test single creation after parallel test
    console.log('\nTesting single creation...');
    const singleResult = await fetch('http://localhost:3000/api/initiatives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        objective: 'Single test: Verify lock is properly released'
      })
    });
    
    if (singleResult.ok) {
      const data = await singleResult.json();
      console.log(`Single creation: SUCCESS - ID: ${data.id}`);
    } else {
      const error = await singleResult.json();
      console.log(`Single creation: FAILED - ${JSON.stringify(error)}`);
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
console.log('Make sure the server is running on port 3000');
console.log('Starting test in 2 seconds...\n');
setTimeout(testInitiativeCreation, 2000);