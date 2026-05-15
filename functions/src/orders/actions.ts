import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// 1. ODCZYT PEŁNEGO ZAMÓWIENIA DLA FRONTENDU
export const getOrderDetails = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  
  const { companyId, orderId } = data;
  if (!companyId || !orderId) throw new HttpsError('invalid-argument', 'Brak parametrów.');

  const orderDoc = await db.collection(`companies/${companyId}/orders`).doc(orderId).get();
  if (!orderDoc.exists) throw new HttpsError('not-found', 'Zamówienie nie istnieje.');

  const orderItemsQuery = db.collection(`companies/${companyId}/orderItems`).where('orderId', '==', orderId).get();
  const logsQuery = db.collection(`companies/${companyId}/orderActivityLogs`).where('orderId', '==', orderId).orderBy('timestamp', 'desc').get();
  const movesQuery = db.collection(`companies/${companyId}/inventoryMovements`).where('referenceId', '==', orderId).where('referenceType', '==', 'order').orderBy('createdAt', 'desc').get();
  const resQuery = db.collection(`companies/${companyId}/stockReservations`).where('orderId', '==', orderId).get();

  const [itemsSnap, logsSnap, movesSnap, resSnap] = await Promise.all([orderItemsQuery, logsQuery, movesQuery, resQuery]);

  const itemsData = itemsSnap.docs.map(d => d.data());

  const mappedProductIds = itemsData
      .filter((i: any) => i.mappingStatus === 'mapped' && i.productId)
      .map((i: any) => i.productId);
      
  const uniqueMappedProductIds = [...new Set(mappedProductIds)];
  
  const productsMap = new Map<string, any>();
  if (uniqueMappedProductIds.length > 0) {
      const chunks = [];
      for(let i=0; i<uniqueMappedProductIds.length; i+=30) chunks.push(uniqueMappedProductIds.slice(i, i+30));
      
      for(const chunk of chunks) {
         const productsSnap = await db.collection(`companies/${companyId}/products`).where(admin.firestore.FieldPath.documentId(), 'in', chunk).get();
         productsSnap.forEach(d => {
            productsMap.set(d.id, d.data());
         });
      }
  }

  const enrichedItems = itemsData.map((item: any) => {
      if (item.mappingStatus === 'mapped' && item.productId && productsMap.has(item.productId)) {
          return { ...item, crmProductSnapshot: productsMap.get(item.productId) };
      }
      return item;
  });

  return {
    order: orderDoc.data(),
    items: enrichedItems,
    activityLogs: logsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    inventoryMovements: movesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    stockReservations: resSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };
});

// Pomocnicza funkcja zwalniania rezerwacji wewnątrz Transaction (wymaga transakcji t)
const _internalReleaseReservations = async (t: admin.firestore.Transaction, companyId: string, orderId: string, operatorId: string) => {
  const now = FieldValue.serverTimestamp();
  
  // Znajdź wszystkie aktywne rezerwacje
  const resQuery = db.collection(`companies/${companyId}/stockReservations`)
    .where('orderId', '==', orderId)
    .where('status', '==', 'active');
    
  const reservations = await t.get(resQuery);
  if (reservations.empty) return 0;

  let totalReleased = 0;
  
  // Odszukujemy oryginały z inventoryStock na podstawie `productId` i locId.
  // 1. ODCZYTY TRANSAKCYJNE (READS)
  const stockPromises = reservations.docs.map(async (r) => {
    const rData = r.data();
    const stocksRef = db.collection(`companies/${companyId}/inventoryStock`)
        .where('productId', '==', rData.productId)
        .where('warehouseLocationId', '==', rData.locationId);
        
    const stockDocs = await t.get(stocksRef);
    if (!stockDocs.empty) {
      return { resDoc: r, stockDoc: stockDocs.docs[0] };
    }
    return { resDoc: r, stockDoc: null };
  });

  const pairs = await Promise.all(stockPromises);
  const itemsDocs = await t.get(db.collection(`companies/${companyId}/orderItems`).where('orderId', '==', orderId));

  // 2. OBLICZENIA LOGIKI (CPU)
  const inventoryStockUpdates = new Map<string, any>(); 

  // Sumowanie operacji rezerwacji by wiedzieć ile stocku zdjąć
  for (const pair of pairs) {
     if (!pair.stockDoc) continue;
     const docId = pair.stockDoc.id;
     if (!inventoryStockUpdates.has(docId)) {
        inventoryStockUpdates.set(docId, {
           docRef: pair.stockDoc.ref,
           data: pair.stockDoc.data(),
           deltaReservedToSubtract: 0,
           movements: []
        });
     }
     const state = inventoryStockUpdates.get(docId)!;
     state.deltaReservedToSubtract += pair.resDoc.data().qtyReserved || 0;
     
     // Dodaj log na poziomie release dla każdego dokumentu rezerwacji odrębnie (lub zagregowane, tu odrębnie)
     state.movements.push({
         productId: pair.resDoc.data().productId,
         locationId: pair.resDoc.data().locationId,
         qty: pair.resDoc.data().qtyReserved || 0
     });
  }

  // 3. ZAPISY TRANSAKCYJNE (WRITES)
  reservations.forEach(resDoc => {
    const res = resDoc.data();
    const qtyToRelease = res.qtyReserved || 0;
    if (qtyToRelease <= 0) return;

    totalReleased += qtyToRelease;
    
    t.update(resDoc.ref, {
      status: 'released',
      qtyReserved: 0,
    });
  });

  // Wykonaj zapisy w inventoryStock i historyczne Ledger Movements
  for (const [, state] of inventoryStockUpdates.entries()) {
     const locData = state.data;
     const delta = state.deltaReservedToSubtract;
     
     const beforeReserved = locData.qtyReserved || 0;
     const beforeAvailable = locData.qtyAvailable || 0;
     const locOnHand = locData.qtyOnHand || 0;
     
     const newReserved = Math.max(0, beforeReserved - delta);
     const newAvailable = Math.max(0, locOnHand - newReserved);

     t.update(state.docRef, {
        qtyReserved: newReserved,
        qtyAvailable: newAvailable,
        updatedAt: now
     });

     const orderRef = db.collection(`companies/${companyId}/orders`).doc(orderId);
     const orderDocTemp = await t.get(orderRef);
     const orderNum = orderDocTemp.exists ? (orderDocTemp.data()?.referenceNumber || orderDocTemp.data()?.orderNumber || orderDocTemp.data()?.externalId) : undefined;

     // Stwórz log `inventoryMovements` per produkt 
     for (const mov of state.movements) {
        if (mov.qty <= 0) continue;
        const movRef = db.collection(`companies/${companyId}/inventoryMovements`).doc();
        t.set(movRef, {
          orgId: companyId,
          productId: mov.productId,
          locationId: mov.locationId,
          type: 'RESERVATION_RELEASE',
          movementType: 'RESERVATION_RELEASE',
          quantity: mov.qty, 
          quantityDelta: -mov.qty, // odejmujemy od zarezerwowanych
          referenceType: 'order',
          referenceId: orderId,
          orderNumber: orderNum || orderId,
          operatorId: operatorId,
          before: { qtyOnHand: locOnHand, qtyReserved: beforeReserved, qtyAvailable: beforeAvailable },
          after: { qtyOnHand: locOnHand, qtyReserved: newReserved, qtyAvailable: newAvailable },
          createdAt: now
        });
     }
  }

  // Zresetuj qtyReserved w orderItems 
  itemsDocs.docs.forEach((item: any) => {
     t.update(item.ref, { qtyReserved: 0 });
  });

  return totalReleased;
};


