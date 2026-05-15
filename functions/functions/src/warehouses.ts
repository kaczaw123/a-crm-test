import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

async function verifySuperadmin(uid: string, db: admin.firestore.Firestore): Promise<boolean> {
  const callerDoc = await db.collection('platformUsers').doc(uid).get();
  if (callerDoc.exists) {
      const callerData = callerDoc.data();
      if (callerData?.role === 'SUPER_ADMIN') return true;
  } else {
      const legacyDoc = await db.collection('users').doc(uid).get();
      const legacyData = legacyDoc.data();
      if (legacyDoc.exists && (legacyData?.globalRole === 'superadmin' || legacyData?.role === 'superadmin' || legacyData?.globalRole === 'admin' || legacyData?.role === 'admin')) {
          return true;
      }
  }
  return false;
}

export const addWarehouse = onCall(async (request) => {
  const db = admin.firestore();
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  
  const isSuperadmin = await verifySuperadmin(request.auth.uid, db);
  if (!isSuperadmin) throw new HttpsError('permission-denied', 'Only Super Admin can manage global warehouses.');

  const data = request.data;
  if (!data.name || !data.code || !data.address?.country || !data.address?.city) {
    throw new HttpsError('invalid-argument', 'Name, Code, Country and City are required.');
  }

  const codeQuery = await db.collection('warehouses').where('code', '==', data.code).limit(1).get();
  if (!codeQuery.empty) {
    throw new HttpsError('already-exists', `Warehouse with code ${data.code} already exists.`);
  }

  const warehouseRef = db.collection('warehouses').doc();
  const now = Date.now();
  
  const payload = {
    ...data,
    isActive: data.isActive !== false, // default true
    isDefault: !!data.isDefault,
    createdAt: now,
    updatedAt: now,
    createdBy: request.auth.uid,
    updatedBy: request.auth.uid
  };

  await warehouseRef.set(payload);
  return { success: true, id: warehouseRef.id };
});

export const updateWarehouse = onCall(async (request) => {
  const db = admin.firestore();
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  
  const isSuperadmin = await verifySuperadmin(request.auth.uid, db);
  if (!isSuperadmin) throw new HttpsError('permission-denied', 'Only Super Admin can manage warehouses.');

  const { id, ...data } = request.data;
  if (!id) throw new HttpsError('invalid-argument', 'Warehouse ID is missing.');

  if (data.code) {
    const codeQuery = await db.collection('warehouses').where('code', '==', data.code).get();
    const isDuplicate = !codeQuery.empty && codeQuery.docs.some(doc => doc.id !== id);
    if (isDuplicate) throw new HttpsError('already-exists', `Code ${data.code} is taken by another warehouse.`);
  }

  await db.collection('warehouses').doc(id).update({
    ...data,
    updatedAt: Date.now(),
    updatedBy: request.auth.uid
  });

  return { success: true };
});

export const toggleWarehouseStatus = onCall(async (request) => {
  const db = admin.firestore();
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  
  const isSuperadmin = await verifySuperadmin(request.auth.uid, db);
  if (!isSuperadmin) throw new HttpsError('permission-denied', 'Only Super Admin can manage warehouses.');

  const { id, isActive } = request.data;
  if (!id) throw new HttpsError('invalid-argument', 'ID missing.');

  await db.collection('warehouses').doc(id).update({
    isActive: !!isActive,
    updatedAt: Date.now(),
    updatedBy: request.auth.uid
  });
  return { success: true };
});

export const assignWarehouseToCompany = onCall(async (request) => {
  const db = admin.firestore();
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  
  const isSuperadmin = await verifySuperadmin(request.auth.uid, db);
  if (!isSuperadmin) throw new HttpsError('permission-denied', 'Only Super Admin can manage warehouse assignments.');

  const { warehouseId, companyId, isDefaultForCompany, isActive } = request.data;
  if (!warehouseId || !companyId) throw new HttpsError('invalid-argument', 'warehouseId and companyId are required.');

  const warehouseRef = await db.collection('warehouses').doc(warehouseId).get();
  if (!warehouseRef.exists) throw new HttpsError('not-found', 'Warehouse does not exist.');

  const accessRef = db.collection(`companies/${companyId}/warehouseAccess`).doc(warehouseId);
  const existing = await accessRef.get();

  const payload = {
    warehouseId,
    companyId,
    isActive: isActive !== false,
    isDefaultForCompany: !!isDefaultForCompany,
    assignedAt: Date.now(),
    assignedBy: request.auth.uid
  };

  // If set to default, optionally unset others. We will do this via batch
  const batch = db.batch();
  
  if (payload.isDefaultForCompany) {
     const others = await db.collection(`companies/${companyId}/warehouseAccess`).where('isDefaultForCompany', '==', true).get();
     others.forEach(docSnap => {
        if (docSnap.id !== warehouseId) {
          batch.update(docSnap.ref, { isDefaultForCompany: false });
        }
     });
  }

  if (existing.exists) {
     // Prevent overwriting assignedAt
     const { assignedAt, assignedBy, ...updates } = payload;
     batch.update(accessRef, updates);
  } else {
     batch.set(accessRef, payload);
  }

  await batch.commit();

  return { success: true };
});

export const revokeWarehouseAccess = onCall(async (request) => {
  const db = admin.firestore();
  if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  
  const isSuperadmin = await verifySuperadmin(request.auth.uid, db);
  if (!isSuperadmin) throw new HttpsError('permission-denied', 'Only Super Admin can manage warehouse assignments.');

  const { warehouseId, companyId } = request.data;
  if (!warehouseId || !companyId) throw new HttpsError('invalid-argument', 'Missing parameters.');

  await db.collection(`companies/${companyId}/warehouseAccess`).doc(warehouseId).delete();
  return { success: true };
});
