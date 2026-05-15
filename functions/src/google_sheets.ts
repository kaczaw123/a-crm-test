import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { google } from 'googleapis';

const db = admin.firestore();

async function getGoogleAuthClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return await auth.getClient();
}



function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

import { onDocumentCreated } from 'firebase-functions/v2/firestore';

export const runGoogleSheetsSyncOnJobCreated = onDocumentCreated('companies/{companyId}/syncJobs/{jobId}', async (event) => {
    const snap = event.data;
    if (!snap) return null;
    const jobData = snap.data();
    if (jobData.type !== 'google_sheets_sync') return null;

    const companyId = event.params.companyId;
    const integrationId = jobData.integrationId;
    if (!companyId || !integrationId) {
        return snap.ref.update({ status: 'error', errorMessage: 'Brakujące parametry' });
    }

    const integrationDocRef = db.collection(`companies/${companyId}/integrations`).doc(integrationId);
    const integrationDoc = await integrationDocRef.get();
    if (!integrationDoc.exists) {
        return snap.ref.update({ status: 'error', errorMessage: 'Nie znaleziono integracji' });
    }

    const integrationData = integrationDoc.data();
    const spreadsheetId = integrationData?.spreadsheetId;
    const sheetName = integrationData?.sheetName;
    if (!spreadsheetId || !sheetName) {
        return snap.ref.update({ status: 'error', errorMessage: 'Brak konfiguracji' });
    }

  try {
    const client = await getGoogleAuthClient();
    const sheets = google.sheets({ version: 'v4', auth: client as any });
    
    const lastFetchedRow = integrationData?.lastFetchedRow || 2;
    // Bezpieczny bufor - cofamy się o 20 wierszy żeby nie ominąć opóźnionych edycji
    let startRow = Math.max(lastFetchedRow - 20, 2);

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!I${startRow}:AA`,
    });

    const rows = res.data.values;
    if (!rows || rows.length === 0) {
      return { success: true, status: 'completed', metrics: { fetched: 0, new: 0, skipped: 0, errors: 0 } };
    }

    const ordersMap = new Map<string, any>();
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // I=0, J=1, K=2, L=3, M=4, N=5, O=6, P=7, Q=8, R=9, S=10, T=11, U=12, V=13, W=14, X=15, Y=16, Z=17, AA=18
      const extId = row[12]?.toString().trim() || ''; 
      
      // Jeżeli to nagłówek lub puste ID, pomiń
      if (!extId || extId.toLowerCase() === 'referenzbeleg') continue;

      if (!ordersMap.has(extId)) {
        ordersMap.set(extId, {
          externalOrderId: extId,
          importDate: row[0]?.toString().trim() || '', // Import Date z kolumny I
          trackingNumber: row[2]?.toString().trim() || '', // K: Tracking-Ref
          recipientName: row[3]?.toString().trim() || '', // L: Shipping Name
          address: {
            street: `${row[4]?.toString().trim() || ''} ${row[5]?.toString().trim() || ''}`.trim(), // M, N
            zipCode: row[6]?.toString().trim() || '', // O
            city: row[7]?.toString().trim() || '', // P
            country: (row[9]?.toString().trim().toUpperCase() || 'DE').substring(0, 2), // R (ISO Code expected by CRM)
            countryName: row[8]?.toString().trim() || 'Deutschland', // Q
            countryCode: row[9]?.toString().trim() || 'DE' // R
          },
          email: row[10]?.toString().trim() || '', // S
          reference: row[11]?.toString().trim() || '', // T
          plannedDate: row[13]?.toString().trim() || '', // V
          items: []
        });
      }

      const orderData = ordersMap.get(extId);
      orderData.items.push({
        sku: row[14]?.toString().trim() || '', // W
        name: row[15]?.toString().trim() || 'Nieznany produkt', // X
        category: row[16]?.toString().trim() || '', // Y
        ean: row[17]?.toString().trim() || '', // Z
        qty: parseInt(row[18]?.toString().trim() || '1', 10) || 1 // AA
      });
    }

    const externalIds = Array.from(ordersMap.keys());
    if (externalIds.length === 0) {
      return { success: true, status: 'completed', metrics: { fetched: 0, new: 0, skipped: 0, errors: 0 } };
    }

    // Sprawdzanie czy zamówienia już istnieją
    const existingOrdersMap = new Map();
    const chunks = chunkArray(externalIds, 30);
    for (const chunk of chunks) {
      const snap = await db.collection(`companies/${companyId}/orders`)
        .where('source', '==', 'google_sheets')
        .where('externalOrderId', 'in', chunk)
        .get();
      snap.docs.forEach(d => existingOrdersMap.set(d.data().externalOrderId, { 
        id: d.id, 
        createdAt: d.data().createdAt,
        status: d.data().status,
        inFulfillment: d.data().inFulfillment
      }));
    }

    // Pobieranie wpisów przesyłek dla odnalezionych zamówień w celu deduplikacji Tracking-Ref
    const existingShipmentsMap = new Map<string, boolean>();
    const existingOrderIds = Array.from(existingOrdersMap.values()).map(o => o.id);
    if (existingOrderIds.length > 0) {
      const orderIdChunks = chunkArray(existingOrderIds, 30);
      for (const chunk of orderIdChunks) {
        const shipSnap = await db.collection(`companies/${companyId}/shipments`)
          .where('orderId', 'in', chunk)
          .get();
        shipSnap.docs.forEach(d => {
          const sData = d.data();
          if (sData.orderId && sData.trackingNumber) {
            const normTrack = sData.trackingNumber.replace(/\s/g, '').toLowerCase();
            existingShipmentsMap.set(`${sData.orderId}_${normTrack}`, true);
          }
        });
      }
    }

    // -------------------------------------------------------------
    // ZBIERANIE NOWYCH PRODUKTÓW
    // -------------------------------------------------------------
    const sheetProductsMap = new Map<string, any>(); 
    for (const order of ordersMap.values()) {
       for (const item of order.items) {
          const key = item.ean ? `${item.sku}_${item.ean}` : item.sku;
          if (key && !sheetProductsMap.has(key)) {
             sheetProductsMap.set(key, {
                sku: item.sku,
                name: item.name,
                category: item.category,
                ean: item.ean
             });
          }
       }
    }

    const uniqueSkus = Array.from(new Set(Array.from(sheetProductsMap.values()).map(p => p.sku).filter(Boolean)));
    const uniqueEans = Array.from(new Set(Array.from(sheetProductsMap.values()).map(p => p.ean).filter(Boolean)));
    const existingProductsMap = new Map<string, string>(); 
    
    // 1. Szukamy po EAN (Priorytet)
    if (uniqueEans.length > 0) {
       const eanChunks = chunkArray(uniqueEans, 30);
       for (const chunk of eanChunks) {
          const snap = await db.collection(`companies/${companyId}/products`)
             .where('ean', 'in', chunk)
             .get();
          snap.docs.forEach(d => {
             const data = d.data();
             if (data.ean) existingProductsMap.set(data.ean, d.id);
          });
       }
    }

    // 2. Szukamy po SKU jako fallback (pobieramy mappingi dla sku, by w razie braku ean miec do czego zmapować)
    const missingSkus = uniqueSkus.filter(sku => !existingProductsMap.has(sku));

    if (missingSkus.length > 0) {
       const skuChunks = chunkArray(missingSkus, 30);
       for (const chunk of skuChunks) {
          const snap = await db.collection(`companies/${companyId}/products`)
             .where('sku', 'in', chunk)
             .get();
          snap.docs.forEach(d => {
             const data = d.data();
             if (data.sku && !existingProductsMap.has(data.sku)) {
                 existingProductsMap.set(data.sku, d.id);
             }
          });
       }
    }

    let pBatch = db.batch();
    let pOpCount = 0;
    
    for (const sheetProd of sheetProductsMap.values()) {
       let alreadyExists = false;
       if (sheetProd.ean) {
           alreadyExists = existingProductsMap.has(sheetProd.ean);
       } else if (sheetProd.sku) {
           alreadyExists = existingProductsMap.has(sheetProd.sku);
       }

       if (!alreadyExists) {
          const newProductId = db.collection(`companies/${companyId}/products`).doc().id;
          const newProductRef = db.collection(`companies/${companyId}/products`).doc(newProductId);
          
          pBatch.set(newProductRef, {
             id: newProductId,
             productId: newProductId,
             orgId: companyId,
             createdAt: admin.firestore.FieldValue.serverTimestamp(),
             updatedAt: admin.firestore.FieldValue.serverTimestamp(),
             name: sheetProd.name || 'Nieznany produkt GS',
             sku: sheetProd.sku,
             ean: sheetProd.ean || '',
             category: sheetProd.category || '',
             status: 'active',
             stockTotal: 0,
             stockReserved: 0,
             stockAvailable: 0,
             isBundle: false,
             weight: 0,
             dimensions: { length: 0, width: 0, height: 0 },
             tags: ['google_sheets']
          });
          
          if (sheetProd.ean) {
             existingProductsMap.set(sheetProd.ean, newProductId);
          } else {
             existingProductsMap.set(sheetProd.sku, newProductId);
          }
          pOpCount++;
          
          if (pOpCount === 400) {
             await pBatch.commit();
             pBatch = db.batch();
             pOpCount = 0;
          }
       }
    }
    
    if (pOpCount > 0) {
       await pBatch.commit();
    }
    // -------------------------------------------------------------

    const seqDocRef = db.collection(`companies/${companyId}/system`).doc('orderSequence');
    const seqSnapshot = await seqDocRef.get();
    let currentSeq = seqSnapshot.exists ? (seqSnapshot.data()?.current || 0) : 0;
    
    let currentBatch = db.batch();
    let opCount = 0;
    let newCount = 0;
    let skippedCount = 0;
    
    // Używamy ms, aby przesunąć timestampy każdego zamówienia o kilka kroków
    // Najniższy wiersz (pierwszy w buforze) dostanie +0, a każdy kolejny dostanie coraz więcej ms.
    // Dzięki temu, przy sortowaniu "desc", najwyższe wiersze pojawią się 
    // By przy setkach wierszy na start nie zrobić wysypu "w przyszłość" (np. +60 min do pętli), 
    // cofamy się w czasie stawiając najnowsze pozycje o "zero" milisekund, a te starsze o minus minuty.
    const runTimestampMs = Date.now();
    let timeOffsetMs = -(ordersMap.size * 1000); // Zaczynamy mocno w ujemnej przeszłości

    for (const order of ordersMap.values()) {
      if (existingOrdersMap.has(order.externalOrderId)) {
        if (order.trackingNumber) {
          const existingOrderRecord = existingOrdersMap.get(order.externalOrderId);
          const existingId = existingOrderRecord.id;
          const existingRef = db.collection(`companies/${companyId}/orders`).doc(existingId);
          
          let updatePayload: any = {
            trackingNumber: order.trackingNumber,
            updatedAt: admin.firestore.Timestamp.fromMillis(runTimestampMs + timeOffsetMs)
          };
          
          // ZABEZPIECZENIE: Nie nadpisuj statusu i rezerwacji jeśli zamówienie jest już procesowane w logistyce
          const isProtectedStatus = existingOrderRecord.inFulfillment === true || existingOrderRecord.status === 'in_fulfillment' || existingOrderRecord.status === 'packing' || existingOrderRecord.status === 'shipped';
          
          if (!isProtectedStatus) {
             updatePayload.status = 'shipped';
             updatePayload.reservationStatus = 'none';
             updatePayload.shipmentStatus = 'shipped';
          }
          
          currentBatch.update(existingRef, updatePayload);
          opCount++;
          
          const normTrack = order.trackingNumber.replace(/\s/g, '').toLowerCase();
          const dedupeKey = `${existingId}_${normTrack}`;
          
          if (!existingShipmentsMap.has(dedupeKey)) {
            const shipId = `gs_${order.trackingNumber.replace(/[^a-zA-Z0-9]/g, '')}`;
            const shipRef = db.collection(`companies/${companyId}/shipments`).doc(shipId);
            currentBatch.set(shipRef, {
               orderId: existingId,
               trackingNumber: order.trackingNumber,
               status: 'CREATED',
               carrier: 'DHL_DE',
               source: 'google_sheets',
               createdAt: existingOrderRecord.createdAt || admin.firestore.Timestamp.fromMillis(runTimestampMs + timeOffsetMs),
               createdBy: 'system_import'
            }, { merge: true });
            
            existingShipmentsMap.set(dedupeKey, true);
            opCount++;
          }
        }
        skippedCount++;
        
        if (opCount > 350) {
          await currentBatch.commit();
          currentBatch = db.batch();
          opCount = 0;
        }
        continue;
      }

      currentSeq++;
      const internalOrderNumber = `ORD/GS/${new Date().getFullYear()}/${String(currentSeq).padStart(5, '0')}`;
      const newOrderId = db.collection(`companies/${companyId}/orders`).doc().id;
      const orderRef = db.collection(`companies/${companyId}/orders`).doc(newOrderId);

      // Simple recipient extraction
      const parts = order.recipientName.split(' ');
      const recipientFirstName = parts[0] || '';
      const recipientLastName = parts.slice(1).join(' ') || '';

      const recipient = {
        firstName: recipientFirstName,
        lastName: recipientLastName,
        companyName: '',
        email: order.email || '',
        phone: '',
        address: order.address
      };

      const itemCount = order.items.reduce((sum: number, i: any) => sum + i.qty, 0);

      const firstItem = order.items[0];
      
      // Omijamy cacheowania productsCache dla uproszczenia pierwszego zarysu (można dodać docelowo lookup by SKU)
      
      // Detekcja czy pierwszy item został zmapowany przy imporcie
      let computedFirstItemSource: 'crm_product' | 'order_fallback' = 'order_fallback';
      let computedFirstProductId = '';
      let computedFirstName = firstItem?.name || '';
      let computedFirstSku = firstItem?.sku || '';
      let computedFirstEan = firstItem?.ean || '';
      let computedFirstImageUrl = '';

      if (firstItem) {
        const mappedPid = (firstItem.ean && existingProductsMap.get(firstItem.ean)) 
          || (firstItem.sku && existingProductsMap.get(firstItem.sku)) 
          || '';
        if (mappedPid) {
          // Spróbuj pobrać dane produktu z istniejącego cache, jeśli niedostępne — 
          // nie blokuj importu, zostaw fallback.
          try {
            const pSnap = await db.collection(`companies/${companyId}/products`).doc(mappedPid).get();
            if (pSnap.exists) {
              const pData = pSnap.data() as any;
              computedFirstItemSource = 'crm_product';
              computedFirstProductId = mappedPid;
              computedFirstName = pData.name || computedFirstName;
              computedFirstSku = pData.sku || computedFirstSku;
              computedFirstEan = pData.ean || computedFirstEan;
              computedFirstImageUrl = pData.imageThumbUrl || pData.imageMainUrl || (pData.images && pData.images[0]) || '';
            }
          } catch {}
        }
      }

      currentBatch.set(orderRef, {
        id: newOrderId,
        orgId: companyId,
        source: 'google_sheets',
        integrationId: integrationId,
        externalOrderId: order.externalOrderId,
        orderNumber: internalOrderNumber,
        recipient: recipient,
        shippingMethod: 'Standard',
        courierCode: 'unknown',
        paymentMethod: 'Nieznana',
        status: order.trackingNumber ? 'shipped' : 'new',
        reservationStatus: 'none',
        shipmentStatus: order.trackingNumber ? 'shipped' : 'not_ready',
        trackingNumber: order.trackingNumber || '',
        notes: `Ref: ${order.reference}, Geplantes Datum: ${order.plannedDate}`,
        internalNotes: '',
        createdBy: 'system_import',
        createdAt: admin.firestore.Timestamp.fromMillis(runTimestampMs + timeOffsetMs),
        updatedAt: admin.firestore.Timestamp.fromMillis(runTimestampMs + timeOffsetMs),
        itemCount,
        recipientDisplayName: order.recipientName,
        recipientCity: order.address.city,
        shippingMethodLabel: 'Standard',
        orderHelpersVersion: 2,
        firstItemSource: computedFirstItemSource,
        firstItemProductId: computedFirstProductId,
        firstItemImageUrl: computedFirstImageUrl,
        firstItemName: computedFirstName,
        firstItemSku: computedFirstSku,
        firstItemEan: computedFirstEan
      });
      opCount++;

      if (order.trackingNumber) {
        const shipId = `gs_${order.trackingNumber.replace(/[^a-zA-Z0-9]/g, '')}`;
        const shipRef = db.collection(`companies/${companyId}/shipments`).doc(shipId);
        currentBatch.set(shipRef, {
           orderId: newOrderId,
           trackingNumber: order.trackingNumber,
           status: 'CREATED',
           carrier: 'DHL_DE',
           source: 'google_sheets',
           createdAt: admin.firestore.Timestamp.fromMillis(runTimestampMs + timeOffsetMs),
           createdBy: 'system_import'
        }, { merge: true });
        opCount++;
      }

      for (const pItem of order.items) {
        const itemId = db.collection(`companies/${companyId}/orderItems`).doc().id;
        const itemRef = db.collection(`companies/${companyId}/orderItems`).doc(itemId);
        
        const foundProductId = (pItem.ean && existingProductsMap.get(pItem.ean)) || existingProductsMap.get(pItem.sku) || '';
        
        currentBatch.set(itemRef, {
            id: itemId,
            orderId: newOrderId,
            orgId: companyId,
            productId: foundProductId, 
            sourceProductId: '',
            sku: pItem.sku,
            ean: pItem.ean,
            name: pItem.name,
            qtyOrdered: pItem.qty,
            qtyReserved: 0,
            qtyPicked: 0,
            qtyShipped: 0,
            mappingStatus: foundProductId ? 'mapped' : 'unmapped'
        });
        opCount++;
      }
      newCount++;
      timeOffsetMs += 1000; // Podnosimy z dużego minusa ku zeru (chronologicznie w górę ku teraźniejszości)

      if (opCount > 350) {
        await currentBatch.commit();
        currentBatch = db.batch();
        opCount = 0;
      }
    }

    if (opCount > 0) {
      currentBatch.set(seqDocRef, { current: currentSeq }, { merge: true });
      await currentBatch.commit();
    }

    const newLastFetchedRow = startRow + (rows ? rows.length : 0);
    await integrationDocRef.update({
        lastRunStatus: 'success',
        lastFetchedRow: newLastFetchedRow
    });

    const stats = { fetched: externalIds.length, new: newCount, skipped: skippedCount, errors: 0 };
    await snap.ref.update({
        status: 'completed',
        finishedAt: FieldValue.serverTimestamp(),
        metrics: stats
    });
    
    return null;
  } catch(err: any) {
    console.error('[GS SYNC ERROR]:', err);
    await integrationDocRef.update({
        lastRunStatus: 'error',
        lastError: err.message
    });
    
    await snap.ref.update({
        status: 'error',
        errorMessage: err.message || 'Błąd API Arkusza',
        finishedAt: FieldValue.serverTimestamp()
    });
    return null;
  }
});

import { onSchedule } from 'firebase-functions/v2/scheduler';

export const scheduledGoogleSheetsSync = onSchedule({
  schedule: 'every 1 minutes',
  timeoutSeconds: 120,
  memory: '256MiB'
}, async (event) => {
  console.log('[scheduledGoogleSheetsSync] Uruchomienie cron-joba GS co 1 minutę.');
  const companiesSnap = await db.collection('companies').where('status', '==', 'active').get();
  
  for (const comp of companiesSnap.docs) {
    const compId = comp.id;
    const integrationsSnap = await db.collection(`companies/${compId}/integrations`)
      .where('type', '==', 'google_sheets')
      .where('status', '==', 'active')
      .get();
    
    for (const integrationDoc of integrationsSnap.docs) {
      const data = integrationDoc.data();
      if (data.autoSync !== true) continue;
      
      const syncIntervalMs = (data.syncInterval || 5) * 60 * 1000;
      const lastAttemptAt = data.lastAttemptAt?.toMillis() || 0;
      
      if (Date.now() - lastAttemptAt >= syncIntervalMs) {
         // Aktualizujemy lastAttemptAt zanim wypuścimy joba, by zablokować duble
         await integrationDoc.ref.update({
            lastAttemptAt: FieldValue.serverTimestamp()
         });

         const jobRef = db.collection(`companies/${compId}/syncJobs`).doc();
         await jobRef.set({
            orgId: compId,
            type: 'google_sheets_sync',
            integrationId: integrationDoc.id,
            status: 'running',
            startedAt: FieldValue.serverTimestamp()
         });
         console.log(`[scheduledGoogleSheetsSync] Utworzono syncJob dla firmy ${compId}, integracja: ${integrationDoc.id}`);
      }
    }
  }
});