// 2. RELEASE RESERVATION - Zwolnienie sprzętu z powrotem na półki (anulacja z alokacji bez anulacji całego zlecenia)
export const releaseReservation = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  const { companyId, orderId } = data;
  
  await db.runTransaction(async (t) => {
    const orderRef = db.collection(`companies/${companyId}/orders`).doc(orderId);
    const orderDoc = await t.get(orderRef);
    if (!orderDoc.exists) throw new HttpsError('not-found', 'Order not found');
    const orderData = orderDoc.data()!;
    
    if (orderData.status === 'shipped') throw new HttpsError('failed-precondition', 'Zlecenie zostało już wysłane fizycznie.');
    if (orderData.reservationStatus === 'released' || orderData.reservationStatus === 'none') {
        throw new HttpsError('already-exists', 'Brak stanów rezerwacyjnych na zleceniu.');
    }

    const releasedCount = await _internalReleaseReservations(t, companyId, orderId, auth.uid);

    let finalStatus = 'awaiting_stock';
    if (orderData.status === 'processing' || orderData.status === 'ready_for_shipping') {
        finalStatus = 'awaiting_stock'; // Cofa sie w rurce procesu do przeliczania
    }

    t.update(orderRef, {
      reservationStatus: 'released',
      status: finalStatus,
      shipmentStatus: 'not_ready',
      updatedAt: FieldValue.serverTimestamp()
    });

    const actRef = db.collection(`companies/${companyId}/orderActivityLogs`).doc();
    t.set(actRef, {
      orgId: companyId, orderId,
      action: 'RESERVATION_RELEASED', operatorId: auth.uid,
      dataBefore: { status: orderData.status, reservationStatus: orderData.reservationStatus },
      dataAfter: { status: finalStatus, reservationStatus: 'released', releasedItems: releasedCount },
      timestamp: FieldValue.serverTimestamp()
    });
  });

  return { success: true };
});

// 3. CANCEL ORDER - Całkowite zabicie transakcji
export const cancelOrder = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  const { companyId, orderId } = data;

  await db.runTransaction(async (t) => {
    const orderRef = db.collection(`companies/${companyId}/orders`).doc(orderId);
    const orderDoc = await t.get(orderRef);
    if (!orderDoc.exists) throw new HttpsError('not-found', 'Order not found');
    const orderData = orderDoc.data()!;
    
    if (orderData.status === 'shipped') throw new HttpsError('failed-precondition', 'Nie można anulować wysłanego paczki.');
    if (orderData.status === 'cancelled') throw new HttpsError('already-exists', 'Zamówienie było anulowane wcześniej.');

    // Rzucenie rezerwacyj do kosza
    const releasedCount = await _internalReleaseReservations(t, companyId, orderId, auth.uid);

    t.update(orderRef, {
      status: 'cancelled',
      reservationStatus: 'released', // or none, ale returned historycznie
      updatedAt: FieldValue.serverTimestamp()
    });

    const actRef = db.collection(`companies/${companyId}/orderActivityLogs`).doc();
    t.set(actRef, {
      orgId: companyId, orderId,
      action: 'ORDER_CANCELLED', operatorId: auth.uid,
      dataBefore: { status: orderData.status },
      dataAfter: { status: 'cancelled', releasedCount },
      timestamp: FieldValue.serverTimestamp()
    });
  });

  return { success: true };
});

