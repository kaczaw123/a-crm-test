const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gep-a-crm' });

async function check() {
  const docs = await admin.firestore().collectionGroup('fulfillmentQueue').limit(5).get();
  docs.forEach(d => {
    console.log(d.ref.path);
    console.log(Object.keys(d.data())); // log keys just to be safe
  });
}
check().catch(console.error);
