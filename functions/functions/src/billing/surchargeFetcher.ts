import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { scrapeDhlDeSurcharges } from './scrapers/dhlDeScraper';

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

import { assertSuperadmin } from './carrierContracts';

export const scheduledFetchSurcharges = onSchedule({
  schedule: '0 6 * * *',
  timeZone: 'Europe/Warsaw',
  region: 'europe-west1'
}, async (event) => {
  await executeFetchForAllCarriers();
});

export const fetchSurchargesNow = onCall({ region: 'europe-west1' }, async (request) => {
  const { data, auth } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie');
  await assertSuperadmin(auth.uid);

  const { carrierId } = data;
  if (carrierId) {
    await executeFetchForCarrier(carrierId);
  } else {
    await executeFetchForAllCarriers();
  }

  return { success: true };
});

async function executeFetchForAllCarriers() {
  const carriersSnap = await db.collection('carriers').where('active', '==', true).get();
  for (const doc of carriersSnap.docs) {
    const carrier = doc.data();
    if (carrier.surchargeUrl) {
      await executeFetchForCarrier(doc.id, carrier.surchargeUrl);
    }
  }
}

async function executeFetchForCarrier(carrierId: string, providedUrl?: string) {
  let url = providedUrl;
  if (!url) {
    const carrierDoc = await db.collection('carriers').doc(carrierId).get();
    url = carrierDoc.data()?.surchargeUrl;
  }
  if (!url) return;

  let results: Array<{ month: string, energyPercent: number | null, fuelPercent: number | null }> = [];
  if (carrierId.includes('dhl_de') || carrierId.includes('dhl') || url.includes('dhl.de')) {
    results = await scrapeDhlDeSurcharges(url);
  }

  for (const res of results) {
    if (res.energyPercent === null && res.fuelPercent === null) continue;

    // Sanity check
    if (res.energyPercent != null && (res.energyPercent < 0 || res.energyPercent > 30)) {
      console.warn('[SCRAPER_ANOMALY] energyPercent out of range', { carrierId, month: res.month, value: res.energyPercent });
      continue;
    }
    if (res.fuelPercent != null && (res.fuelPercent < 0 || res.fuelPercent > 50)) {
      console.warn('[SCRAPER_ANOMALY] fuelPercent out of range', { carrierId, month: res.month, value: res.fuelPercent });
      continue;
    }

    const surchargeRef = db.collection(`carriers/${carrierId}/surcharges`).doc(res.month);
    const docSnap = await surchargeRef.get();

    const [yyyy, mm] = res.month.split('-').map(Number);
    const effFrom = admin.firestore.Timestamp.fromDate(new Date(Date.UTC(yyyy, mm - 1, 1)));
    const effTo = admin.firestore.Timestamp.fromDate(new Date(Date.UTC(yyyy, mm, 0, 23, 59, 59)));

    if (docSnap.exists) {
      const existing = docSnap.data();
      if (existing?.source === 'manual') {
        continue; // immune, do not alert
      }

      // Check for alert if auto changed
      const oldEnergy = existing?.energySurchargePercent ?? null;
      const oldFuel = existing?.fuelSurchargePercent ?? null;

      const deltaEnergy = oldEnergy !== null && res.energyPercent !== null ? Math.abs(res.energyPercent - oldEnergy) : 0;
      const deltaFuel = oldFuel !== null && res.fuelPercent !== null ? Math.abs(res.fuelPercent - oldFuel) : 0;

      if (deltaEnergy > 2.0 || deltaFuel > 2.0) {
        await db.collection('surchargeAlerts').add({
          carrierId,
          effectiveMonth: res.month,
          oldEnergySurchargePercent: oldEnergy,
          newEnergySurchargePercent: res.energyPercent,
          oldFuelSurchargePercent: oldFuel,
          newFuelSurchargePercent: res.fuelPercent,
          deltaEnergyPp: deltaEnergy > 2.0 ? deltaEnergy : null,
          deltaFuelPp: deltaFuel > 2.0 ? deltaFuel : null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          acknowledged: false
        });
        console.warn(`[ALERT] Surcharge changed by >2pp for ${carrierId} in ${res.month}`);
      }

      await surchargeRef.set({
        energySurchargePercent: res.energyPercent,
        fuelSurchargePercent: res.fuelPercent,
        applyMode: existing?.applyMode || 'percent_of_base',
        source: 'auto',
        sourceUrl: url,
        fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
        effectiveFrom: effFrom,
        effectiveTo: effTo
      }, { merge: true });
    } else {
      await surchargeRef.set({
        id: res.month,
        effectiveMonth: res.month,
        energySurchargePercent: res.energyPercent,
        fuelSurchargePercent: res.fuelPercent,
        applyMode: 'percent_of_base',
        source: 'auto',
        sourceUrl: url,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
        effectiveFrom: effFrom,
        effectiveTo: effTo
      });
    }
  }
}

