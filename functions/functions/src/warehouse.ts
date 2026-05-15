import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';

export const onWorkspaceStockWritten = onDocumentWritten('companies/{companyId}/inventoryStock/{stockId}', async (event) => {
  const { companyId } = event.params;
  const before = event.data?.before;
  const after = event.data?.after;

  const beforeData = before?.exists ? before.data() : null;
  const afterData = after?.exists ? after.data() : null;

  // Determine actual changes with fallbacks for legacy data
  const prevOnHand = beforeData?.qtyOnHand ?? beforeData?.onHand ?? 0;
  const newOnHand = afterData?.qtyOnHand ?? afterData?.onHand ?? 0;
  
  const prevReserved = beforeData?.qtyReserved ?? beforeData?.reserved ?? 0;
  const newReserved = afterData?.qtyReserved ?? afterData?.reserved ?? 0;

  const prevAvailable = beforeData?.qtyAvailable ?? beforeData?.available ?? 0;
  const newAvailable = afterData?.qtyAvailable ?? afterData?.available ?? 0;

  const prevWeight = beforeData?.totalWeightKg ?? beforeData?.totalWeight ?? 0;
  const newWeight = afterData?.totalWeightKg ?? afterData?.totalWeight ?? 0;

  const prevVolume = beforeData?.totalVolumeM3 ?? beforeData?.totalVolume ?? 0;
  const newVolume = afterData?.totalVolumeM3 ?? afterData?.totalVolume ?? 0;

  const deltaOnHand = newOnHand - prevOnHand;
  const deltaReserved = newReserved - prevReserved;
  const deltaAvailable = newAvailable - prevAvailable;
  const deltaWeight = newWeight - prevWeight;
  const deltaVolume = newVolume - prevVolume;

  let deltaSkuCount = 0;
  if (!beforeData && afterData) deltaSkuCount = 1;
  else if (beforeData && !afterData) deltaSkuCount = -1;

  // If no metric changed, skip
  if (
    deltaOnHand === 0 &&
    deltaReserved === 0 &&
    deltaAvailable === 0 &&
    deltaWeight === 0 &&
    deltaVolume === 0 &&
    deltaSkuCount === 0
  ) {
    return;
  }

  const db = (after || before)?.ref.firestore;
  if (!db) return;

  const companyRef = db.collection('companies').doc(companyId);

  await companyRef.set({
    warehouseStats: {
      totalQtyOnHand: FieldValue.increment(deltaOnHand),
      totalQtyReserved: FieldValue.increment(deltaReserved),
      totalQtyAvailable: FieldValue.increment(deltaAvailable),
      totalWeightKg: FieldValue.increment(deltaWeight),
      totalVolumeM3: FieldValue.increment(deltaVolume),
      totalSkuCount: FieldValue.increment(deltaSkuCount),
      updatedAt: FieldValue.serverTimestamp()
    }
  }, { merge: true });
});

