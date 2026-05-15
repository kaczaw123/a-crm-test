import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

// Removed global db to prevent ES6 hoisting crash
export const createInboundShipment = onCall(async (request) => {
  try {
    const db = admin.firestore();
    const { auth, data } = request;
    console.log('[DIAG] createInboundShipment START auth.uid:', auth?.uid, 'payload:', JSON.stringify(data));
    
    if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
    console.log('[STEP] validated auth');

    const { companyId, items, plannedDeliveryDate, carrier, trackingNumber, destinationLocationId, status } = data;
    if (!companyId || !Array.isArray(items) || items.length === 0 || !destinationLocationId) {
      throw new HttpsError('invalid-argument', 'Missing required parameters or empty items list.');
    }
    console.log('[STEP] validated payload');

    const token = auth.token as any;
    const isSuperadmin = token.role === 'superadmin' || token.globalRole === 'superadmin';
    let hasCurrentCompanyAccess = token.companyId === companyId || (token.companies && token.companies.includes(companyId));
    
    if (!isSuperadmin && !hasCurrentCompanyAccess) {
      const memberDoc = await db.collection(`companies/${companyId}/members`).doc(auth.uid).get();
      if (!memberDoc.exists) {
        throw new HttpsError('permission-denied', 'Unauthorized access to this company.');
      }
      hasCurrentCompanyAccess = true;
    }
    
    const companyDoc = await db.collection('companies').doc(companyId).get();
    if (!companyDoc.exists) throw new HttpsError('not-found', 'Company not found.');
    const companyData = companyDoc.data()!;
    console.log('[STEP] resolved company/member');

    // Weryfikacja magazynu i pobranie Snapshotu (Zero-Trust)
    const warehouseAccessSnap = await db.collection(`companies/${companyId}/warehouseAccess`).doc(destinationLocationId).get();
    if (!warehouseAccessSnap.exists) {
      throw new HttpsError('permission-denied', 'Brak autoryzacji do wybranego magazynu dla tej firmy.');
    }
    
    if (warehouseAccessSnap.data()?.isActive === false) {
      throw new HttpsError('permission-denied', 'Dostęp do tego magazynu został wyłączony dla Twojej firmy.');
    }

    const globalWarehouseSnap = await db.collection('warehouses').doc(destinationLocationId).get();
    if (!globalWarehouseSnap.exists) {
      throw new HttpsError('not-found', 'Wybrany magazyn fizycznie nie istnieje.');
    }

    const warehouseData = globalWarehouseSnap.data()!;
    if (warehouseData.isActive === false) {
      throw new HttpsError('failed-precondition', 'Ten magazyn globalny jest obecnie dezaktywowany.');
    }

    const destinationWarehouseSnapshot = {
      address: warehouseData.address || {},
      contact: warehouseData.contact || {},
      companyName: warehouseData.companyName || '',
      warehouseType: warehouseData.warehouseType || 'fulfillment',
      openingHours: warehouseData.openingHours || '',
      deliveryInstructions: warehouseData.deliveryInstructions || ''
    };

    let totalExpectedQty = 0;
    let totalExpectedWeight = 0;
    let totalExpectedVolume = 0;
    const enrichedItems = [];
    
    const itemsWithProductIds = items.filter((i: any) => i.productId && i.sourceType !== 'manual_product');
    const productRefs = itemsWithProductIds.map((i: any) => db.collection(`companies/${companyId}/products`).doc(i.productId));
    const productSnaps = productRefs.length > 0 ? await db.getAll(...productRefs) : [];

    const productMap = new Map();
    for(const snap of productSnaps) {
      if(snap.exists) productMap.set(snap.id, snap.data());
    }

    for (const itemReq of items) {
      const expectedQty = parseInt(itemReq.expectedQty || '0', 10);
      if (expectedQty <= 0) continue;

      let weight = Number(itemReq.weight) || 0;
      let l = Number(itemReq.length) || 0;
      let w = Number(itemReq.width) || 0;
      let h = Number(itemReq.height) || 0;
      
      const isManual = itemReq.sourceType === 'manual_product';

      let sku = itemReq.sku || '';
      let ean = itemReq.ean || '';
      let name = itemReq.name || '';

      if (!isManual && itemReq.productId) {
         const pData = productMap.get(itemReq.productId);
         if (!pData) {
            throw new HttpsError('not-found', `Product ${itemReq.productId} not found.`);
         }
         
         if (!name) name = pData.name || '';
         if (!sku) sku = pData.sku || pData.externalId || '';
         if (!ean) ean = pData.ean || '';

         // Fallback to database values if inputs are missing or <= 0
         if (weight <= 0) weight = Number(pData.logistics?.weight) || 0;
         if (l <= 0) l = Number(pData.logistics?.length) || 0;
         if (w <= 0) w = Number(pData.logistics?.width) || 0;
         if (h <= 0) h = Number(pData.logistics?.height) || 0;
      } else {
         if (!name || weight <= 0 || l <= 0 || w <= 0 || h <= 0) {
            throw new HttpsError('invalid-argument', 'Manual products must have a name, positive weight and full dimensions.');
         }
      }

      const volume = (l * w * h) / 1000000;
      const itemTotalWeight = weight * expectedQty;
      const itemTotalVolume = volume * expectedQty;

      enrichedItems.push({
        id: db.collection(`companies/${companyId}/inboundShipments`).doc().id,
        productId: itemReq.productId || null,
        sourceType: itemReq.sourceType || 'catalog_product',
        sku,
        ean,
        name,
        expectedQty,
        receivedQty: 0,
        weightPerUnit: weight,
        volumePerUnit: volume,
        lengthPerUnit: l,
        widthPerUnit: w,
        heightPerUnit: h,
        totalExpectedWeight: itemTotalWeight,
        totalExpectedVolume: itemTotalVolume,
        totalReceivedWeight: 0,
        totalReceivedVolume: 0,
        unit: itemReq.unit || 'szt.'
      });

      totalExpectedQty += expectedQty;
      totalExpectedWeight += itemTotalWeight;
      totalExpectedVolume += itemTotalVolume;
    }

    if (enrichedItems.length === 0) {
      throw new HttpsError('invalid-argument', 'No valid items with quantity > 0 provided.');
    }
    console.log('[STEP] resolving products completed');

    const shipmentRef = db.collection(`companies/${companyId}/inboundShipments`).doc();
    const batch = db.batch();
    const finalStatus = status === 'submitted' ? 'submitted' : 'draft';

    console.log('[STEP] creating inbound shipment doc');
    batch.set(shipmentRef, {
      orgId: companyId,
      companyId: companyId,
      companyName: companyData.name || '',
      companyNip: companyData.taxId || '',
      status: finalStatus,
      destinationWarehouseId: destinationLocationId,
      destinationWarehouseCode: warehouseData.code || '',
      destinationWarehouseName: warehouseData.name || '',
      destinationWarehouseSnapshot,
      plannedDeliveryDate: plannedDeliveryDate ? Timestamp.fromDate(new Date(plannedDeliveryDate)) : null,
      carrier: carrier || '',
      trackingNumber: trackingNumber || '',
      totalExpectedQty,
      totalExpectedWeight,
      totalExpectedVolume,
      itemsCount: enrichedItems.length,
      totalReceivedQty: 0,
      totalReceivedWeight: 0,
      totalReceivedVolume: 0,
      receiptStatus: 'pending',
      lockedBy: null,
      lockedAt: null,
      receiptProgress: 0,
      createdBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log('[STEP] creating inbound items');
    for (const eItem of enrichedItems) {
      const itemRef = shipmentRef.collection('items').doc(eItem.id);
      batch.set(itemRef, eItem);
    }

    await batch.commit();
    console.log('[STEP] success', shipmentRef.id);
    return { success: true, shipmentId: shipmentRef.id };

  } catch (error: any) {
    console.error('[DIAG] createInboundShipment CATCH ERROR:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'createInboundShipment failed', { originalMessage: error.message || String(error) });
  }
});


export const startReceiptTransaction = onCall(async (request) => {
  try {
    const db = admin.firestore();
    const { auth, data } = request;
    if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

    const { companyId, shipmentId } = data;
    if (!companyId || !shipmentId) throw new HttpsError('invalid-argument', 'Missing parameters.');

    const token = auth.token as any;
    const isSuperadmin = token.role === 'superadmin' || token.globalRole === 'superadmin';
    let hasCurrentCompanyAccess = token.companyId === companyId || (token.companies && token.companies.includes(companyId));
    
    if (!isSuperadmin && !hasCurrentCompanyAccess) {
      const memberDoc = await db.collection(`companies/${companyId}/members`).doc(auth.uid).get();
      if (!memberDoc.exists) {
        throw new HttpsError('permission-denied', 'Unauthorized access to this company.');
      }
      hasCurrentCompanyAccess = true;
    }

    const shipmentRef = db.collection(`companies/${companyId}/inboundShipments`).doc(shipmentId);

    // Use a transaction to ensure atomic lock securing
    return await db.runTransaction(async (t) => {
      const doc = await t.get(shipmentRef);
      if (!doc.exists) throw new HttpsError('not-found', 'Shipment not found.');

      const currentLock = doc.data()?.lockedBy;
      const currentStatus = doc.data()?.receiptStatus;

      if (currentStatus === 'completed') {
        throw new HttpsError('failed-precondition', 'Shipment is already fully received.');
      }

      if (currentLock && currentLock !== auth.uid) {
        throw new HttpsError('failed-precondition', `Shipment is currently locked by another user (${currentLock}).`);
      }

      t.update(shipmentRef, {
        lockedBy: auth.uid,
        lockedAt: FieldValue.serverTimestamp(),
        receiptStatus: 'processing',
        status: 'in_receiving' // Elevate status naturally
      });

      return { success: true, message: 'Transaction acquired securely.' };
    });
  } catch (err: any) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('internal', err.message || 'Unknown generic error in Transaction');
  }
});


export const unlockReceiptTransaction = onCall(async (request) => {
  const db = admin.firestore();
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

  const { companyId, shipmentId } = data;
  if (!companyId || !shipmentId) throw new HttpsError('invalid-argument', 'Missing parameters.');

  const token = auth.token as any;
  const isSuperadmin = token.role === 'superadmin' || token.globalRole === 'superadmin';
  const hasCurrentCompanyAccess = token.companyId === companyId || (token.companies && token.companies.includes(companyId));
  
  if (!isSuperadmin && !hasCurrentCompanyAccess) {
    throw new HttpsError('permission-denied', 'Unauthorized access to this company.');
  }

  const shipmentRef = db.collection(`companies/${companyId}/inboundShipments`).doc(shipmentId);
  await shipmentRef.update({
    lockedBy: null,
    lockedAt: null,
  });

  return { success: true };
});



export const forceCloseInboundShipment = onCall(async (request) => {
  const db = admin.firestore();
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

  const { companyId, shipmentId, closeReason, closeNote } = data;
  if (!companyId || !shipmentId || !closeReason) {
    throw new HttpsError('invalid-argument', 'Missing parameters.');
  }

  const token = auth.token as any;
  const isSuperadmin = token.role === 'superadmin' || token.globalRole === 'superadmin';
  if (!isSuperadmin) throw new HttpsError('permission-denied', 'Only Super Admin can force-close shipments.');

  const shipmentRef = db.collection(`companies/${companyId}/inboundShipments`).doc(shipmentId);

  return await db.runTransaction(async (t) => {
    const doc = await t.get(shipmentRef);
    if (!doc.exists) throw new HttpsError('not-found', 'Shipment not found.');
    const d = doc.data()!;
    if (d.receiptStatus === 'completed' || d.status === 'closed_with_shortage') {
       throw new HttpsError('failed-precondition', 'Shipment is already closed.');
    }

    t.update(shipmentRef, {
      status: 'closed_with_shortage',
      receiptStatus: 'completed',
      lockedBy: null,
      overrideUsed: true,
      closedBy: auth.uid,
      closedAt: FieldValue.serverTimestamp(),
      closeReason: closeReason,
      closeNote: closeNote || '',
      updatedAt: FieldValue.serverTimestamp()
    });

    return { success: true };
  });
});

export const saveInboundReceiptItemDraft = onCall({ cors: true }, async (request) => {
  const db = admin.firestore();
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

  const { companyId, shipmentId, itemId, receivedQty, weightKg, lengthCm, widthCm, heightCm } = data;
  if (!companyId || !shipmentId || !itemId) {
    throw new HttpsError('invalid-argument', 'Missing parameters.');
  }

  const token = auth.token as any;
  const isSuperadmin = token.role === 'superadmin' || token.globalRole === 'superadmin';
  const hasCurrentCompanyAccess = token.companyId === companyId || (token.companies && token.companies.includes(companyId));
  
  if (!isSuperadmin && !hasCurrentCompanyAccess) {
    throw new HttpsError('permission-denied', 'Unauthorized access to this company.');
  }

  const shipmentRef = db.collection(`companies/${companyId}/inboundShipments`).doc(shipmentId);
  
  // Weryfikacja statusu przed aktualizacją
  const shipDoc = await shipmentRef.get();
  if (!shipDoc.exists) throw new HttpsError('not-found', 'Shipment not found.');
  const shipData = shipDoc.data()!;
  
  if (shipData.lockedBy !== auth.uid) {
    throw new HttpsError('failed-precondition', 'Shipment lock lost or hijacked. Abandoning record.');
  }
  if (shipData.status === 'received_complete' || shipData.status === 'closed_with_shortage') {
    throw new HttpsError('failed-precondition', 'Shipment already completed.');
  }

  const itemRef = shipmentRef.collection('items').doc(itemId);
  const q = parseInt(String(receivedQty || '0'), 10);

  let draftUpdate: any = {
    draftReceivedQty: q,
    draftCompleted: true, // Znaczy ze roboczo odhaczone
  };

  // Zapis poprawionych gabarytów na poziomie DRAFT
  if (weightKg !== undefined || lengthCm !== undefined || widthCm !== undefined || heightCm !== undefined) {
    draftUpdate.draftLengthPerUnit = lengthCm !== undefined ? Number(lengthCm) : FieldValue.delete();
    draftUpdate.draftWidthPerUnit = widthCm !== undefined ? Number(widthCm) : FieldValue.delete();
    draftUpdate.draftHeightPerUnit = heightCm !== undefined ? Number(heightCm) : FieldValue.delete();
    draftUpdate.draftWeightPerUnit = weightKg !== undefined ? Number(weightKg) : FieldValue.delete();
    
    // Obliczenie objętości
    const l = Number(lengthCm || 0);
    const w = Number(widthCm || 0);
    const h = Number(heightCm || 0);
    if (l && w && h) {
       draftUpdate.draftVolumePerUnit = (l * w * h) / 1000000;
    } else {
       draftUpdate.draftVolumePerUnit = FieldValue.delete();
    }
  } else {
    // Reset wymiarów
    draftUpdate.draftLengthPerUnit = FieldValue.delete();
    draftUpdate.draftWidthPerUnit = FieldValue.delete();
    draftUpdate.draftHeightPerUnit = FieldValue.delete();
    draftUpdate.draftWeightPerUnit = FieldValue.delete();
    draftUpdate.draftVolumePerUnit = FieldValue.delete();
  }

  // Używamy update() ponieważ dokument musi istnieć - zapobiegnie to CORS/Internal wskutek transakcji.
  await itemRef.update(draftUpdate);

  // Drobny update timestampu na awizacji (opcjonalny)
  await shipmentRef.update({ updatedAt: FieldValue.serverTimestamp() });

  return { success: true };
});

export const finalizeInboundShipment = onCall(async (request) => {
  const db = admin.firestore();
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

  const { companyId, shipmentId } = data;
  if (!companyId || !shipmentId) throw new HttpsError('invalid-argument', 'Missing parameters.');

  const token = auth.token as any;
  const isSuperadmin = token.role === 'superadmin' || token.globalRole === 'superadmin';
  const hasCurrentCompanyAccess = token.companyId === companyId || (token.companies && token.companies.includes(companyId));
  
  if (!isSuperadmin && !hasCurrentCompanyAccess) {
    throw new HttpsError('permission-denied', 'Unauthorized access to this company.');
  }

  const shipmentRef = db.collection(`companies/${companyId}/inboundShipments`).doc(shipmentId);
  const itemsRef = shipmentRef.collection('items');

  return await db.runTransaction(async (t) => {
    const shipDoc = await t.get(shipmentRef);
    if (!shipDoc.exists) throw new HttpsError('not-found', 'Shipment not found.');

    const shipData = shipDoc.data()!;
    if (shipData.lockedBy !== auth.uid) {
      throw new HttpsError('failed-precondition', 'Shipment lock lost or hijacked.');
    }
    if (shipData.receiptStatus === 'completed') {
      throw new HttpsError('failed-precondition', 'Shipment already completed.');
    }

    const itemsSnap = await t.get(itemsRef);
    if (itemsSnap.empty) throw new HttpsError('failed-precondition', 'No items found in shipment.');

    let batchReceivedQty = 0;
    let batchReceivedWeight = 0;
    let batchReceivedVolume = 0;

    const stockReads: any[] = [];
    for (const itemDoc of itemsSnap.docs) {
      const itemData = itemDoc.data();
      if (!itemData.draftCompleted && itemData.draftReceivedQty === undefined) {
          throw new HttpsError('failed-precondition', `Nie wszystkie pozycje zostały zatwierdzone roboczo. Brakuje wyceny dla: ${itemData.name}`);
      }
      
      const resolvedProductId = itemData.productId || itemData.sku || itemDoc.id;
      const stockId = `${resolvedProductId}_${shipData.destinationWarehouseId}`;

      // Zabezpieczenie - jeśli nadal brak ID rzuć błąd zamiast tworzyć null_
      if (!resolvedProductId || resolvedProductId === 'null' || resolvedProductId === 'undefined') {
        console.error('Brak productId dla pozycji:', itemDoc.id, itemData);
        continue; // Pomiń tę pozycję zamiast tworzyć błędny rekord
      }

      const stockRef = db.collection(`companies/${companyId}/inventoryStock`).doc(stockId);
      
      let productRef = null;
      if (itemData.productId) { 
         productRef = db.collection(`companies/${companyId}/products`).doc(itemData.productId);
      }

      stockReads.push({
        itemDoc,
        resolvedProductId,
        stockRef,
        stockPromise: t.get(stockRef),
        productRef,
        productPromise: productRef ? t.get(productRef) : null
      });
    }

    // Await all reads before proceeding to writes
    for (const r of stockReads) {
       r.stockDoc = await r.stockPromise;
       r.productDoc = r.productPromise ? await r.productPromise : null;
    }

    // Writes
    for (const r of stockReads) {
      const itemData = r.itemDoc.data()!;
      const q = itemData.draftReceivedQty || 0;
      let unitWeight = itemData.weightPerUnit || 0;
      let unitVol = itemData.volumePerUnit || 0;

      // Fallback do danych z obiektu produktu (jeśli waga nie była podana w inbound draft)
      if (unitWeight === 0 && r.productDoc?.exists) {
         const pData = r.productDoc.data();
         unitWeight = pData?.logistics?.weight || pData?.weight || 0;
         const l = pData?.logistics?.length || pData?.dimensions?.length || 0;
         const w = pData?.logistics?.width || pData?.dimensions?.width || 0;
         const h = pData?.logistics?.height || pData?.dimensions?.height || 0;
         if (unitVol === 0) {
           unitVol = pData?.logistics?.volume || ((l * w * h) / 1000000) || 0;
         }
      }
      
      // Apply Corrections
      if (itemData.draftWeightPerUnit !== undefined) {
         unitWeight = itemData.draftWeightPerUnit;
         unitVol = itemData.draftVolumePerUnit || 0;
         const l = itemData.draftLengthPerUnit || 0;
         const w = itemData.draftWidthPerUnit || 0;
         const h = itemData.draftHeightPerUnit || 0;
         
         if (r.productRef && r.productDoc?.exists) {
            t.update(r.productRef, {
              'logistics.weight': unitWeight,
              'logistics.length': l,
              'logistics.width': w,
              'logistics.height': h,
              'logistics.volume': unitVol,
              updatedAt: FieldValue.serverTimestamp()
            });
         }
         
         t.update(r.itemDoc.ref, {
           weightPerUnit: unitWeight,
           volumePerUnit: unitVol,
           lengthPerUnit: l,
           widthPerUnit: w,
           heightPerUnit: h
         });
      }

      const totalWeight = q * unitWeight;
      const totalVolume = q * unitVol;
      
      batchReceivedQty += q;
      batchReceivedWeight += totalWeight;
      batchReceivedVolume += totalVolume;

      t.update(r.itemDoc.ref, {
         receivedQty: q,
         totalReceivedWeight: totalWeight,
         totalReceivedVolume: totalVolume
      });

      // ---- INVENTORY CORE LAYER ----
      if (q > 0) {
        const currentStock = r.stockDoc?.exists 
          ? r.stockDoc.data()! 
          : { qtyOnHand: 0, qtyReserved: 0, qtyAvailable: 0 };

        const baseOnHand = currentStock.qtyOnHand ?? currentStock.onHand ?? 0;
        const baseReserved = currentStock.qtyReserved ?? currentStock.reserved ?? 0;

        const newOnHand = baseOnHand + q;
        const newAvailable = newOnHand - baseReserved;
        
        const newStockTotalWeight = newOnHand * unitWeight;
        const newStockTotalVolume = newOnHand * unitVol;

        const stockPayload = {
          companyId: companyId,
          companyName: shipData.companyName || '',
          companyNip: shipData.companyNip || '',
          productId: r.resolvedProductId,
          sku: itemData.sku || '',
          productName: itemData.name || '',
          ean: itemData.ean || '',
          
          qtyOnHand: newOnHand,
          qtyReserved: baseReserved,
          qtyAvailable: newAvailable,
          
          unitWeightKg: unitWeight,
          totalWeightKg: newStockTotalWeight,
          unitVolumeM3: unitVol,
          totalVolumeM3: newStockTotalVolume,
          
          warehouseLocationId: shipData.destinationWarehouseId,
          warehouseLocationCode: shipData.destinationWarehouseCode || shipData.destinationWarehouseId, 
          
          receivedFromInboundId: shipmentId,
          lastMovementAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        };

        t.set(r.stockRef, stockPayload, { merge: true });

        // Build Ledger Event
        const movementRef = db.collection(`companies/${companyId}/inventoryMovements`).doc();
        t.set(movementRef, {
          orgId: companyId,
          productId: r.resolvedProductId,
          locationId: shipData.destinationWarehouseId,
          type: 'RECEIPT',
          quantity: q,
          weightTotal: totalWeight,
          volumeTotal: totalVolume,
          
          onHandAfter: newOnHand,
          reservedAfter: baseReserved,
          availableAfter: newAvailable,

          referenceType: 'INBOUND_SHIPMENT',
          referenceId: shipmentId,
          performedBy: auth.uid,
          note: 'Odbiór dwuetapowy WMS',
          createdAt: FieldValue.serverTimestamp()
        });
      }
    }

    // Wrap up Shipment Header
    const finalReceivedQty = batchReceivedQty;
    const finalExpectedQty = shipData.totalExpectedQty;

    const finalStatus = (finalReceivedQty >= finalExpectedQty) ? 'completed' : 'partial';
    
    t.update(shipmentRef, {
      totalReceivedQty: finalReceivedQty,
      totalReceivedWeight: batchReceivedWeight,
      totalReceivedVolume: batchReceivedVolume,
      receiptStatus: 'completed',
      status: (finalStatus === 'completed') ? 'received_complete' : 'closed_with_shortage',
      receiptProgress: 100,
      lockedBy: null,
      lockedAt: null,
      updatedAt: FieldValue.serverTimestamp()
    });

    // --- GAMIFICATION REWARD (EUR WALLET) ---
    if (finalReceivedQty >= 100 && shipData.createdBy) {
      let rewardedRef = db.collection('users').doc(shipData.createdBy);
      let rewardedDoc = await t.get(rewardedRef);
      
      if (!rewardedDoc.exists) {
        rewardedRef = db.collection('platformUsers').doc(shipData.createdBy);
        rewardedDoc = await t.get(rewardedRef);
      }

      if (rewardedDoc.exists) {
        const currentBalance = rewardedDoc.data()?.rewardBalance || 0;
        t.update(rewardedRef, { rewardBalance: currentBalance + 10 });
      }
    }

    return { 
      success: true, 
      finalReceivedQty
    };
  });
});
