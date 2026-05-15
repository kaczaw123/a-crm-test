import admin from 'firebase-admin';

try {
  admin.initializeApp({ projectId: 'gep-a-crm' });
} catch(e) {}

const db = admin.firestore();

async function check() {
  const snap = await db.collectionGroup('shipments').where('trackingNumber', '==', '011940854906').get();
  if (snap.empty) {
    console.log("NOT FOUND");
    return;
  }
  const data = snap.docs[0].data();
  console.log("COMPANY ID:", snap.docs[0].ref.parent.parent.id);
  console.log("LABEL PATH:", data.labelStoragePath);
}

check().catch(console.error);