// Skrypt Backfill do wymuszania weryfikacji i naniesienia nowej struktury bez frontendowych przerw
export const backfillWarehouseStats = onCall(async (request) => {
  console.log('[STEP] START');
  const db = admin.firestore();
  
  try {
    const { auth } = request;
    if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

    console.log('[STEP] AUTH OK', auth.uid);

    const userDoc = await db.collection('users').doc(auth.uid).get();
    const userData = userDoc.data() || {};
    if (userData.globalRole !== 'superadmin' && userData.role !== 'superadmin') {
       throw new HttpsError('permission-denied', 'Tylko superadmin.');
    }

    // 1 & 5. Mutex Lock (Blokada równoległa)
    const lockRef = db.collection('system').doc('backfillLock');
    const logRef = db.collection('systemLogs').doc();
    
    await db.runTransaction(async (t) => {
       const lockSnap = await t.get(lockRef);
       if (lockSnap.exists && lockSnap.data()?.isRunning) {
          throw new HttpsError('aborted', 'Inny backfill jest w trakcie wykonywania.');
       }
       t.set(lockRef, { isRunning: true, startedAt: FieldValue.serverTimestamp(), initiator: auth.uid });
    });

    // 4. Log Postępu
    const counters = { scanned: 0, updated: 0, skipped: 0, errors: 0 };
    await logRef.set({
       status: 'RUNNING',
       startedAt: FieldValue.serverTimestamp(),
       initiator: auth.uid,
       counters
    });

    console.log('[STEP] FETCH COMPANIES');
    const companiesSnap = await db.collection('companies').get();
    
    for (const compDoc of companiesSnap.docs) {
      const companyId = compDoc.id;
      console.log(`[STEP] FETCH INVENTORY: ${companyId}`);
      const companyData = compDoc.data();
      const companyNip = companyData.taxId || companyData.nip || '';

      let sumQtyOnHand = 0;
      let sumQtyReserved = 0;
      let sumQtyAvailable = 0;
      let sumWeightKg = 0;
      let sumVolumeM3 = 0;
      let totalCompanyStockCount = 0;

      // 3. Odczyt porcjowany po stronie backendu (QueryCursors) aby zabezpieczyć OOM przy 100k
      const stockColl = db.collection(`companies/${companyId}/inventoryStock`);
      let lastDocSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      let hasMore = true;

      while (hasMore) {
         let baseQuery = stockColl.orderBy(admin.firestore.FieldPath.documentId()).limit(1000);
         if (lastDocSnap) {
            baseQuery = baseQuery.startAfter(lastDocSnap);
         }
         
         const chunk = await baseQuery.get();
         if (chunk.empty) {
            hasMore = false;
            break;
         }
         
         totalCompanyStockCount += chunk.size;
         lastDocSnap = chunk.docs[chunk.docs.length - 1];
         
         let currentBatch = db.batch();
         let opCount = 0;

         for (const stockDoc of chunk.docs) {
           counters.scanned++;
           try {
             const s = stockDoc.data();
             
             const qtyOnHand = s.qtyOnHand ?? s.onHand ?? 0;
             const qtyReserved = s.qtyReserved ?? s.reserved ?? 0;
             const qtyAvailable = s.qtyAvailable ?? s.available ?? (qtyOnHand - qtyReserved);
             const totalWeightKg = s.totalWeightKg ?? s.totalWeight ?? 0;
             const totalVolumeM3 = s.totalVolumeM3 ?? s.totalVolume ?? 0;
             const cName = s.companyName || companyData.name || 'Nieznana Firma';

             sumQtyOnHand += qtyOnHand;
             sumQtyReserved += qtyReserved;
             sumQtyAvailable += qtyAvailable;
             sumWeightKg += totalWeightKg;
             sumVolumeM3 += totalVolumeM3;

             // Logika pomijania (jeśli dokument posiadał nowe nazwy i nie miał starych)
             if (
               s.qtyOnHand !== undefined && s.onHand === undefined && 
               s.totalVolumeM3 !== undefined && s.totalVolume === undefined &&
               s.companyNip === companyNip && s.companyName === cName
             ) {
                counters.skipped++;
                continue;
             }

             const updatePayload = {
               companyNip,
               companyName: cName,
               qtyOnHand,
               qtyReserved,
               qtyAvailable,
               totalWeightKg,
               totalVolumeM3,
               updatedAt: FieldValue.serverTimestamp()
             };
             
             currentBatch.update(stockDoc.ref, updatePayload);
             opCount++;
             counters.updated++;
             
             if (opCount >= 400) {
                await currentBatch.commit();
                currentBatch = db.batch();
                opCount = 0;
             }
             } catch(err) {
                counters.errors++;
                console.error(`Błąd stockDoc ${stockDoc.id}:`, err);
             }
           }
           
           console.log(`[STEP] PROCESS BATCH dla ${companyId}, opCount: ${opCount}`);
           if (opCount > 0) {
              await currentBatch.commit();
           }
        }
  
        console.log(`[STEP] WRITE STATS dla ${companyId}`);
        await compDoc.ref.set({
          warehouseStats: {
          totalQtyOnHand: sumQtyOnHand,
          totalQtyReserved: sumQtyReserved,
          totalQtyAvailable: sumQtyAvailable,
          totalWeightKg: sumWeightKg,
          totalVolumeM3: sumVolumeM3,
          totalSkuCount: totalCompanyStockCount,
          updatedAt: FieldValue.serverTimestamp()
        }
      }, { merge: true });
      
      // Bieżąca aktualizacja logu progresu z mniejszą częstotliwością by nie nadużyć odczytów
      await logRef.update({ counters });
    }
    
    // Zakończenie sukcesem
    await logRef.update({ status: 'DONE', endedAt: FieldValue.serverTimestamp(), counters });
    await lockRef.update({ isRunning: false });

    return { success: true, logId: logRef.id, counters };

  } catch (error: any) {
    console.error("=== BACKFILL UNHANDLED ERROR ===", error);
    
    try {
      if (error.code !== 'aborted') {
         await db.collection('system').doc('backfillLock').update({ isRunning: false });
         // Rejestruj błąd na najnowszym logu jeżeli fail
         const lastLogs = await db.collection('systemLogs').orderBy('startedAt', 'desc').limit(1).get();
         if (!lastLogs.empty) {
            await lastLogs.docs[0].ref.update({ status: 'FAILED', errorMsg: error.message });
         }
      }
    } catch(e) {}

    throw new HttpsError('internal', `Wewnętrzny błąd Backfill: ${error.message}`, error.stack);
  }
});

