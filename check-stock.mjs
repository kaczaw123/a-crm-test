import admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

async function checkStock() {
  console.log('Querying inventoryStock...');
  const snap = await db.collectionGroup('inventoryStock').get();
  console.log(`Found ${snap.docs.length} records.`);
  snap.docs.forEach(doc => {
    console.log(doc.id, '=>', doc.data());
  });
}

checkStock().catch(console.error);
