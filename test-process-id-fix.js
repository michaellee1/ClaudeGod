const fetch = require('node-fetch');

async function testProcessIdFix() {
  console.log('Testing process ID fix for initiatives...\n');
  
  try {
    // Step 1: Create a new initiative
    console.log('1. Creating new initiative...');
    const createResponse = await fetch('http://localhost:3000/api/initiatives', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        objective: 'Test initiative to verify process ID is properly set during exploration phase' 
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('❌ Error creating initiative:', createResponse.status, errorText);
      return;
    }

    const initiative = await createResponse.json();
    console.log('✅ Initiative created:', initiative.id);
    console.log('   Status:', initiative.status);
    console.log('   Phase:', initiative.phase);
    console.log('   Process ID:', initiative.processId || 'NOT SET');
    console.log('   Is Active:', initiative.isActive);
    
    // Step 2: Wait a moment for the process to start
    console.log('\n2. Waiting for process to start...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 3: Fetch the initiative again to check if processId is set
    console.log('\n3. Fetching initiative details...');
    const getResponse = await fetch(`http://localhost:3000/api/initiatives/${initiative.id}`);
    
    if (!getResponse.ok) {
      const errorText = await getResponse.text();
      console.error('❌ Error fetching initiative:', getResponse.status, errorText);
      return;
    }
    
    const updatedInitiative = await getResponse.json();
    console.log('✅ Initiative fetched:');
    console.log('   Process ID:', updatedInitiative.processId || 'NOT SET');
    console.log('   Is Active:', updatedInitiative.isActive);
    
    // Step 4: Check validation warnings
    console.log('\n4. Checking validation...');
    const validationResponse = await fetch(`http://localhost:3000/api/initiatives/${initiative.id}/validation`);
    
    if (!validationResponse.ok) {
      const errorText = await validationResponse.text();
      console.error('❌ Error fetching validation:', validationResponse.status, errorText);
      return;
    }
    
    const validation = await validationResponse.json();
    console.log('✅ Validation result:');
    console.log('   Valid:', validation.validation.valid);
    console.log('   Warnings:', validation.validation.warnings.length);
    if (validation.validation.warnings.length > 0) {
      console.log('   Warning messages:');
      validation.validation.warnings.forEach(w => console.log('     -', w));
    }
    console.log('   Recommendations:', validation.recommendations?.length || 0);
    
    // Step 5: Summary
    console.log('\n5. Test Summary:');
    if (updatedInitiative.processId && validation.validation.warnings.filter(w => w.includes('process ID')).length === 0) {
      console.log('✅ SUCCESS: Process ID is properly set and no validation warnings about missing process ID!');
    } else {
      console.log('❌ FAILURE: Process ID issue still exists');
      if (!updatedInitiative.processId) {
        console.log('   - Process ID is not set on the initiative');
      }
      if (validation.validation.warnings.filter(w => w.includes('process ID')).length > 0) {
        console.log('   - Validation still reports missing process ID warnings');
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

// Run the test
testProcessIdFix();