// 4. MARK READY FOR SHIPPING
export const markOrderReadyForShipping = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  const { companyId, orderId } = data;

  await db.runTransaction(async (t) => {
    const orderRef = db.collection(`companies/${companyId}/orders`).doc(orderId);
    const orderDoc = await t.get(orderRef);
    if (!orderDoc.exists) throw new HttpsError('not-found', 'Order not found');
    const orderData = orderDoc.data()!;
    
    if (orderData.status === 'cancelled') throw new HttpsError('failed-precondition', 'Zlecenie anulowane.');
    if (orderData.status === 'shipped') throw new HttpsError('failed-precondition', 'Już wysłane.');
    if (orderData.reservationStatus !== 'full') throw new HttpsError('failed-precondition', 'Nie skompletowano pomyślnie pełnej rezerwacji (braki na stoku).');

    t.update(orderRef, {
      status: 'ready_for_shipping',
      shipmentStatus: 'ready',
      updatedAt: FieldValue.serverTimestamp()
    });

    const actRef = db.collection(`companies/${companyId}/orderActivityLogs`).doc();
    t.set(actRef, {
      orgId: companyId, orderId,
      action: 'ORDER_READY_FOR_SHIPPING', operatorId: auth.uid,
      timestamp: FieldValue.serverTimestamp()
    });
  });
  return { success: true };
});

// 5. CONFIRM SHIPMENT - Finalizowanie drogi na zewnątrz
export const confirmShipment = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  const { companyId, orderId } = data;

  await db.runTransaction(async (t) => {
    const orderRef = db.collection(`companies/${companyId}/orders`).doc(orderId);
    const orderDoc = await t.get(orderRef);
    if (!orderDoc.exists) throw new HttpsError('not-found', 'Order not found');
    const orderData = orderDoc.data()!;
    
    if (orderData.status === 'shipped') throw new HttpsError('already-exists', 'Zamówienie było wysłane już wcześniej.');
    if (orderData.reservationStatus !== 'full') throw new HttpsError('failed-precondition', 'Wysyłka możliwa jedynie po zebraniu całkowitej rezerwacji systemu.');
    
    const now = FieldValue.serverTimestamp();

    // Szukamy rezerwacji
    const resDocsQuery = db.collection(`companies/${companyId}/stockReservations`).where('orderId', '==', orderId).where('status', '==', 'active');
    const resDocs = await t.get(resDocsQuery);
    
    let totalShippedCount = 0;

    const stockPromises = resDocs.docs.map(async r => {
      const rd = r.data();
      const sRef = db.collection(`companies/${companyId}/inventoryStock`)
          .where('productId', '==', rd.productId)
          .where('warehouseLocationId', '==', rd.locationId);
      const sDocs = await t.get(sRef);
      return { resDoc: r, stockDoc: sDocs.empty ? null : sDocs.docs[0] };
    });

    const pairs = await Promise.all(stockPromises);
    const itemsDocs = await t.get(db.collection(`companies/${companyId}/orderItems`).where('orderId', '==', orderId));

    const stockUpdates = new Map<string, any>();

    for (const p of pairs) {
       if (!p.stockDoc) continue; // Anomalie, ominiemy
       const id = p.stockDoc.id;
       if (!stockUpdates.has(id)) {
          stockUpdates.set(id, { docRef: p.stockDoc.ref, data: p.stockDoc.data(), deltaSubtract: 0, itemsLog: [] });
       }
       stockUpdates.get(id)!.deltaSubtract += p.resDoc.data().qtyReserved;
       stockUpdates.get(id)!.itemsLog.push(p.resDoc.data());
    }

    for (const [, s] of stockUpdates.entries()) {
       const w1 = s.data.qtyOnHand || 0;
       const w2 = s.data.qtyReserved || 0;
       const delta = s.deltaSubtract;

       totalShippedCount += delta;

       // Wylot fizyczny qtyOnHand w parze ze zwolnieniem zarezerwowanego stoku
       const finalOnHand = Math.max(0, w1 - delta);
       const finalReserved = Math.max(0, w2 - delta);
       // qtyAvailable bez zmian!
       
       t.update(s.docRef, { qtyOnHand: finalOnHand, qtyReserved: finalReserved, updatedAt: now });

       // Log Ledger Wylotowy
       for (const res of s.itemsLog) {
         const movRef = db.collection(`companies/${companyId}/inventoryMovements`).doc();
         t.set(movRef, {
            orgId: companyId,
            productId: res.productId,
            locationId: res.locationId,
            type: 'SHIPMENT_CONFIRM',
            movementType: 'SHIPMENT_CONFIRM',
            quantity: res.qtyReserved,
            quantityDelta: -res.qtyReserved, 
            referenceType: 'order', referenceId: orderId, operatorId: auth.uid,
            before: { qtyOnHand: w1, qtyReserved: w2, qtyAvailable: s.data.qtyAvailable || 0 },
            after: { qtyOnHand: finalOnHand, qtyReserved: finalReserved, qtyAvailable: s.data.qtyAvailable || 0 },
            createdAt: now
         });
       }
    }

    // Ubicie flag rezerwacji
    resDocs.docs.forEach(d => t.update(d.ref, { status: 'shipped' }));

    // Aktualizacja Order
    t.update(orderRef, {
      status: 'shipped',
      reservationStatus: 'none', // Zlecenie nie ma wiszących zobowiązań
      shipmentStatus: 'confirmed',
      updatedAt: now
    });

    // Aktualizacja Wierszy orderItems (qtyPicked/shipped sync for display)
    itemsDocs.docs.forEach(item => {
       const old = item.data();
       t.update(item.ref, { 
          qtyShipped: old.qtyReserved || 0, // Kopiujemy co mieliśmy w reserve na paczkę
          qtyReserved: 0
       });
    });

    const actRef = db.collection(`companies/${companyId}/orderActivityLogs`).doc();
    t.set(actRef, {
      orgId: companyId, orderId,
      action: 'ORDER_SHIPPED', operatorId: auth.uid,
      dataBefore: { status: orderData.status },
      dataAfter: { status: 'shipped', totalItemsShipped: totalShippedCount },
      timestamp: now
    });
  });

  return { success: true };
});

