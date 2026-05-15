(async () => {
    try {
      const res = await fetch('http://127.0.0.1:5001/gep-a-crm/us-central1/testIntegration', {
        method: 'POST',
        body: JSON.stringify({ data: { companyId: 'A', integrationId: 'B', token: 'C' } }),
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log('STATUS:', res.status);
      console.log('BODY:', await res.text());
    } catch (err) {
      console.error('FETCH ERROR:', err);
    }
  })();
  
