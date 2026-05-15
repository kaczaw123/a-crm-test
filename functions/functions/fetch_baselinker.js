const admin = require('firebase-admin');
console.log('Firebase Default App initialize');
admin.initializeApp({
  projectId: 'gep-a-crm'
});

async function run() {
  try {
    const db = admin.firestore();
    const snapshot = await db.collectionGroup('integrations').where('type', '==', 'baselinker').get();
    if (snapshot.empty) {
      console.log('No documents found for type baselinker.');
      return;
    }
    snapshot.forEach(doc => {
      const data = doc.data();
      console.log('Doc Path:', doc.ref.path);
      console.log('keyVersion:', data.keyVersion);
      console.log('updatedAt:', data.updatedAt ? data.updatedAt.toDate() : 'none');
    });
  } catch (error) {
    console.error('Error:', error);
  }
}
run();