// 6. UPDATE ORDER BEFORE SHIPMENT
export const updateOrderBeforeShipment = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  const { companyId, orderId, recipient, notes, internalNotes } = data;

  await db.runTransaction(async (t) => {
    const orderRef = db.collection(`companies/${companyId}/orders`).doc(orderId);
    const orderDoc = await t.get(orderRef);
    if (!orderDoc.exists) throw new HttpsError('not-found', 'Order not found');
    const orderData = orderDoc.data()!;
    
    if (orderData.status === 'shipped') throw new HttpsError('failed-precondition', 'Edycja niemożliwa po wysyłce.');
    if (orderData.status === 'cancelled') throw new HttpsError('failed-precondition', 'Zlecenie odrzucone-anulowane.');

    const payloadToUpdate: any = { updatedAt: FieldValue.serverTimestamp() };
    if (recipient) payloadToUpdate.recipient = recipient;
    if (notes !== undefined) payloadToUpdate.notes = notes;
    if (internalNotes !== undefined) payloadToUpdate.internalNotes = internalNotes;

    t.update(orderRef, payloadToUpdate);

    const actRef = db.collection(`companies/${companyId}/orderActivityLogs`).doc();
    t.set(actRef, {
      orgId: companyId, orderId,
      action: 'ORDER_EDITED', operatorId: auth.uid,
      dataAfter: payloadToUpdate,
      timestamp: FieldValue.serverTimestamp()
    });
  });
  
  return { success: true };
});

// 7. ALLOCATE RESERVATIONS (Idempotentne zabezpieczenie stanu magazynowego)

