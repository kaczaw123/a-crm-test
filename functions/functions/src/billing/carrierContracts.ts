import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
// Helper — sprawdza czy użytkownik jest superadminem (globalRole === 'superadmin')
export async function assertSuperadmin(uid: string) {
  // Sprawdź platformUsers najpierw
  const platformDoc = await db.collection('platformUsers').doc(uid).get();
  if (platformDoc.exists && platformDoc.data()?.role === 'SUPER_ADMIN') return;
  // Fallback dla legacy users
  const userDoc = await db.collection('users').doc(uid).get();
  if (userDoc.exists) {
    const d = userDoc.data() as any;
    if (d?.globalRole === 'superadmin' || d?.role === 'superadmin') return;
  }
  throw new HttpsError('permission-denied', 'Tylko SUPER ADMIN może zarządzać kontraktami kurierów.');
}
// ═══════════════════════════════════════════════════
// CARRIER CATALOG (master data)
// ═══════════════════════════════════════════════════
export const upsertCarrier = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  await assertSuperadmin(auth.uid);
  const { carrierId, code, displayName, country, apiIntegrationType, surchargeUrl, active } = data;
  if (!carrierId || !code || !displayName || !country) {
    throw new HttpsError('invalid-argument', 'Wymagane: carrierId, code, displayName, country');
  }
  
  // Walidacja — code alfanumeryczny + _ -
  if (!/^[a-zA-Z0-9_-]+$/.test(code) || code.length > 32) {
    throw new HttpsError('invalid-argument', 'Code musi być alfanumeryczny (max 32 znaki).');
  }
  const carrierRef = db.collection('carriers').doc(carrierId);
  await carrierRef.set({
    code,
    displayName,
    country,
    apiIntegrationType: apiIntegrationType || null,
    surchargeUrl: surchargeUrl || null,
    active: active !== false,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: auth.uid
  }, { merge: true });
  console.log(`[upsertCarrier] ${auth.uid} zapisał kuriera ${carrierId} (${code})`);
  return { success: true, carrierId };
});
export const listCarriers = onCall(async (request) => {
  const { auth } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  await assertSuperadmin(auth.uid);
  const snap = await db.collection('carriers').orderBy('displayName').get();
  return { carriers: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
});
// ═══════════════════════════════════════════════════
// CARRIER CONTRACTS
// ═══════════════════════════════════════════════════
export const deleteCarrier = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  await assertSuperadmin(auth.uid);
  const { carrierId } = data;
  if (!carrierId) throw new HttpsError('invalid-argument', 'Wymagane: carrierId');
  
  await db.collection('carriers').doc(carrierId).delete();
  console.log(`[deleteCarrier] ${auth.uid} usunął kuriera ${carrierId}`);
  return { success: true };
});

