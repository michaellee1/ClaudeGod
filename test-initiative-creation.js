const fetch = require('node-fetch');

async function testInitiativeCreation() {
  console.log('Testing initiative creation...');
  
  try {
    const response = await fetch('http://localhost:3000/api/initiatives', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        objective: 'Test initiative creation with date handling' 
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error response:', response.status, errorText);
      return;
    }

    const data = await response.json();
    console.log('Initiative created successfully:');
    console.log(JSON.stringify(data, null, 2));
    
    // Verify dates are present and valid
    if (data.createdAt && data.updatedAt) {
      console.log('\n✅ Dates are properly set:');
      console.log('   createdAt:', data.createdAt);
      console.log('   updatedAt:', data.updatedAt);
    } else {
      console.error('\n❌ Missing date fields!');
    }
    
  } catch (error) {
    console.error('Failed to test initiative creation:', error);
  }
}

// Run test if server is available
testInitiativeCreation();