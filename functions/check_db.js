const admin = require('firebase-admin');
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
admin.initializeApp({ projectId: 'demo-a-cmr' });
const db = admin.firestore();

(async () => {
    try {
        const comps = await db.collection('companies').get();
        for (const c of comps.docs) {
            console.log("\nCompany:", c.id);
            const ships = await db.collection(`companies/${c.id}/inboundShipments`).get();
            if (ships.empty) {
                console.log("  [No shipments found]");
            }
            ships.forEach(s => {
                const data = s.data();
                console.log(`\n  ✅ SHIPMENT OCALAŁ: ${s.id}`);
                console.log(`  Path: companies/${c.id}/inboundShipments/${s.id}`);
                console.log("  Header Data:");
                console.log(`    orgId: ${data.orgId}`);
                console.log(`    status: ${data.status}`);
                console.log(`    carrier: ${data.carrier}`);
                console.log(`    totalExpectedQty: ${data.totalExpectedQty}`);
                console.log(`    itemsCount: ${data.itemsCount}`);
                console.log(`    receiptStatus: ${data.receiptStatus}`);
            });
        }
    } catch(e) {
        console.error(e);
    }
})();
