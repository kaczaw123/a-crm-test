import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { assertCompanyAccess } from '../auth/companyAccess';
import { calculateProviderCost, applyMarkup } from './priceCalculator';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

export async function calculateInternalShipmentCost(params: {
  companyId: string;
  carrierId: string;
  destCountry: string;
  weight: number;
  serviceCode?: string;
  optionalServices?: string[];
  isB2B?: boolean;
}) {
  const { companyId, carrierId, destCountry, weight, serviceCode, optionalServices, isB2B } = params;

  // Auto-pick active contract for carrier
  const contractSnap = await db.collection('carrierContracts')
    .where('carrierId', '==', carrierId)
    .where('status', '==', 'active')
    .limit(1).get();
    
  if (contractSnap.empty) throw new Error('Brak aktywnego kontraktu');
  const contractId = contractSnap.docs[0].id;
  const contractData = contractSnap.docs[0].data();

  // Pobierz wszystkie cenniki dla tego kontraktu
  const priceListsSnap = await db
    .collection(`carrierContracts/${contractId}/priceLists`)
    .get();

  let chosenPriceList: any = null;
  let priceListId = '';

  // Priorytet 1: pricelist z individual entry dla destCountry
  for (const plDoc of priceListsSnap.docs) {
    const pl = plDoc.data();
    if (pl.prices?.some((p: any) => p.zoneCode === destCountry && p.serviceCode === (serviceCode || 'STANDARD'))) {
      chosenPriceList = pl;
      priceListId = plDoc.id;
      break;
    }
  }

  // Priorytet 2: ratecard fallback (pricePerKg defined)
  if (!chosenPriceList) {
    for (const plDoc of priceListsSnap.docs) {
      const pl = plDoc.data();
      if (pl.prices?.some((p: any) => p.pricePerKg != null && p.serviceCode === (serviceCode || 'STANDARD'))) {
        chosenPriceList = pl;
        priceListId = plDoc.id;
        break;
      }
    }
  }

  if (!chosenPriceList) {
    throw new Error(`Brak cennika obsługującego destynację ${destCountry}`);
  }

  const priceListData = chosenPriceList;

  const providerCost = await calculateProviderCost({
    contract: contractData as any,
    priceList: priceListData as any,
    carrierId,
    destCountry,
    weight,
    date: new Date(),
    serviceCode: serviceCode || 'STANDARD',
    optionalServices: optionalServices || [],
    isB2B
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
      priceToClient: {
        total: result.total,
        currency: result.currency,
        breakdown: result.breakdownWithMarkup.map(b => ({
           code: b.code,
           label: b.label,
           amount: b.clientAmount
        }))
      },
      metadata: {
        carrierId,
        contractId,
        priceListId,
        pricingSource: result.mode,
        atDate: new Date().toISOString()
      }
    };
  } catch (err: any) {
    if (err.message === 'absolute_table mode not implemented') {
      throw new Error('absolute_table mode not implemented');
    }
    throw err;
  }
}

export const estimateShipmentCost = onCall({ region: 'europe-west1' }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie');

  const { companyId, carrierId, destCountry, weight, serviceCode, optionalServices, isB2B } = data;
  if (!companyId || !carrierId || !destCountry || weight == null) {
    throw new HttpsError('invalid-argument', 'Missing required calculation parameters');
  }

  await assertCompanyAccess(auth.uid, companyId);

  try {
    const res = await calculateInternalShipmentCost({ companyId, carrierId, destCountry, weight, serviceCode, optionalServices, isB2B });
    return res;
  } catch (err: any) {
    throw new HttpsError('not-found', err.message);
  }
});
