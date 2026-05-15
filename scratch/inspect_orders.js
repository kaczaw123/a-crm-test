const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert(require('./service-account.json')),
  projectId: 'gep-a-crm'
});

async function run() {
  const db = admin.firestore();
  
  // Find a company
  const compSnap = await db.collection('companies').limit(1).get();
  if (compSnap.empty) {
     console.log("No companies found");
     return;
  }
  const compId = compSnap.docs[0].id; // Or provide exact if known
  console.log("Company ID:", compId);
  
  // Get recent orders from google_sheets
  const ordersSnap = await db.collection(`companies/${compId}/orders`)
     .where('source', '==', 'google_sheets')
     .orderBy('createdAt', 'desc')
     .limit(5)
     .get();
     
  ordersSnap.forEach(doc => {
     const data = doc.data();
     console.log(`Order ${doc.id}:`);
     console.log(`  recipient: ${data.recipientDisplayName || data.recipientName}`);
     console.log(`  status: ${data.status}`);
     console.log(`  trackingNumber: '${data.trackingNumber}'`);
     console.log(`  externalId: ${data.externalOrderId}`);
  });
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
