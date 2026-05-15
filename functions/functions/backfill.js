const admin = require('firebase-admin');
const fs = require('fs');
if (!admin.apps.length) {
    // If running outside, requires GOOGLE_APPLICATION_CREDENTIALS or auth via gcloud
    admin.initializeApp({ projectId: 'gep-a-crm' });
}

const db = admin.firestore();

async function backfillQueue() {
    try {
        console.log("Fetching fulfillment queue tasks...");
        const snapshot = await db.collectionGroup('fulfillmentQueue').get();
        if (snapshot.empty) {
            console.log("Queue is empty.");
            return;
        }

        console.log(`Found ${snapshot.size} tasks. Checking for missing items...`);

        let updated = 0;
        for (const doc of snapshot.docs) {
            const data = doc.data();
            const companyId = data.companyId || doc.ref.parent.parent.id;
            const orderId = doc.id;

            if (!data.items || data.items.length === 0) {
                console.log(`Task ${orderId} missing items, fetching order items...`);
                
                const orderItemsSnap = await db.collection(`companies/${companyId}/orderItems`)
                    .where('orderId', '==', orderId).get();
                
                const taskItems = [];
                for (const itemDoc of orderItemsSnap.docs) {
                  const itemData = itemDoc.data();
                  let imageUrl = itemData.imageUrl || null;
                  let location = null;
                  
                  if (itemData.productId) {
                    if (!imageUrl) {
                      const productDoc = await db.doc(`companies/${companyId}/products/${itemData.productId}`).get();
                      if (productDoc.exists) imageUrl = productDoc.data().imageUrl || null;
                    }
                    
                    const stockQuery = await db.collection(`companies/${companyId}/inventoryStock`)
                      .where('productId', '==', itemData.productId)
                      .limit(1).get();
                    if (!stockQuery.empty) {
                       location = stockQuery.docs[0].data().warehouseLocationId || null;
                    }
                  }
                  
                  taskItems.push({
                    productId: itemData.productId || itemDoc.id,
                    productName: itemData.name || 'Brak nazwy',
                    ean: itemData.ean || '',
                    sku: itemData.sku || '',
                    imageUrl,
                    location,
                    quantity: itemData.qtyReserved || itemData.qtyOrdered || 1,
                    scannedQuantity: 0
                  });
                }
                
                // Fetch order doc for customer name
                const orderDoc = await db.doc(`companies/${companyId}/orders/${orderId}`).get();
                let customerName = 'Brak danych';
                let shippingMethod = 'Kurier';
                let trackingNumber = '';
                if (orderDoc.exists) {
                   const o = orderDoc.data();
                   customerName = o.recipient?.firstName ? `${o.recipient.firstName} ${o.recipient.lastName}` : (o.buyer?.login || 'Brak danych');
                   shippingMethod = o.shipping?.method || o.courierCode || 'Kurier';
                   trackingNumber = o.trackingNumber || '';
                }

                await doc.ref.update({
                    items: taskItems,
                    customerName,
                    carrier: shippingMethod,
                    trackingNumber
                });
                console.log(`Updated task ${orderId} with ${taskItems.length} items`);
                updated++;
            }
        }
        console.log(`Migration complete. Updated ${updated} tasks.`);
    } catch(err) {
        console.error(err);
    }
}

backfillQueue().catch(console.error);