export const internalAllocateReservations = async (companyId: string, orderId: string, operatorId: string) => {
  return await db.runTransaction(async (t) => {
    // 1. Odczyt Nagłówka
    const orderRef = db.collection(`companies/${companyId}/orders`).doc(orderId);
    const orderDoc = await t.get(orderRef);
    if (!orderDoc.exists) throw new HttpsError('not-found', 'Nie odnaleziono zlecenia.');
    const orderData = orderDoc.data()!;

    if (orderData.status === 'cancelled') throw new HttpsError('failed-precondition', 'Zlecenie zablokowane (anulowane).');
    if (orderData.status === 'shipped') throw new HttpsError('failed-precondition', 'Towar wysłano fizycznie.');
    if (orderData.reservationStatus === 'full') throw new HttpsError('already-exists', 'Zlecenie jest w 100% poprawnie zarezerwowane.');

    // 2. Odczyt Zmapowanych Pozycji (tylko one mogą rezerwować cokolwiek)
    const itemsRef = db.collection(`companies/${companyId}/orderItems`);
    const itemsDocs = await t.get(itemsRef.where('orderId', '==', orderId).where('mappingStatus', '==', 'mapped'));
    
    if (itemsDocs.empty) {
      throw new HttpsError('failed-precondition', 'Zlecenie nie posiada żadnych spiętych (zmapowanych) pozycji towarowych. Przeprowadź mapowanie przed wciśnięciem autoloakacji.');
    }

    // Zbierzmy unikalne ID kartotek oraz SKU jako fallback
    const productIdsArray = itemsDocs.docs.map(d => d.data().productId).filter(Boolean);
    const skusArray = itemsDocs.docs.map(d => d.data().sku).filter(Boolean);
    
    const uniqueProductIds = [...new Set(productIdsArray)];
    const uniqueSkus = [...new Set(skusArray)];

    if (uniqueProductIds.length === 0 && uniqueSkus.length === 0) {
      throw new HttpsError('failed-precondition', 'Nie wykryto kluczy productId ani sku na pozycjach.');
    }

    const allSkusToFetch = [...new Set([
        ...uniqueSkus,
        ...uniqueSkus.map(s => s.replace(/ /g, '_')),
        ...uniqueSkus.map(s => s.replace(/_/g, ' '))
    ])];

    // 3. ODCZYT FIZYCZNYCH STANÓW KARTOTEKOWYCH (inventoryStock) Z BAZY
    const stockPromisesByPid = uniqueProductIds.map(pid => 
      t.get(db.collection(`companies/${companyId}/inventoryStock`).where('productId', '==', pid))
    );
    const stockPromisesBySku = allSkusToFetch.map(sku => 
      t.get(db.collection(`companies/${companyId}/inventoryStock`).where('sku', '==', sku))
    );
    
    const stockDocsBatches = await Promise.all([...stockPromisesByPid, ...stockPromisesBySku]);
    
    // Konkretny podgląd stanów "LocId + ProductId => Wiersz DB"
    const stocksByProduct = new Map<string, Array<{docRef: FirebaseFirestore.DocumentReference, data: any}>>();
    const stocksBySku = new Map<string, Array<{docRef: FirebaseFirestore.DocumentReference, data: any}>>();
    const processedStockDocIds = new Set<string>();
    
    stockDocsBatches.forEach(batch => {
      batch.docs.forEach(d => {
        if (processedStockDocIds.has(d.id)) return;
        processedStockDocIds.add(d.id);
        
        const dData = d.data();
        if (dData.productId) {
           if (!stocksByProduct.has(dData.productId)) stocksByProduct.set(dData.productId, []);
           stocksByProduct.get(dData.productId)!.push({ docRef: d.ref, data: dData });
        }
        if (dData.sku) {
           if (!stocksBySku.has(dData.sku)) stocksBySku.set(dData.sku, []);
           stocksBySku.get(dData.sku)!.push({ docRef: d.ref, data: dData });
        }
      });
    });

    // 4. LOGIKA ALOKACJI (Iteracja na zapotrzebowaniu)
    let totalItemsTracked = 0;
    let completelyFilledLines = 0;
    let anyStockReserved = false;
    let newlyReservedCount = 0;

    const stockUpdatesBuffer = new Map<string, { docRef: FirebaseFirestore.DocumentReference, oldData: any, deltaReservedToBump: number }>();
    const movementLogsBuffer: any[] = [];
    const createdReservations: any[] = [];
    const itemUpdatesBuffer: Array<{ docRef: FirebaseFirestore.DocumentReference, qtyReserved: number }> = [];

    const now = FieldValue.serverTimestamp();

    for (const itemDoc of itemsDocs.docs) {
       totalItemsTracked++;
       const itemData = itemDoc.data();
       const neededInitially = itemData.qtyOrdered || itemData.quantity || 0; // fallback to quantity for safety
       const alreadyReserved = itemData.qtyReserved || 0;
       let deltaNeeded = neededInitially - alreadyReserved;

       if (deltaNeeded <= 0) {
          completelyFilledLines++;
          anyStockReserved = true; // Zawsze coś już ma
          continue; // W 100% zaspokojony wcześniej
       }

       const pid = itemData.productId;
       const sku = itemData.sku;
       const itemEan = itemData.ean;
       let possibleStockBuckets = stocksByProduct.get(pid) || [];
       console.log(`[DEBUG_RESERVE] itemId: ${itemDoc.id}, pid: ${pid}, sku: ${sku}, ean: ${itemEan}, deltaNeeded: ${deltaNeeded}`);
       console.log(`[DEBUG_RESERVE] buckets by pid: ${possibleStockBuckets.length}`);
       
       if (possibleStockBuckets.length === 0 && sku) {
          let fallbackBuckets = stocksBySku.get(sku) || stocksBySku.get(sku.replace(/ /g, '_')) || stocksBySku.get(sku.replace(/_/g, ' ')) || [];
          
          if (itemEan && fallbackBuckets.length > 0) {
             // Strict EAN Match: Odrzucamy zasoby, które należą do innego EAN-u (zabezpieczenie kradzieży)
             fallbackBuckets = fallbackBuckets.filter(b => b.data.ean === itemEan);
          }
          
          possibleStockBuckets = fallbackBuckets;
          console.log(`[DEBUG_RESERVE] buckets by sku: ${possibleStockBuckets.length}`);
       }
       
       let filledInThisSession = 0;

       // Przepływ wody po naczyniach łączonych (wielu lokacjach) dopóki jest zapotrzebowanie
       for (const bucket of possibleStockBuckets) {
          if (deltaNeeded <= 0) break; // Całkowicie alokowany wiersz

          const trackId = bucket.docRef.id;
          if (!stockUpdatesBuffer.has(trackId)) {
             stockUpdatesBuffer.set(trackId, { docRef: bucket.docRef, oldData: bucket.data, deltaReservedToBump: 0 });
          }
          const bufState = stockUpdatesBuffer.get(trackId)!;

          // Ile tej fizycznej "wody na tej szali" faktycznie pozostało? Uwzględniamy już wydrenowane bufory tej samej transakcji.
          const currentAvailableOnBucket = (bufState.oldData.qtyAvailable || 0) - bufState.deltaReservedToBump;
          console.log(`[DEBUG_RESERVE] bucket ${trackId}: qtyAvailable=${bufState.oldData.qtyAvailable}, bumped=${bufState.deltaReservedToBump}, currentAvailable=${currentAvailableOnBucket}`);
          
          if (currentAvailableOnBucket <= 0) continue; // Pusta studnia, leć na kolejną lokację

          const chunkToTake = Math.min(deltaNeeded, currentAvailableOnBucket);
          
          bufState.deltaReservedToBump += chunkToTake;
          filledInThisSession += chunkToTake;
          deltaNeeded -= chunkToTake;
          newlyReservedCount += chunkToTake;

          createdReservations.push({
             orgId: companyId, orderId, itemId: itemDoc.id, productId: pid,
             locationId: bucket.data.warehouseLocationId || 'DEFAULT',
             qtyReserved: chunkToTake, status: 'active',
             createdAt: now
          });

          movementLogsBuffer.push({
             productId: pid, locationId: bucket.data.warehouseLocationId || 'DEFAULT',
             quantity: chunkToTake,
             w1: bufState.oldData.qtyOnHand || 0, // Baza niezmienna
             w2BeforeBump: (bufState.oldData.qtyReserved || 0) + (bufState.deltaReservedToBump - chunkToTake),
             wAvailable: currentAvailableOnBucket
          });
       }

       const finalReservedForThisItem = alreadyReserved + filledInThisSession;
       if (finalReservedForThisItem > 0) anyStockReserved = true;
       if (finalReservedForThisItem >= neededInitially) completelyFilledLines++;

       // Odkładam edycję orderItemu do tablicy zapisu
       itemUpdatesBuffer.push({ docRef: itemDoc.ref, qtyReserved: finalReservedForThisItem });
    }

    // 5. ZAWIESZENIE TRANSAKCJI GDY ZABRAKŁO CZASU/AKCJI POMIMO WYWOŁANIA
    if (newlyReservedCount === 0) {
       // Nic nie dobiliśmy do stoku, ale może poprawmy sam status nagłówka jeśli był zły?
       const evaluatedStatus = (completelyFilledLines === totalItemsTracked) ? 'full' : (anyStockReserved ? 'partial' : 'awaiting_stock');
       if (orderData.reservationStatus !== evaluatedStatus || (anyStockReserved && !orderData.hasReservation)) {
         t.update(orderRef, { 
           reservationStatus: evaluatedStatus, 
           hasReservation: anyStockReserved,
           updatedAt: now 
         });
       }

       if (evaluatedStatus === 'awaiting_stock') {
           const actRef = db.collection(`companies/${companyId}/orderActivityLogs`).doc();
           t.set(actRef, {
               orderId, orgId: companyId,
               userId: operatorId || 'system',
               userName: operatorId === 'SYSTEM_AUTO_RESERVE' ? 'Automatyzacja' : 'System',
               action: 'ALLOCATION_FAILED',
               details: 'Próba automatycznej rezerwacji. Wynik: Brak wolnego fizycznie towaru (AWAITING_STOCK).',
               timestamp: now
           });
       }

       return { success: true, message: 'Wywołano przeliczenie, ale nie zarezerwowano nowych sztuk (brak stanów dost. dla braków).', newStatus: evaluatedStatus, addedQty: 0 };
    }

    // 6. EGZEKUTOR ZAPISÓW TRANSAKCYJNYCH (WRITES)
    
    // a) Nadaj nowe rezerwacje
    for (const r of createdReservations) {
       r.orderNumber = orderData.referenceNumber || orderData.orderNumber || orderData.externalId || orderId;
       t.set(db.collection(`companies/${companyId}/stockReservations`).doc(), r);
    }

    // b) Zaktualizuj kartoteki magazynu klienta (dostępność spada, tarcza rośnie, onHand const)
    for (const [, st] of stockUpdatesBuffer.entries()) {
       if (st.deltaReservedToBump <= 0) continue;
       const newReserved = (st.oldData.qtyReserved || 0) + st.deltaReservedToBump;
       const newAvailable = Math.max(0, (st.oldData.qtyOnHand || 0) - newReserved);
       t.update(st.docRef, { qtyReserved: newReserved, qtyAvailable: newAvailable, updatedAt: now });
    }

    // c) Księga ruchów LEDGER
    for (const m of movementLogsBuffer) {
       const movRef = db.collection(`companies/${companyId}/inventoryMovements`).doc();
       t.set(movRef, {
          orgId: companyId, productId: m.productId, locationId: m.locationId,
          type: 'RESERVE', movementType: 'RESERVE', // Flaga rezerwacji 
          quantity: m.quantity, quantityDelta: m.quantity,
          referenceType: 'order', referenceId: orderId, operatorId: operatorId,
          orderNumber: orderData.referenceNumber || orderData.orderNumber || orderData.externalId || orderId,
          before: { qtyOnHand: m.w1, qtyReserved: m.w2BeforeBump, qtyAvailable: m.wAvailable },
          after:  { qtyOnHand: m.w1, qtyReserved: m.w2BeforeBump + m.quantity, qtyAvailable: m.wAvailable - m.quantity },
          createdAt: now
       });
    }

    // d) Podbij stan zrealizowania dla linii zlecenia
    for (const iu of itemUpdatesBuffer) {
       t.update(iu.docRef, { qtyReserved: iu.qtyReserved });
    }

    // e) Kalkuluj główny status operacji
    const finalOrderStatus = (completelyFilledLines === totalItemsTracked) ? 'full' : (anyStockReserved ? 'partial' : 'awaiting_stock');

    t.update(orderRef, {
       reservationStatus: finalOrderStatus,
       hasReservation: finalOrderStatus === 'full' || finalOrderStatus === 'partial',
       reservedAt: now,
       'warehouseStatus.reservation': finalOrderStatus === 'full' ? 'FULL' : 'PARTIAL',
       updatedAt: now
       // Użytkownik chciał zatrzymania logiki, więc tu nie wypychamy w state statusu ogólnego "processing" chyba że to full, ale zatrzymajmy się na reservationStatus by the prompt.
    });

    const actRef = db.collection(`companies/${companyId}/orderActivityLogs`).doc();
    t.set(actRef, {
       orgId: companyId, orderId, action: 'RESERVATION_ALLOCATED', operatorId: operatorId,
       dataBefore: { reservationStatus: orderData.reservationStatus },
       dataAfter: { reservationStatus: finalOrderStatus, addedAllocations: newlyReservedCount },
       timestamp: now
    });

    return { 
      success: true, 
      addedQty: newlyReservedCount, 
      newStatus: finalOrderStatus 
    };

  });
};