export const setSurchargeManualOverride = onCall({ region: 'europe-west1' }, async (request) => {
  const { data, auth } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie');
  await assertSuperadmin(auth.uid);
  
  const { carrierId, effectiveMonth, energySurchargePercent, fuelSurchargePercent, applyMode, manualNote } = data;
  
  const [yyyy, mm] = effectiveMonth.split('-').map(Number);
  const effFrom = admin.firestore.Timestamp.fromDate(new Date(Date.UTC(yyyy, mm - 1, 1)));
  const effTo = admin.firestore.Timestamp.fromDate(new Date(Date.UTC(yyyy, mm, 0, 23, 59, 59)));

  await db.collection(`carriers/${carrierId}/surcharges`).doc(effectiveMonth).set({
    id: effectiveMonth,
    effectiveMonth,
    energySurchargePercent,
    fuelSurchargePercent,
    applyMode,
    source: 'manual',
    manualNote: manualNote || '',
    manualOverrideBy: auth!.uid,
    manualOverrideAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    effectiveFrom: effFrom,
    effectiveTo: effTo
  }, { merge: true });

  return { success: true };
});

export const clearSurchargeManualOverride = onCall({ region: 'europe-west1' }, async (request) => {
  const { data, auth } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie');
  await assertSuperadmin(auth.uid);
  
  const { carrierId, effectiveMonth } = data;
  await db.collection(`carriers/${carrierId}/surcharges`).doc(effectiveMonth).delete();
  
  return { success: true };
});

export const getCurrentSurcharges = onCall({ region: 'europe-west1' }, async (request) => {
  const { carrierId, atDate } = request.data;
  return await getSurchargesForCalculation(carrierId, atDate ? new Date(atDate) : new Date());
});

export async function getSurchargesForCalculation(
  carrierId: string,
  atDate: Date
): Promise<{
  energySurchargePercent: number;
  fuelSurchargePercent: number;
  applyMode: string;
  source: 'auto' | 'manual' | 'missing';
}> {
  const yyyy = atDate.getFullYear();
  const mm = String(atDate.getMonth() + 1).padStart(2, '0');
  const monthStr = `${yyyy}-${mm}`;

  const docSnap = await db.collection(`carriers/${carrierId}/surcharges`).doc(monthStr).get();
  if (!docSnap.exists) {
    return {
      energySurchargePercent: 0,
      fuelSurchargePercent: 0,
      applyMode: 'percent_of_base',
      source: 'missing'
    };
  }

  const data = docSnap.data()!;
  return {
    energySurchargePercent: data.energySurchargePercent || 0,
    fuelSurchargePercent: data.fuelSurchargePercent || 0,
    applyMode: data.applyMode || 'percent_of_base',
    source: data.source as any
  };
}

export const listSurcharges = onCall({ region: 'europe-west1' }, async (request) => {
  const { carrierId, limit = 24 } = request.data;
  if (!request.auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie');
  await assertSuperadmin(request.auth.uid);
  
  const snap = await db.collection(`carriers/${carrierId}/surcharges`)
    .orderBy('effectiveMonth', 'desc')
    .limit(limit)
    .get();

  const alertsSnap = await db.collection('surchargeAlerts')
    .where('carrierId', '==', carrierId)
    .where('acknowledged', '==', false)
    .get();
    
  const alertsByMonth = new Set(alertsSnap.docs.map(d => d.data().effectiveMonth));

  return {
    surcharges: snap.docs.map(d => ({
      ...d.data(),
      hasAlert: alertsByMonth.has(d.data().effectiveMonth)
    }))
  };
});

export const acknowledgeSurchargeAlert = onCall({ region: 'europe-west1' }, async (request) => {
  const { alertId } = request.data;
  if (!request.auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie');
  await assertSuperadmin(request.auth.uid);
  
  await db.collection('surchargeAlerts').doc(alertId).update({
    acknowledged: true,
    acknowledgedBy: request.auth!.uid,
    acknowledgedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { success: true };
});

// Cloud Run requires roles/run.invoker = allUsers for getCurrentSurcharges
