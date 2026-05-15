import admin from 'firebase-admin';

try {
  admin.initializeApp({ projectId: 'gep-a-crm' });
} catch(e) {}

const db = admin.firestore();

async function check() {
  const query = await db.collectionGroup('orders').where('externalOrderId', '==', '2026/00048').get();
  
  if (query.empty) {
     const q2 = await db.collectionGroup('orders').where('orderNumber', '==', 'ORD/BL/2026/00048').get();
     q2.forEach(doc => {
        console.log(JSON.stringify(doc.data(), null, 2));
     });
  } else {
    query.forEach(doc => {
      console.log(JSON.stringify(doc.data(), null, 2));
    });
  }
}
check().catch(console.error);