export const saveCarrierContract = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  await assertSuperadmin(auth.uid);
  const { contractId, carrierId, validFrom, validTo, contractFileUrl, notes, status, originCountry, injectionPoint, contractEntity, contractRef, ekp } = data;
  if (!carrierId || !validFrom) {
    throw new HttpsError('invalid-argument', 'Wymagane: carrierId, validFrom');
  }
  // Sprawdź że kurier istnieje
  const carrierSnap = await db.collection('carriers').doc(carrierId).get();
  if (!carrierSnap.exists) {
    throw new HttpsError('not-found', `Kurier ${carrierId} nie istnieje. Utwórz go najpierw przez upsertCarrier.`);
  }
  const validFromDate = new Date(validFrom);
  if (isNaN(validFromDate.getTime())) {
    throw new HttpsError('invalid-argument', 'validFrom musi być parsowalną datą ISO');
  }
  let validToDate: Date | null = null;
  if (validTo) {
    validToDate = new Date(validTo);
    if (isNaN(validToDate.getTime())) {
      throw new HttpsError('invalid-argument', 'validTo musi być parsowalną datą ISO');
    }
    if (validToDate <= validFromDate) {
      throw new HttpsError('invalid-argument', 'validTo musi być późniejsze niż validFrom');
    }
  }
  
  if (originCountry && !/^[A-Z]{2}$/.test(originCountry)) {
    throw new HttpsError('invalid-argument', 'originCountry musi być kodem ISO-2 (np. "DE")');
  }
  if (ekp && !/^[A-Za-z0-9_-]{1,32}$/.test(ekp)) {
    throw new HttpsError('invalid-argument', 'ekp ma niepoprawny format (alfanum + _ -, max 32)');
  }
  const finalContractId = contractId || db.collection('carrierContracts').doc().id;
  const contractDocRef = db.collection('carrierContracts').doc(finalContractId);
  const payload: any = {
    carrierId,
    validFrom: admin.firestore.Timestamp.fromDate(validFromDate),
    validTo: validToDate ? admin.firestore.Timestamp.fromDate(validToDate) : null,
    contractFileUrl: contractFileUrl || null,
    notes: notes || '',
    status: status || 'active',
    originCountry: originCountry || null,
    injectionPoint: injectionPoint || null,
    contractEntity: contractEntity || null,
    contractRef: contractRef || null,
    ekp: ekp || null,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: auth.uid
  };
  if (!contractId) {
    payload.createdAt = FieldValue.serverTimestamp();
    payload.createdBy = auth.uid;
    payload.version = 1;
  } else {
    // Inkrementuj wersję przy update
    const existing = await contractDocRef.get();
    if (existing.exists) {
      payload.version = (existing.data()?.version || 1) + 1;
    }
  }
  await contractDocRef.set(payload, { merge: true });
  console.log(`[saveCarrierContract] ${auth.uid} zapisał kontrakt ${finalContractId} (carrier: ${carrierId})`);
  return { success: true, contractId: finalContractId };
});
export const listCarrierContracts = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  await assertSuperadmin(auth.uid);
  let query: admin.firestore.Query = db.collection('carrierContracts');
  if (data?.carrierId) {
    query = query.where('carrierId', '==', data.carrierId);
  }
  if (data?.status) {
    query = query.where('status', '==', data.status);
  }
  const snap = await query.orderBy('validFrom', 'desc').limit(100).get();
  return { contracts: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
});
// ═══════════════════════════════════════════════════
// PRICE LISTS (subcollection of contract)
// ═══════════════════════════════════════════════════
export const saveCarrierPriceList = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  await assertSuperadmin(auth.uid);
  const { contractId, priceListId, validFrom, validTo, prices, services, name } = data;
  if (!contractId || !validFrom || !Array.isArray(prices)) {
    throw new HttpsError('invalid-argument', 'Wymagane: contractId, validFrom, prices[]');
  }
  // Sprawdź że kontrakt istnieje
  const contractSnap = await db.collection('carrierContracts').doc(contractId).get();
  if (!contractSnap.exists) {
    throw new HttpsError('not-found', `Kontrakt ${contractId} nie istnieje.`);
  }
  // Walidacja struktury prices
  for (const p of prices) {
    if (!p.zoneCode || typeof p.weightFrom !== 'number' || typeof p.weightTo !== 'number' 
        || typeof p.basePrice !== 'number' || !p.currency || !p.serviceCode) {
      throw new HttpsError('invalid-argument', 
        'Każdy element prices[] musi mieć: zoneCode, weightFrom, weightTo, basePrice, currency, serviceCode');
    }
    if (p.weightFrom < 0 || p.weightTo <= p.weightFrom) {
      throw new HttpsError('invalid-argument', 
        `Niepoprawny zakres wagi: ${p.weightFrom} - ${p.weightTo}`);
    }
    if (p.basePrice < 0) {
      throw new HttpsError('invalid-argument', `basePrice nie może być ujemny: ${p.basePrice}`);
    }
    if (p.pricePerKg !== undefined && p.pricePerKg !== null && p.pricePerKg < 0) {
      throw new HttpsError('invalid-argument', `pricePerKg nie może być ujemny: ${p.pricePerKg}`);
    }
  }
  const validFromDate = new Date(validFrom);
  let validToDate: Date | null = null;
  if (validTo) validToDate = new Date(validTo);
  const finalPriceListId = priceListId || db
    .collection('carrierContracts').doc(contractId)
    .collection('priceLists').doc().id;
  const priceListRef = db.collection('carrierContracts').doc(contractId)
    .collection('priceLists').doc(finalPriceListId);
  const payload: any = {
    validFrom: admin.firestore.Timestamp.fromDate(validFromDate),
    validTo: validToDate ? admin.firestore.Timestamp.fromDate(validToDate) : null,
    prices,
    services: services || [],
    name: name || null,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: auth.uid
  };
  if (!priceListId) {
    payload.createdAt = FieldValue.serverTimestamp();
    payload.createdBy = auth.uid;
    payload.version = 1;
  } else {
    const existing = await priceListRef.get();
    if (existing.exists) {
      payload.version = (existing.data()?.version || 1) + 1;
    }
  }
  await priceListRef.set(payload, { merge: true });
  console.log(`[saveCarrierPriceList] ${auth.uid} zapisał cennik ${finalPriceListId} dla kontraktu ${contractId}`);
  return { success: true, priceListId: finalPriceListId };
});
export const listPriceListsForContract = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  await assertSuperadmin(auth.uid);
  const { contractId } = data;
  if (!contractId) throw new HttpsError('invalid-argument', 'Wymagane: contractId');
  const snap = await db.collection('carrierContracts').doc(contractId)
    .collection('priceLists').orderBy('validFrom', 'desc').get();
  return { priceLists: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
});

