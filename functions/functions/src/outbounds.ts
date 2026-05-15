import * as admin from "firebase-admin";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";

const getDb = () => admin.firestore();

// Helpers
const verifyAuth = (request: any) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be logged in");
  }
};

const verifyCompanyAccess = async (request: any, companyId: string) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Brak autoryzacji");

  const auth = request.auth || request.context?.auth;
  const userRole = String(auth?.token?.role || '').toLowerCase();
  if (userRole === 'superadmin' || userRole === 'super_admin') {
     return { role: 'superadmin' };
  }

  const db = getDb();
  const memberDoc = await db.collection(`companies/${companyId}/members`).doc(uid).get();
  if (!memberDoc.exists) {
    throw new HttpsError("permission-denied", "User does not have access to this company");
  }
  return memberDoc.data();
};

export const createOutboundShipment = onCall({ region: "us-central1" }, async (request) => {
  const db = getDb();
  verifyAuth(request);
  const { companyId, items, notes, issuedTo } = request.data;

  if (!companyId || !items || !Array.isArray(items) || items.length === 0) {
    throw new HttpsError("invalid-argument", "Missing required fields");
  }

  await verifyCompanyAccess(request, companyId);
  
  // Need to make sure stock is available for these items before creating draft?
  // We can just create draft and check availability during finalize.

  const batch = db.batch();
  
  const seqDocRef = db.collection(`companies/${companyId}/system`).doc('outboundSequence');
  let currentSeq = 1;
  
  try {
    await db.runTransaction(async (t) => {
        const seqDoc = await t.get(seqDocRef);
        if (seqDoc.exists) {
            currentSeq = (seqDoc.data()?.current || 0) + 1;
            t.update(seqDocRef, { current: currentSeq });
        } else {
            t.set(seqDocRef, { current: 1 });
        }
    });
  } catch(e) {
     console.error("Seq error: ", e);
  }

  const wzIndex = String(currentSeq).padStart(4, "0");
  const documentNumber = `WZ/${new Date().getFullYear()}/${wzIndex}`;

  const outboundRef = db.collection(`companies/${companyId}/outboundShipments`).doc();
  
  batch.set(outboundRef, {
    orgId: companyId,
    documentNumber,
    status: "draft",
    notes: notes || "",
    issuedTo: issuedTo || "",
    totalIssuedQty: items.reduce((acc, curr) => acc + (Number(curr.issuedQty) || 0), 0),
    itemsCount: items.length,
    createdBy: request.auth?.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  for (const item of items) {
    const itemRef = outboundRef.collection("items").doc();
    batch.set(itemRef, {
      productId: item.productId,
      sku: item.sku,
      ean: item.ean || "",
      name: item.name || "",
      issuedQty: Number(item.issuedQty) || 0,
    });
  }

  await batch.commit();

  return { success: true, outboundId: outboundRef.id, documentNumber };
});

export const submitOutboundShipment = onCall({ region: "us-central1" }, async (request) => {
  const db = getDb();
  verifyAuth(request);
  const { companyId, shipmentId } = request.data;
  
  if (!companyId || !shipmentId) {
    throw new HttpsError("invalid-argument", "Missing companyId or shipmentId");
  }
  
  await verifyCompanyAccess(request, companyId);

  const outboundRef = db.collection(`companies/${companyId}/outboundShipments`).doc(shipmentId);
  
  return db.runTransaction(async (transaction) => {
      const outboundDoc = await transaction.get(outboundRef);
      if (!outboundDoc.exists) {
        throw new HttpsError("not-found", "Outbound document not found");
      }
  
      const data = outboundDoc.data()!;
      if (data.status !== "draft") {
        throw new HttpsError("failed-precondition", "Only draft documents can be submitted");
      }

      transaction.update(outboundRef, {
          status: "pending",
          updatedAt: FieldValue.serverTimestamp()
      });
      
      return { success: true };
  });
});

export const finalizeOutboundShipment = onCall({ region: "us-central1" }, async (request) => {
  const db = getDb();
  verifyAuth(request);
  const { companyId, shipmentId } = request.data;
  
  if (!companyId || !shipmentId) {
    throw new HttpsError("invalid-argument", "Missing companyId or shipmentId");
  }
  
  const auth = request.auth || (request as any).context?.auth;
  if (!auth || !auth.token) {
      throw new HttpsError('unauthenticated', 'Brak autoryzacji JWT.');
  }

  const userRole = String(auth.token.role || '').toLowerCase();
  console.log(`[DEBUG] Użytkownik próbuje zatwierdzić WZ. Odczytana rola z tokena: '${userRole}'`);

  if (userRole !== 'superadmin' && userRole !== 'super_admin') {
      throw new HttpsError('permission-denied', 'Tylko Super Admin może ostatecznie wydać towar z magazynu.');
  }
  
  await verifyCompanyAccess(request, companyId);

  const outboundRef = db.collection(`companies/${companyId}/outboundShipments`).doc(shipmentId);
  const itemsRef = outboundRef.collection("items");

  return db.runTransaction(async (transaction) => {
    const outboundDoc = await transaction.get(outboundRef);
    if (!outboundDoc.exists) {
      throw new HttpsError("not-found", "Outbound document not found");
    }

    const data = outboundDoc.data()!;
    if (data.status !== "draft" && data.status !== "pending") {
      throw new HttpsError("failed-precondition", "Document is not in draft or pending status");
    }

    const itemsSnap = await transaction.get(itemsRef);
    if (itemsSnap.empty) {
      throw new HttpsError("failed-precondition", "Document has no items");
    }

    // PHASE 1: ALL READS
    const readOperations: any[] = [];
    
    for (const itemDoc of itemsSnap.docs) {
      const itemData = itemDoc.data();
      const productId = itemData.productId;
      const requestedQty = Number(itemData.issuedQty) || 0;
      
      if (requestedQty <= 0) continue;

      const productRef = db.collection(`companies/${companyId}/products`).doc(productId);
      const stockQuery = db.collection(`companies/${companyId}/inventoryStock`)
        .where("productId", "==", productId);
        
      readOperations.push({
        itemData,
        requestedQty,
        productRef,
        productPromise: transaction.get(productRef),
        stockPromise: transaction.get(stockQuery)
      });
    }

    // Await all reads
    for (const op of readOperations) {
      op.productSnap = await op.productPromise;
      op.stockSnap = await op.stockPromise;
      
      if (!op.productSnap.exists) {
        throw new HttpsError("not-found", `Product ${op.itemData.productId} not found`);
      }

      let totalAvailable = 0;
      let totalOnHand = 0;
      op.stockDocs = [];
      
      op.stockSnap.forEach((doc: any) => {
         const data = doc.data();
         totalAvailable += (Number(data.qtyAvailable) || 0);
         totalOnHand += (Number(data.qtyOnHand) || 0);
         op.stockDocs.push({ ref: doc.ref, data: data });
      });

      console.log(`[WZ Finalize] SKU: ${op.itemData.sku}, requested: ${op.requestedQty}, totalAvailable: ${totalAvailable}, totalOnHand: ${totalOnHand}`);

      if (totalAvailable < op.requestedQty || totalOnHand < op.requestedQty) {
         throw new HttpsError("failed-precondition", `Not enough stock for ${op.itemData.sku}`);
      }
    }

    // PHASE 2: ALL WRITES
    for (const op of readOperations) {
      let remainingToDeduct = op.requestedQty;
      
      for (const stock of op.stockDocs) {
         if (remainingToDeduct <= 0) break;
         
         const avail = Number(stock.data.qtyAvailable) || 0;
         if (avail <= 0) continue;
         
         const deductQty = Math.min(avail, remainingToDeduct);
         const unitWeight = Number(stock.data.unitWeightKg) || 0;
         const unitVolume = Number(stock.data.unitVolumeM3) || 0;
         const deductWeight = deductQty * unitWeight;
         const deductVolume = deductQty * unitVolume;
         
         transaction.update(stock.ref, {
            qtyOnHand: FieldValue.increment(-deductQty),
            qtyAvailable: FieldValue.increment(-deductQty),
            totalWeightKg: FieldValue.increment(-deductWeight),
            totalVolumeM3: FieldValue.increment(-deductVolume),
            updatedAt: FieldValue.serverTimestamp()
         });
         
         const movementRef = db.collection(`companies/${companyId}/inventoryMovements`).doc();
         transaction.set(movementRef, {
            orgId: companyId,
            productId: op.itemData.productId,
            warehouseLocationId: stock.data.warehouseLocationId || null,
            type: "ISSUE",
            quantity: deductQty,
            weightTotal: -deductWeight,
            volumeTotal: -deductVolume,
            onHandAfter: (Number(stock.data.qtyOnHand) || 0) - deductQty,
            reservedAfter: stock.data.qtyReserved || 0,
            availableAfter: (Number(stock.data.qtyAvailable) || 0) - deductQty,
            referenceType: "OUTBOUND_WZ",
            referenceId: shipmentId,
            note: `WZ: ${data.documentNumber}`,
            performedBy: request.auth?.uid,
            createdAt: FieldValue.serverTimestamp()
         });
         
         remainingToDeduct -= deductQty;
      }

      transaction.update(op.productRef, {
        onHandQty: FieldValue.increment(-op.requestedQty),
        availableQty: FieldValue.increment(-op.requestedQty)
      });
    }

    // Update status
    transaction.update(outboundRef, {
      status: "completed",
      updatedAt: FieldValue.serverTimestamp()
    });

    return { success: true };
  });
});

export const cancelOutboundShipment = onCall({ region: "us-central1" }, async (request) => {
    const db = getDb();
    verifyAuth(request);
    const { companyId, shipmentId } = request.data;
    
    if (!companyId || !shipmentId) {
      throw new HttpsError("invalid-argument", "Missing companyId or shipmentId");
    }
    
    await verifyCompanyAccess(request, companyId);
  
    const outboundRef = db.collection(`companies/${companyId}/outboundShipments`).doc(shipmentId);
    
    return db.runTransaction(async (transaction) => {
        const outboundDoc = await transaction.get(outboundRef);
        if (!outboundDoc.exists) {
          throw new HttpsError("not-found", "Outbound document not found");
        }
    
        const data = outboundDoc.data()!;
        if (data.status !== "draft") {
          throw new HttpsError("failed-precondition", "Cannot cancel document that is not in draft status");
        }

        transaction.update(outboundRef, {
            status: "canceled",
            updatedAt: FieldValue.serverTimestamp()
        });
        
        return { success: true };
    });
});
