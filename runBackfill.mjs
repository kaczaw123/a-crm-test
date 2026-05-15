import admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

async function runBackfill() {
  console.log('Starting Backfill...');
  const companiesSnap = await db.collection('companies').get();
  console.log(`Found ${companiesSnap.size} companies.`);
  
  let processedStock = 0;
  
  for (const compDoc of companiesSnap.docs) {
    const companyId = compDoc.id;
    const companyData = compDoc.data();
    const companyNip = companyData.taxId || companyData.nip || '';

    const stockSnap = await db.collection(`companies/${companyId}/inventoryStock`).get();
    console.log(`Company ${companyId}: found ${stockSnap.size} stock records.`);
    
    let sumQtyOnHand = 0;
    let sumQtyReserved = 0;
    let sumQtyAvailable = 0;
    let sumWeightKg = 0;
    let sumVolumeM3 = 0;

    const batches = [];
    let currentBatch = db.batch();
    let opCount = 0;

    for (const stockDoc of stockSnap.docs) {
      const s = stockDoc.data();
      
      const qtyOnHand = s.qtyOnHand ?? s.onHand ?? 0;
      const qtyReserved = s.qtyReserved ?? s.reserved ?? 0;
      const qtyAvailable = s.qtyAvailable ?? s.available ?? (qtyOnHand - qtyReserved);
      const totalWeightKg = s.totalWeightKg ?? s.totalWeight ?? 0;
      const totalVolumeM3 = s.totalVolumeM3 ?? s.totalVolume ?? 0;

      sumQtyOnHand += qtyOnHand;
      sumQtyReserved += qtyReserved;
      sumQtyAvailable += qtyAvailable;
      sumWeightKg += totalWeightKg;
      sumVolumeM3 += totalVolumeM3;

      const updatePayload = {
        companyNip,
        qtyOnHand,
        qtyReserved,
        qtyAvailable,
        totalWeightKg,
        totalVolumeM3,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      if (!s.companyName) updatePayload.companyName = companyData.name || 'Nieznana Firma';
      
      currentBatch.update(stockDoc.ref, updatePayload);
      opCount++;
      
      if (opCount >= 400) {
         batches.push(currentBatch);
         currentBatch = db.batch();
         opCount = 0;
      }
    }
    
    if (opCount > 0) batches.push(currentBatch);
    
    for (const b of batches) {
       await b.commit();
    }
    console.log(`Company ${companyId}: Committed ${batches.length} batches.`);

    await compDoc.ref.set({
      warehouseStats: {
        totalQtyOnHand: sumQtyOnHand,
        totalQtyReserved: sumQtyReserved,
        totalQtyAvailable: sumQtyAvailable,
        totalWeightKg: sumWeightKg,
        totalVolumeM3: sumVolumeM3,
        totalSkuCount: stockSnap.size,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    }, { merge: true });
    
    processedStock += stockSnap.size;
  }
  
  console.log(`Backfill Complete! Processed ${processedStock} stock items across ${companiesSnap.size} companies.`);
}

runBackfill().catch(console.error);