export const deleteCarrierPriceList = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  await assertSuperadmin(auth.uid);
  const { contractId, priceListId } = data;
  if (!contractId || !priceListId) throw new HttpsError('invalid-argument', 'Wymagane: contractId, priceListId');
  
  await db.collection('carrierContracts').doc(contractId).collection('priceLists').doc(priceListId).delete();
  console.log(`[deleteCarrierPriceList] ${auth.uid} usunął cennik ${priceListId} z kontraktu ${contractId}`);
  return { success: true };
});
// ═══════════════════════════════════════════════════
// HELPER dla F2 (nie callable, internal use)
// ═══════════════════════════════════════════════════
/**
 * Zwraca aktywny kontrakt + jego aktywny cennik dla danego kuriera na podaną datę.
 * Używane przez F2 (cost snapshot) i F2.2 (real-time wycena).
 */
export async function getCarrierContractWithPriceList(
  carrierId: string, 
  atDate: Date
): Promise<{ contract: any; priceList: any } | null> {
  const ts = admin.firestore.Timestamp.fromDate(atDate);
  
  // Znajdź aktywny kontrakt
  const contractsSnap = await db.collection('carrierContracts')
    .where('carrierId', '==', carrierId)
    .where('status', '==', 'active')
    .where('validFrom', '<=', ts)
    .orderBy('validFrom', 'desc')
    .limit(5)
    .get();
  
  let contract: any = null;
  for (const doc of contractsSnap.docs) {
    const d = doc.data();
    if (!d.validTo || d.validTo.toMillis() > atDate.getTime()) {
      contract = { id: doc.id, ...d };
      break;
    }
  }
  if (!contract) return null;
  // Znajdź aktywny cennik
  const pricesSnap = await db.collection('carrierContracts').doc(contract.id)
    .collection('priceLists')
    .where('validFrom', '<=', ts)
    .orderBy('validFrom', 'desc')
    .limit(5)
    .get();
  
  let priceList: any = null;
  for (const doc of pricesSnap.docs) {
    const d = doc.data();
    if (!d.validTo || d.validTo.toMillis() > atDate.getTime()) {
      priceList = { id: doc.id, ...d };
      break;
    }
  }
  if (!priceList) return null;
  return { contract, priceList };
}
// Callable wrapper dla helpera (frontend admina będzie chciał test)
export const getActiveCarrierPricing = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  await assertSuperadmin(auth.uid);
  const { carrierId, atDate } = data;
  if (!carrierId) throw new HttpsError('invalid-argument', 'Wymagane: carrierId');
  const date = atDate ? new Date(atDate) : new Date();
  const result = await getCarrierContractWithPriceList(carrierId, date);
  return result || { contract: null, priceList: null };
});
