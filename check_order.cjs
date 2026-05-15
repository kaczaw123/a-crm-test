const admin = require('firebase-admin');

// Set emulator host so the script talks to local emulator
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
admin.initializeApp({ projectId: 'demo-crm' });
const db = admin.firestore();

async function check() {
  try {
    const query = await db.collectionGroup('orders').where('orderNumber', '==', 'ORD/BL/2026/00048').get();
    if (query.empty) {
      console.log("No order found with number ORD/BL/2026/00048");
    } else {
      query.forEach(doc => {
        console.log("==== ORDER DOC JSON ====");
        console.log(JSON.stringify(doc.data(), null, 2));
        console.log("========================");
      });
    }
  } catch (err) {
    console.error("Error reading DB:", err);
  }
  process.exit(0);
}

check();
