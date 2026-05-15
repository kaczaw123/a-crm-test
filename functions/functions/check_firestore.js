const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gep-a-crm' });
const db = admin.firestore();

async function run() {
  try {
    const companiesSnap = await db.collection('companies').limit(1).get();
    let companyId = companiesSnap.docs[0].id;
    console.log("Found company:", companyId);

    // Find shipment DGKwShaDYabHjPHdB621
    const shipmentQuery = await db.collection(`companies`).doc(companyId).collection('inboundShipments').doc('DGKwShaDYabHjPHdB621').get();
    
    if (!shipmentQuery.exists) {
        console.log("Shipment DGKwShaDYabHjPHdB621 not found in company", companyId);
        // let's try finding it across all companies
        const allComps = await db.collection('companies').get();
        for (const c of allComps.docs) {
            const ship = await db.collection(`companies/${c.id}/inboundShipments`).doc('DGKwShaDYabHjPHdB621').get();
            if (ship.exists) {
                console.log("Found in company", c.id);
                companyId = c.id;
                break;
            }
        }
    }

    const shipRef = db.collection(`companies/${companyId}/inboundShipments`).doc('DGKwShaDYabHjPHdB621');
    const shipDoc = await shipRef.get();
    if (!shipDoc.exists) {
        console.log("Could not find shipment DGKwShaDYabHjPHdB621 anywhere.");
        return;
    }

    console.log("--- Awizacja (Header) ---");
    console.log("Status:", shipDoc.data().status);
    console.log("ReceiptStatus:", shipDoc.data().receiptStatus);
    
    const items = await shipRef.collection('items').get();
    console.log("\n--- Produkty awizacji (items) ---");
    items.forEach(doc => {
        const d = doc.data();
        console.log(`- Item ID: ${doc.id}, ProductId: ${d.productId}, SKU: ${d.sku}, Name: ${d.name}, Qty: ${d.expectedQty}, received: ${d.receivedQty}`);
    });

    console.log("\n--- Inventory Stock (companies/{companyId}/inventoryStock) ---");
    const stock = await db.collection(`companies/${companyId}/inventoryStock`).where('receivedFromInboundId', '==', 'DGKwShaDYabHjPHdB621').get();
    if (stock.empty) {
        // Try getting all stocks maybe from this shipment
        const allStocks = await db.collection(`companies/${companyId}/inventoryStock`).get();
        allStocks.forEach(s => {
            console.log(`- stockId: ${s.id}, SKU: ${s.data().sku}, receivedFrom: ${s.data().receivedFromInboundId}`);
        });
    } else {
        stock.forEach(s => {
            console.log(`- stockId: ${s.id}, SKU: ${s.data().sku}, QtyAvailable: ${s.data().qtyAvailable}`);
        });
        console.log("Count:", stock.size);
    }

    // if the above didn't catch due to 'receivedFromInboundId' lacking, just print all or let's find movements
    console.log("\n--- Inventory Movements (companies/{companyId}/inventoryMovements) ---");
    const movements = await db.collection(`companies/${companyId}/inventoryMovements`)
                        .where('referenceId', '==', 'DGKwShaDYabHjPHdB621')
                        .where('type', '==', 'RECEIPT')
                        .get();
    console.log("Count of RECEIPT movements for this shipment:", movements.size);
    movements.forEach(m => {
        const d = m.data();
        console.log(`- Movement ID: ${m.id}, ProductId: ${d.productId}, Qty: ${d.quantity}`);
    });

  } catch(e) {
    console.error(e);
  }
}
run();
