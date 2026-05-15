import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// Funkcja służąca do przydzielania Zamówienia do Stanowiska i jego blokady
export const lockFulfillmentTask = onCall(async (request) => {
  const { data, auth } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

  const { companyId, taskId, stationId } = data;
  if (!companyId || !taskId || !stationId) {
    throw new HttpsError('invalid-argument', 'Missing parameters.');
  }

  const taskRef = db.doc(`companies/${companyId}/fulfillmentQueue/${taskId}`);

  try {
    await db.runTransaction(async (transaction) => {
      const taskDoc = await transaction.get(taskRef);
      if (!taskDoc.exists) {
        throw new HttpsError('not-found', 'Task not found in queue.');
      }

      const taskData = taskDoc.data();
      
      if (taskData?.lockedAt && taskData.lockedAt > Date.now() - (1000 * 60 * 15)) {
         // Jeżeli jest zablokowane i blokada trwa krócej niż 15 min, rzuć błąd chyba że ta sama stacja
         if (taskData.packingStationId !== stationId) {
            throw new HttpsError('already-exists', 'To zamówienie jest aktualnie realizowane przez inne stanowisko.');
         }
      }

      transaction.update(taskRef, {
        status: 'packing',
        packingStationId: stationId,
        assignedToPackerId: auth.uid,
        lockedAt: Date.now(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    return { success: true };
  } catch (err: any) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('internal', err.message);
  }
});

// Zakończenie pakowania i zwolnienie statusu
export const completeFulfillmentTask = onCall(async (request) => {
  const { data, auth } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

  const { companyId, taskId } = data;
  if (!companyId || !taskId) throw new HttpsError('invalid-argument', 'Missing parameters.');

  const taskRef = db.doc(`companies/${companyId}/fulfillmentQueue/${taskId}`);
  const orderRef = db.doc(`companies/${companyId}/orders/${taskId}`);

  try {
    await db.runTransaction(async (transaction) => {
      const taskDoc = await transaction.get(taskRef);
      if (!taskDoc.exists) throw new HttpsError('not-found', 'Task not found.');
      const taskData = taskDoc.data()!;

      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) throw new HttpsError('not-found', 'Order not found.');
      const orderData = orderDoc.data()!;

      const now = admin.firestore.FieldValue.serverTimestamp();

      const isShipped = orderData.status === 'shipped';
      let resDocs: admin.firestore.QuerySnapshot | null = null;
      let pairs: { resDoc: admin.firestore.QueryDocumentSnapshot; stockDoc: admin.firestore.QueryDocumentSnapshot | null }[] = [];
      let itemsDocs: admin.firestore.QuerySnapshot | null = null;

      if (!isShipped) {
          const resDocsQuery = db.collection(`companies/${companyId}/stockReservations`).where('orderId', '==', taskId).where('status', '==', 'active');
          resDocs = await transaction.get(resDocsQuery);
          
          const stockPromises = resDocs.docs.map(async r => {
              const rd = r.data();
              const sRef = db.collection(`companies/${companyId}/inventoryStock`)
                  .where('productId', '==', rd.productId)
                  .where('warehouseLocationId', '==', rd.locationId);
              const sDocs = await transaction.get(sRef);
              return { resDoc: r, stockDoc: sDocs.empty ? null : sDocs.docs[0] };
          });
          pairs = await Promise.all(stockPromises);

          const itemsDocsQuery = db.collection(`companies/${companyId}/orderItems`).where('orderId', '==', taskId);
          itemsDocs = await transaction.get(itemsDocsQuery);
      }

      // ==== ALL READS COMPLETE ==== //
      // ==== BEGIN WRITES        ==== //

      transaction.update(taskRef, {
        status: 'packed',
        lockedAt: null, 
        updatedAt: now
      });

      if (isShipped) {
         console.warn(`[PACKING] completeFulfillmentTask: Order ${taskId} is ALREADY shipped! Early returning. NO activity log will be created.`);
         transaction.update(orderRef, { packedAt: now });
         return;
      }

      const stockUpdates = new Map<string, any>();

      for (const p of pairs) {
          if (!p.stockDoc) continue;
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

          const finalOnHand = Math.max(0, w1 - delta);
          const finalReserved = Math.max(0, w2 - delta);
          
          transaction.update(s.docRef, { qtyOnHand: finalOnHand, qtyReserved: finalReserved, updatedAt: now });

          for (const res of s.itemsLog) {
              const movRef = db.collection(`companies/${companyId}/inventoryMovements`).doc();
              transaction.set(movRef, {
                  orgId: companyId,
                  productId: res.productId,
                  locationId: res.locationId,
                  type: 'SHIPMENT_CONFIRM',
                  movementType: 'SHIPMENT_CONFIRM',
                  quantity: res.qtyReserved,
                  quantityDelta: -res.qtyReserved, 
                  referenceType: 'order', referenceId: taskId, operatorId: auth.uid,
                  before: { qtyOnHand: w1, qtyReserved: w2, qtyAvailable: s.data.qtyAvailable || 0 },
                  after: { qtyOnHand: finalOnHand, qtyReserved: finalReserved, qtyAvailable: s.data.qtyAvailable || 0 },
                  createdAt: now
              });
          }
      }

      if (resDocs) {
          resDocs.docs.forEach(d => transaction.update(d.ref, { status: 'shipped' }));
      }

      transaction.update(orderRef, {
          status: 'shipped',
          reservationStatus: 'none',
          shippingStatus: 'shipped',
          shipmentStatus: 'confirmed',
          packedAt: now,
          updatedAt: now
      });

      console.log(`[PACKING] completeFulfillmentTask: Writing orderActivityLogs for taskId=${taskId}...`);
      const activityRef = db.collection(`companies/${companyId}/orderActivityLogs`).doc();
      transaction.set(activityRef, {
          orgId: companyId,
          orderId: taskId,
          action: 'packing_completed',
          description: 'Zamówienie spakowane i przekazane do kuriera',
          operatorId: auth.uid,
          packedByEmail: auth.token?.email || null,
          packingStationId: taskData?.packingStationId || null,
          trackingNumber: orderData.trackingNumber || null,
          carrier: orderData.carrier || 'DHL_DE',
          itemsCount: taskData?.items?.length || 0,
          timestamp: now
      });

      if (itemsDocs) {
          itemsDocs.docs.forEach((item: any) => {
              const old = item.data();
              transaction.update(item.ref, { 
                  qtyShipped: old.qtyReserved || 0,
                  qtyReserved: 0
              });
          });
      }
    });

    return { success: true };
  } catch (err: any) {
    throw new HttpsError('internal', err.message);
  }
});
