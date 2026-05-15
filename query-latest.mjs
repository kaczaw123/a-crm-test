import admin from 'firebase-admin';

// Initialize without a service account (uses default application credentials, 
// or against emulator if FIRESTORE_EMULATOR_HOST is set)
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
admin.initializeApp({ projectId: 'gep-a-crm' });

const db = admin.firestore();

async function checkLatestShipments() {
  console.log("Fetching latest 3 shipments...");
  const snap = await db.collectionGroup('inboundShipments')
    .orderBy('createdAt', 'desc')
    .limit(3)
    .get();

  if (snap.empty) {
    console.log("No shipments found.");
    return;
  }

  snap.forEach(doc => {
    const data = doc.data();
    console.log(`\n============================`);
    console.log(`Shipment ID: ${doc.id}`);
    console.log(`Status: ${data.status}`);
    console.log(`Items count: ${data.itemsCount}`);
    console.log(`totalExpectedWeight: ${data.totalExpectedWeight}`);
    console.log(`totalExpectedVolume: ${data.totalExpectedVolume}`);
    console.log(`createdAt: ${data.createdAt?.toDate()}`);
    console.log(`Carrier/Tracking: ${data.carrier} / ${data.trackingNumber}`);
  });
}

checkLatestShipments()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