// WMS Logistics Correction (wymiary / waga na poziomie Globalnego SKU)
export const correctStockDimensions = onCall(async (request) => {
  const db = admin.firestore();
  try {
    const { auth } = request;
    if (!auth) throw new HttpsError('unauthenticated', 'Brak autoryzacji.');

    const token = auth.token as any;
    // Autoryzacja Zero-Trust na poziomie Custom Claims (Bez czytania bazy dokument po dokumencie)
    const roleString = (token.role || '').toLowerCase();
    const globalRoleString = (token.globalRole || '').toLowerCase();
    let isSuperadmin = roleString === 'superadmin' || roleString === 'super_admin' || globalRoleString === 'superadmin';

    // R E S C U E   F A L L B A C K (Dla starych kont uaktualnianych recznie w Firestore gdzie Auth JWT nie odświeża Claimsów)
    if (!isSuperadmin) {
       const userDoc = await db.collection('users').doc(auth.uid).get();
       const userData = userDoc.data() || {};
       const fallbackRole = (userData.globalRole || userData.role || '').toLowerCase();
       if (fallbackRole === 'superadmin' || fallbackRole === 'super_admin') {
          isSuperadmin = true;
       }
    }
    
    // Weryfikacja wejscia
    const data = request.data;
    const { companyId, stockId, weightKg, lengthCm, widthCm, heightCm } = data;

    // Musi być superadmin lub zarządca tej firmy. Obecnie ustalamy dostęp tylko dla superadmina/osoby o uprawnieniach z firmą.
    const hasCurrentCompanyAccess = token.companyId === companyId || (token.companies && token.companies.includes(companyId));
    if (!isSuperadmin && !hasCurrentCompanyAccess) {
       throw new HttpsError('permission-denied', 'Brak autoryzacji do korekty dla tego Klienta.');
    }

    if (!companyId || !stockId || typeof weightKg !== 'number' || typeof lengthCm !== 'number' || typeof widthCm !== 'number' || typeof heightCm !== 'number') {
      throw new HttpsError('invalid-argument', 'Brak wagi, wymiarów lub nieprawidłowe identyfikatory.');
    }

    const stockRef = db.collection(`companies/${companyId}/inventoryStock`).doc(stockId);

    await db.runTransaction(async (t) => {
      const stockSnap = await t.get(stockRef);
      if (!stockSnap.exists) {
        throw new HttpsError('not-found', 'Zapas (Stock ID) nie istnieje.');
      }
      const s = stockSnap.data()!;

      const beforeDimensions = {
        weightPerUnit: s.weightPerUnit || 0,
        lengthPerUnit: s.lengthPerUnit || 0,
        widthPerUnit: s.widthPerUnit || 0,
        heightPerUnit: s.heightPerUnit || 0,
        volumePerUnit: s.volumePerUnit || 0,
        totalWeightKg: s.totalWeightKg || s.totalWeight || 0,
        totalVolumeM3: s.totalVolumeM3 || s.totalVolume || 0
      };

      const qtyOnHand = s.qtyOnHand ?? s.onHand ?? 0;

      // Bezpiecznie przeliczamy wymiary przy założeniu że cm->m3. Wzór (l * w * h) / 1,000,000
      // JavaScript precyzyjnie operuje na ułamkach w ten sposób:
      const rawVolume = (lengthCm * widthCm * heightCm) / 1000000;
      const volumePerUnit = Number(rawVolume.toFixed(4));
      const weightPerUnit = Number(weightKg.toFixed(3));

      const newTotalWeight = Number((qtyOnHand * weightPerUnit).toFixed(2));
      const newTotalVolume = Number((qtyOnHand * volumePerUnit).toFixed(4));

      const afterDimensions = {
        weightPerUnit: weightPerUnit,
        lengthPerUnit: Number(lengthCm.toFixed(2)),
        widthPerUnit: Number(widthCm.toFixed(2)),
        heightPerUnit: Number(heightCm.toFixed(2)),
        volumePerUnit: volumePerUnit,
        totalWeightKg: newTotalWeight,
        totalVolumeM3: newTotalVolume
      };

      // Zapisujemy nowy stan logistyczny dla stocku. Systemowy trigger onWorkspaceStockWritten automatycznie to odbierze i obliczy różnicę względem before i zaktualizuje stats
      t.update(stockRef, {
        ...afterDimensions,
        updatedAt: FieldValue.serverTimestamp()
      });

      // Zapisujemy log audytora z nowym rozmiarem
      const traceRef = db.collection(`companies/${companyId}/inventoryMovements`).doc();
      t.set(traceRef, {
         productId: s.productId || '',
         sku: s.sku || '',
         ean: s.ean || '',
         productName: s.productName || '',
         locationId: s.locationId || s.warehouseLocationId || '',
         warehouseLocationId: s.warehouseLocationId || s.locationId || '',
         type: 'logistics_correction',
         qtyChange: 0,
         qtyBalance: qtyOnHand,
         createdAt: FieldValue.serverTimestamp(),
         createdBy: auth.uid,
         companyId: companyId,
         relatedDocId: stockId,
         logisticsBefore: beforeDimensions,
         logisticsAfter: afterDimensions
      });

    });

    return { success: true };
  } catch(e: any) {
    console.error("correctStockDimensions error:", e);
    throw new HttpsError(e.code || 'internal', e.message);
  }
});