export const allocateOrderReservations = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  const { companyId, orderId } = data;

  if (!companyId || !orderId) throw new HttpsError('invalid-argument', 'Brak parametrów zlecenia.');

  return await internalAllocateReservations(companyId, orderId, auth.uid);
});

// ==========================================
// NOWA ARCHITEKTURA (ELASTYCZNY FLOW: hasReservation, inFulfillment, hasLabel)
// ==========================================

export const retractReservation = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  const { companyId, orderId } = data;

  await db.runTransaction(async (t) => {
    const orderRef = db.collection(`companies/${companyId}/orders`).doc(orderId);
    const orderDoc = await t.get(orderRef);
    if (!orderDoc.exists) throw new HttpsError('not-found', 'Zamówienie nie istnieje.');
    const orderData = orderDoc.data()!;

    if (!orderData.hasReservation && orderData.reservationStatus !== 'full' && orderData.reservationStatus !== 'partial') {
      throw new HttpsError('failed-precondition', 'Brak aktywnej rezerwacji do cofnięcia.');
    }

    if (orderData.status === 'shipped' || orderData.status === 'completed') {
       throw new HttpsError('failed-precondition', 'Zamówienie jest zamknięte — nie można cofnąć rezerwacji.');
    }

    // Bezpieczne, uwzględniające Ledgera uwalnianie towarów na półki
    const releasedCount = await _internalReleaseReservations(t, companyId, orderId, auth.uid);

    t.update(orderRef, {
      hasReservation: false,
      reservedAt: null,
      'warehouseStatus.reservation': 'NONE',
      reservationStatus: 'released', // Zachowana kompatybilność ze starymi formatami
      updatedAt: FieldValue.serverTimestamp()
    });

    const actRef = db.collection(`companies/${companyId}/orderActivityLogs`).doc();
    t.set(actRef, {
      orgId: companyId, orderId, action: 'reservation_retracted', operatorId: auth.uid,
      dataAfter: { releasedCount },
      timestamp: FieldValue.serverTimestamp()
    });
  });

  return { success: true, message: 'Rezerwacja cofnięta bezpiecznie dla WMS' };
});


