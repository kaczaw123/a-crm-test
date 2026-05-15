const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gep-a-crm' });
admin.firestore().collection('platformUsers').get().then(snap => {
  console.log("Users in DB:", snap.size);
  snap.forEach(doc => console.log(doc.id, doc.data().email));
}).catch(console.error);
