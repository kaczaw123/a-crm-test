const admin = require('firebase-admin');
const serviceAccount = require('./firebase-adminsdk.json'); // We don't have this, we should use default

admin.initializeApp();
const db = admin.firestore();

async function checkQueue() {
   const companyId = '72vztnE7phK7pHSWLpFr'; // Z console logów usera
   const snap = await db.collection(`companies/${companyId}/fulfillmentQueue`).get();
   console.log(`Zadania dla ${companyId}:`, snap.size);
   snap.forEach(d => console.log(d.id, d.data().status));
   
   // Chcemy zobaczyć też dla innych firm
   const comps = await db.collection('companies').get();
   for (const c of comps.docs) {
      const q = await db.collection(`companies/${c.id}/fulfillmentQueue`).get();
      if (!q.empty) {
         console.log(`COMPANY ${c.id}: ${q.size} zadań`);
      }
   }
}

checkQueue().then(() => process.exit(0)).catch(console.error);