export const addReservationManually = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  const { companyId, orderId } = data;

  if (!companyId || !orderId) throw new HttpsError('invalid-argument', 'Brak parametrów zlecenia.');

  const res = await internalAllocateReservations(companyId, orderId, auth.uid);
  
  if (res.addedQty === 0 && res.newStatus !== 'full') {
      throw new HttpsError('failed-precondition', res.message || 'Brak wystarczających stanów magazynowych, aby utworzyć nową rezerwację.');
  }

  return { success: true, message: 'Rezerwacja przetworzona pomyślnie', newStatus: res.newStatus };
});


import { calculateCutOffDeadline, determinePriority } from '../fulfillment/sla';

export const sendToFulfillment = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  const { companyId, orderId } = data;

  const orderRef = db.collection(`companies/${companyId}/orders`).doc(orderId);
  const orderSnap = await orderRef.get();
  const order = orderSnap.data();

  if (!order) throw new HttpsError('not-found', 'Zamówienie nie istnieje');

  if (order.inFulfillment) throw new HttpsError('failed-precondition', 'Zamówienie już jest w kolejce pakowania');
  
  // Wymuszenie nowej logiki (choć z frontu mogą wysłać order.hasLabel)
  // UWAGA: Sprawdzamy hasLabel lub obecność trackingNumber by zachować bezpieczeństwo
  if (!order.hasLabel && !order.trackingNumber && !order.shipping?.trackingNumber) {
    throw new HttpsError('failed-precondition', 'Brak etykiety kurierskiej — najpierw wygeneruj etykietę');
  }

  if (!order.hasReservation && order.reservationStatus !== 'full') {
    throw new HttpsError('failed-precondition', 'Brak rezerwacji stanów');
  }

  const companySnap = await db.collection('companies').doc(companyId).get();
  const companyName = companySnap.exists ? (companySnap.data()?.name || 'Nieznana firma') : 'Nieznana firma';

  const orderItemsSnap = await db.collection(`companies/${companyId}/orderItems`).where('orderId', '==', orderId).get();
  
  const enrichedItems = await Promise.all(orderItemsSnap.docs.map(async (docSnap) => {
      const itemData = docSnap.data();
      let locName = 'Brak lokalizacji';
      // Fallback location namingu
      const stockSnap = await db.collection(`companies/${companyId}/inventoryStock`).where('productId', '==', itemData.productId).limit(1).get();
      if (!stockSnap.empty) {
         const locId = stockSnap.docs[0].data().warehouseLocationId;
         if (locId) {
             const lDoc = await db.collection(`companies/${companyId}/locations`).doc(locId).get();
             if (lDoc.exists) locName = lDoc.data()?.name || locId;
         }
      }

      return {
         productId: itemData.productId,
         productName: itemData.name,
         ean: itemData.ean || '',
         sku: itemData.sku || '',
         imageUrl: itemData.imageUrl || null,
         location: locName,
         quantity: itemData.qtyReserved || itemData.qtyOrdered || 1,
         scannedQuantity: 0
      };
  }));

  const fulfillmentDoc = {
      orderId: orderId,
      id: orderId,
      referenceNumber: order.orderNumber || order.externalOrderId || orderId,
      companyId: companyId,
      companyName: companyName,
      customerName: (order.recipient?.firstName ? `${order.recipient.firstName} ${order.recipient.lastName}` : order.buyer?.login) || 'Klient',
      customerCity: order.recipient?.address?.city || '',
      trackingNumber: order.trackingNumber || order.shipping?.trackingNumber || '',
      carrier: order.courierCode || order.shippingMethod || 'Kurier',
      status: 'awaiting',
      priority: order.priority || determinePriority(calculateCutOffDeadline(order.shippingMethod)),
      cutOffDeadline: calculateCutOffDeadline(order.shippingMethod),
      suggestedBox: null, // trigger will normally fill this, but since it's manual we can omit or add cartonization module again. For now null is ok (fallback in UI)
      items: enrichedItems,
      packingStationId: null,
      assignedToPackerId: null,
      lockedAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
  };

  const batch = db.batch();
  
  // Nadrzędna kolejka fulfillment (collectionGroup dla workera 3PL)
  const fulfillmentRef = db.collection(`companies/${companyId}/fulfillmentQueue`).doc(orderId);
  batch.set(fulfillmentRef, fulfillmentDoc);

  batch.update(orderRef, {
      status: 'in_fulfillment',
      inFulfillment: true,
      hasReservation: true,
      fulfillmentQueueId: orderId,
      fulfillmentStatus: 'awaiting',
      'warehouseStatus.fulfillment': 'IN_QUEUE',
      updatedAt: FieldValue.serverTimestamp()
  });

  const actRef = db.collection(`companies/${companyId}/orderActivityLogs`).doc();
  batch.set(actRef, {
      orgId: companyId, orderId, action: 'sent_to_fulfillment', operatorId: auth.uid,
      dataAfter: { fulfillmentQueueId: orderId },
      timestamp: FieldValue.serverTimestamp()
  });

  await batch.commit();

  return { success: true, fulfillmentQueueId: orderId };
});


