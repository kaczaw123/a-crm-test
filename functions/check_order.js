const { Firestore } = require('@google-cloud/firestore');

const db = new Firestore();

async function check() {
  try {
    const snapshot = await db.collectionGroup('orders')
      .where('source', '==', 'ALLEGRO')
      .limit(1)
      .get();
      
    if (snapshot.empty) {
      console.log('No Allegro orders found in Firestore.');
      return;
    }
    
    const doc = snapshot.docs[0].data();
    console.log("=== FIRESTORE DOCUMENT STRUCTURE ===");
    console.log("has items:", !!doc.items);
    console.log("items is array:", Array.isArray(doc.items), doc.items?.length);
    console.log("delivery.method:", doc.delivery?.method);
    console.log("payment.method:", doc.payment?.method);
    console.log("-----------------------------------------");
    console.log(JSON.stringify(doc, null, 2));
  } catch (err) {
    console.error("Failed to fetch:", err.message);
  }
}
check();
