import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { assertCompanyAccess } from '../auth/companyAccess';
import { calculateProviderCost, applyMarkup } from './priceCalculator';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export const saveClientPricing = onCall({ region: 'europe-west1' }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie');
  
  const { companyId, pricing } = data;
  if (!companyId || !pricing) throw new HttpsError('invalid-argument', 'Missing parameters');

  await assertCompanyAccess(auth.uid, companyId);

  const newVersion = (pricing.version || 0) + 1;
  const now = admin.firestore.Timestamp.now();

  const pricingRef = db.collection('companies').doc(companyId).collection('pricing');
  
  const activeSnapshot = await pricingRef.where('status', '==', 'active').get();
  const batch = db.batch();

  activeSnapshot.docs.forEach(doc => {
    batch.update(doc.ref, {
      status: 'archived',
      archivedAt: now,
      archivedBy: auth.uid
    });
  });

  const newDocRef = pricingRef.doc();
  const newPricing = {
    ...pricing,
    id: newDocRef.id,
    companyId,
    version: newVersion,
    status: 'active',
    createdAt: now,
    createdBy: auth.uid,
  };

  batch.set(newDocRef, newPricing);
  await batch.commit();

  return { success: true, id: newDocRef.id, version: newVersion };
});

export const getActiveClientPricing = onCall({ region: 'europe-west1' }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie');
  
  const { companyId } = data;
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId required');

  await assertCompanyAccess(auth.uid, companyId);

  const snap = await db.collection('companies').doc(companyId).collection('pricing')
    .where('status', '==', 'active')
    .limit(1)
    .get();

  let pricing = { found: false };
  if (!snap.empty) {
    pricing = { found: true, ...snap.docs[0].data() };
  }

  // Pobierz aktywne kontrakty kurierskie z poziomu Admin SDK, by pominąć blokady Firestore rules dla usera
  const contractsSnap = await db.collection('carrierContracts').where('status', '==', 'active').get();
  const contracts = [];
  
  for (const cDoc of contractsSnap.docs) {
    const cData = cDoc.data();
    const plSnap = await db.collection(`carrierContracts/${cDoc.id}/priceLists`).get();
    const priceLists = plSnap.docs.map(p => ({ id: p.id, ...p.data() }));
    contracts.push({ id: cDoc.id, ...cData, priceLists });
  }

  return { ...pricing, contracts };
});

export const listClientPricingVersions = onCall({ region: 'europe-west1' }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie');
  
  const { companyId } = data;
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId required');

  await assertCompanyAccess(auth.uid, companyId);

  const snap = await db.collection('companies').doc(companyId).collection('pricing')
    .orderBy('version', 'desc')
    .get();

  return snap.docs.map(d => d.data());
});

export const calculateClientPrice = onCall({ region: 'europe-west1' }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie');

  const { companyId, carrierId, contractId, priceListId, destCountry, weight, serviceCode, optionalServices } = data;
  if (!companyId || !carrierId || !destCountry || weight == null) {
    throw new HttpsError('invalid-argument', 'Missing required calculation parameters');
  }

  await assertCompanyAccess(auth.uid, companyId);

  const contractSnap = await db.collection('carrierContracts').doc(contractId).get();
  if (!contractSnap.exists) throw new HttpsError('not-found', 'Contract not found');
  
  const priceListSnap = await db.collection(`carrierContracts/${contractId}/priceLists`).doc(priceListId).get();
  if (!priceListSnap.exists) throw new HttpsError('not-found', 'Price list not found');

  const providerCost = await calculateProviderCost({
    contract: contractSnap.data() as any,
    priceList: priceListSnap.data() as any,
    carrierId,
    destCountry,
    weight,
    date: new Date(),
    serviceCode: serviceCode || 'STANDARD',
    optionalServices: optionalServices || []
  });

  const activeSnap = await db.collection('companies').doc(companyId).collection('pricing')
    .where('status', '==', 'active')
    .limit(1)
    .get();

  let carrierShipping = null;
  if (!activeSnap.empty) {
    const pricingData = activeSnap.docs[0].data();
    carrierShipping = pricingData.shippingPricing?.[carrierId] || null;
  }

  const priceListPricing = carrierShipping?.priceLists?.[priceListId] || null;
  const fallbackShipping = carrierShipping ? { mode: carrierShipping.mode, value: carrierShipping.value } : null;

  try {
    const result = applyMarkup(providerCost, priceListPricing, fallbackShipping);
    return {
      cost: providerCost,
      priceToClient: {
        total: result.total,
        markup: result.markup,
        mode: result.mode,
        currency: result.currency,
        breakdownWithMarkup: result.breakdownWithMarkup
      }
    };
  } catch (err: any) {
    if (err.message === 'absolute_table mode not implemented') {
      throw new HttpsError('unimplemented', 'absolute_table mode not implemented');
    }
    throw err;
  }
});