export const retractFromFulfillment = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  const { companyId, orderId } = data;

  const orderRef = db.collection(`companies/${companyId}/orders`).doc(orderId);
  
  await db.runTransaction(async (t) => {
      const orderDoc = await t.get(orderRef);
      if (!orderDoc.exists) throw new HttpsError('not-found', 'Zamówienie nie istnieje');
      const order = orderDoc.data()!;

      if (!order.inFulfillment) {
          throw new HttpsError('failed-precondition', 'Zamówienie nie jest w kolejce pakowania');
      }
      
      const fulfillmentRef = db.collection(`companies/${companyId}/fulfillmentQueue`).doc(order.fulfillmentQueueId || orderId);
      const fulfillmentDoc = await t.get(fulfillmentRef);

      if (fulfillmentDoc.exists) {
          const status = fulfillmentDoc.data()?.status;
          if (status === 'packing') {
             throw new HttpsError('failed-precondition', 'Magazynier już rozpoczął pakowanie — nie można cofnąć');
          }
          if (status === 'packed' || status === 'shipped') {
             throw new HttpsError('failed-precondition', 'Zamówienie jest już spakowane — nie można cofnąć');
          }
          t.delete(fulfillmentRef);
      }

      t.update(orderRef, {
          status: order.hasLabel ? 'label_created' : 'processing',
          inFulfillment: false,
          fulfillmentQueueId: null,
          fulfillmentStatus: null,
          'warehouseStatus.fulfillment': 'PENDING',
          updatedAt: FieldValue.serverTimestamp()
      });

      const actRef = db.collection(`companies/${companyId}/orderActivityLogs`).doc();
      t.set(actRef, {
          orgId: companyId, orderId, action: 'retracted_from_fulfillment', operatorId: auth.uid,
          timestamp: FieldValue.serverTimestamp()
      });
  });

  return { success: true, message: 'Wyjęto bezpiecznie z kolejki pakowania' };
});

export const releaseReservationManually = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  const { reservationId, orderId, productId, companyId, reason } = data;
  
  if ((!reservationId && !orderId) || !productId || !companyId) {
    throw new HttpsError('invalid-argument', 'Brak wymaganych parametrów.');
  }

  await db.runTransaction(async (t) => {
    let resRef: FirebaseFirestore.DocumentReference;
    
    if (reservationId) {
       resRef = db.collection(`companies/${companyId}/stockReservations`).doc(reservationId);
    } else {
       const resQuery = await t.get(db.collection(`companies/${companyId}/stockReservations`)
          .where('orderId', '==', orderId)
          .where('productId', '==', productId)
          .where('status', '==', 'active')
          .limit(1));
       if (resQuery.empty) throw new HttpsError('not-found', 'Nie znaleziono aktywnej rezerwacji do zwolnienia.');
       resRef = resQuery.docs[0].ref;
    }

    const resDoc = await t.get(resRef);
    if (!resDoc.exists) throw new HttpsError('not-found', 'Nie znaleziono aktywnej rezerwacji.');
    
    const reservation = resDoc.data()!;
    if (reservation.status !== 'active') throw new HttpsError('failed-precondition', 'Zwolniono już tę rezerwację.');

    const qtyToRelease = reservation.qtyReserved || reservation.quantity || 0;

    // Uzyskaj dane stoku
    let stockRef: FirebaseFirestore.DocumentReference | null = null;
    let oldStockData: any = {};
    const stockQuery = await t.get(db.collection(`companies/${companyId}/inventoryStock`)
        .where('productId', '==', productId)
        .where('warehouseLocationId', '==', reservation.locationId || reservation.warehouseId || 'DEFAULT')
        .limit(1));
    
    if (!stockQuery.empty) {
        stockRef = stockQuery.docs[0].ref;
        oldStockData = stockQuery.docs[0].data();
    } else {
        const fallbackQuery = await t.get(db.collection(`companies/${companyId}/inventoryStock`).where('productId', '==', productId).limit(1));
        if (!fallbackQuery.empty) {
            stockRef = fallbackQuery.docs[0].ref;
            oldStockData = fallbackQuery.docs[0].data();
        }
    }

    t.update(resRef, {
      status: 'released',
      qtyReserved: 0,
      releasedAt: FieldValue.serverTimestamp(),
      releasedBy: auth.uid,
      releaseReason: reason || 'manual_release'
    });

    const now = FieldValue.serverTimestamp();
    
    if (stockRef !== null && qtyToRelease > 0) {
      const newReserved = Math.max(0, (oldStockData.qtyReserved || 0) - qtyToRelease);
      const newAvailable = Math.max(0, (oldStockData.qtyOnHand || 0) - newReserved);
      
      t.update(stockRef, {
        qtyReserved: newReserved,
        qtyAvailable: newAvailable,
        updatedAt: now
      });

      const movementRef = db.collection(`companies/${companyId}/inventoryMovements`).doc();
      t.set(movementRef, {
        orgId: companyId,
        productId: productId,
        locationId: reservation.locationId || reservation.warehouseId || 'DEFAULT',
        type: 'RESERVATION_RELEASE',
        movementType: 'RESERVATION_RELEASE',
        quantity: qtyToRelease,
        quantityDelta: -qtyToRelease,
        referenceType: 'order',
        referenceId: reservation.orderId,
        orderNumber: reservation.orderNumber || reservation.orderId,
        reason: reason || 'manual_release',
        operatorId: auth.uid,
        before: { qtyOnHand: oldStockData.qtyOnHand || 0, qtyReserved: oldStockData.qtyReserved || 0, qtyAvailable: oldStockData.qtyAvailable || 0 },
        after:  { qtyOnHand: oldStockData.qtyOnHand || 0, qtyReserved: newReserved, qtyAvailable: newAvailable },
        createdAt: now
      });
    }
  });
  
  return { success: true };
});
