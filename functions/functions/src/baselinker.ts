import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';

// Definiujemy dostęp do hasła w Secret Manager
const encryptionKeyParam = defineSecret('MASTER_ENCRYPTION_KEY');

// Avoid initializing admin again if imported after index.ts, just get instance
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

function getEncryptionKey(): Buffer {
  const key = encryptionKeyParam.value();
  return crypto.createHash('sha256').update(String(key)).digest();
}

function encrypt(text: string): { encryptedData: string, iv: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', getEncryptionKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { encryptedData: encrypted, iv: iv.toString('hex') };
}

function decrypt(encryptedData: string, ivHex: string): string {
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', getEncryptionKey(), iv);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export const saveIntegration = onCall({ secrets: [encryptionKeyParam] }, async (request) => {
  console.log('[saveIntegration] Rozpoczęcie funkcji. Dane request:', typeof request.data);
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

  const { companyId, integrationId, token, customName, integrationType, importStatusId, exportStatusId } = data;
  if (!companyId || !integrationId || !token || !customName) {
    throw new HttpsError('invalid-argument', 'Missing required payload parameters.');
  }

  let parsedImportStatusId: number | null = null;
  if (importStatusId != null) {
    const trimmed = String(importStatusId).trim();
    if (trimmed !== '') {
      parsedImportStatusId = Number(trimmed);
      if (!Number.isInteger(parsedImportStatusId) || parsedImportStatusId <= 0) {
        throw new HttpsError('invalid-argument', 'importStatusId musi być dodatnią liczbą całkowitą');
      }
    }
  }

  // 1. Walidacja przynależności usera do firmy
  const memberDoc = await db.collection(`companies/${companyId}/members`).doc(auth.uid).get();
  if (!memberDoc.exists) {
    throw new HttpsError('permission-denied', 'Brak uprawnień. Użytkownik nie jest przypisany do tej firmy.');
  }

  try {
    const { encryptedData, iv } = encrypt(token);
    
    const integrationRef = db.collection(`companies/${companyId}/integrations`).doc(integrationId);
    console.log(`[saveIntegration] Zapisywanie dokumentu integracji do: companies/${companyId}/integrations/${integrationId}`);
    
    const payload: any = {
      orgId: companyId,
      type: integrationType || 'baselinker',
      customName,
      status: 'active',
      isDefault: true,
      syncStatus: 'idle',
      encryptedToken: encryptedData,
      iv: iv,
      keyVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdBy: auth.uid
    };
    if (parsedImportStatusId !== null) payload.importStatusId = parsedImportStatusId;
    if (exportStatusId) payload.exportStatusId = exportStatusId;
    
    await integrationRef.set(payload, { merge: true });

    if (integrationType === 'fulfillment_gepard') {
      try {
        await db.collection('companies').doc(companyId).update({
          inventoryDeductionMode: 'on_pack'
        });
        console.log(`[saveIntegration] Zaktualizowano tryb magazynowy na 'on_pack' dla firmy ${companyId}`);
      } catch (err: any) {
        console.error(`[saveIntegration] Błąd podczas aktualizacji trybu magazynowego:`, err);
      }
    }

    console.log(`[saveIntegration] Dokument ID: ${integrationId} (${customName}) został poprawnie zapisany!`);
    return { success: true };
  } catch (err: any) {
    console.error('[BASELINKER SAVE ERROR]:', err);
    throw new HttpsError('failed-precondition', err.message || 'Nieudany zapis integracji');
  }
});

export const testIntegration = onCall({ secrets: [encryptionKeyParam] }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

  const { companyId, integrationId, token: rawToken } = data;
  if (!companyId) {
    throw new HttpsError('invalid-argument', 'Missing companyId.');
  }

  const memberDoc = await db.collection(`companies/${companyId}/members`).doc(auth.uid).get();
  if (!memberDoc.exists) {
    throw new HttpsError('permission-denied', 'Brak uprawnień do operacji w tej firmie.');
  }

  let finalToken = rawToken;
  let integrationDocRef: admin.firestore.DocumentReference | null = null;

  if (!finalToken) {
    if (!integrationId) throw new HttpsError('invalid-argument', 'Należy podać gotowy token albo integrationId z bazy.');
    
    integrationDocRef = db.collection(`companies/${companyId}/integrations`).doc(integrationId);
    const integrationDoc = await integrationDocRef.get();
    
    if (!integrationDoc.exists) {
      throw new HttpsError('not-found', 'Integration not found.');
    }

    const integrationData = integrationDoc.data();
    if (!integrationData?.encryptedToken || !integrationData?.iv) {
      throw new HttpsError('failed-precondition', 'Integration is missing encrypted credentials.');
    }
    finalToken = decrypt(integrationData.encryptedToken, integrationData.iv);
  }

  try {
    console.log('[testIntegration] testIntegration started. Using token ending with: ' + (finalToken ? finalToken.slice(-4) : 'none'));
    const token = finalToken;

    // Call BaseLinker API with a globally permitted endpoint to check connectivity
    const params = new URLSearchParams();
    params.append('method', 'getInventories');
    // No parameters needed for getInventories sync check

    console.log('[testIntegration] request to BaseLinker sent (POST https://api.baselinker.com/connector.php, method=getInventories)');

    const blResponse = await fetch('https://api.baselinker.com/connector.php', {
      method: 'POST',
      headers: {
        'X-BLToken': token,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    console.log(`[testIntegration] BaseLinker HTTP status: ${blResponse.status} ${blResponse.statusText}`);
    const blJsonResponse = await blResponse.json();
    console.log(`[testIntegration] BaseLinker parsed status: ${blJsonResponse.status}`);

    const isSuccess = blJsonResponse.status === 'SUCCESS';
    
    // Zaktualizuj daty testów w bazie jeśli testujemy zapisaną integrację (nie surowy form z UI)
    if (integrationDocRef) {
      await integrationDocRef.update({
        lastTestAt: FieldValue.serverTimestamp(),
        ...(isSuccess && { lastSuccessAt: FieldValue.serverTimestamp() })
      });
    }

    console.log(`[testIntegration] returning to frontend -> success: ${isSuccess}, error: ${blJsonResponse.error_message || 'none'}`);
    return { success: isSuccess, blStatus: blJsonResponse.status, error: blJsonResponse.error_message };
  } catch (err: any) {
    console.error('[BASELINKER TEST ERROR]:', err);
    
    if (integrationDocRef) {
      await integrationDocRef.update({ lastTestAt: FieldValue.serverTimestamp() });
    }
    
    throw new HttpsError('failed-precondition', `Błąd połączenia z API: ${err.message}`);
  }
});

function normalizeString(val?: string) {
  if (!val) return '';
  return val.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

export const triggerProductSync = onCall({ secrets: [encryptionKeyParam] }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');

  const { companyId, integrationId, jobId } = data;
  let inventoryId = data.inventoryId;
  if (!companyId || !integrationId) {
    throw new HttpsError('invalid-argument', 'Missing parameters (requires companyId, integrationId).');
  }

  // Auth verification
  const memberDoc = await db.collection(`companies/${companyId}/members`).doc(auth.uid).get();
  if (!memberDoc.exists) throw new HttpsError('permission-denied', 'Unauthorized.');

  const integrationDoc = await db.collection(`companies/${companyId}/integrations`).doc(integrationId).get();
  if (!integrationDoc.exists) throw new HttpsError('not-found', 'Integration not found.');

  const integrationData = integrationDoc.data();
  if (!integrationData?.encryptedToken || !integrationData?.iv) {
    throw new HttpsError('failed-precondition', 'Missing credentials.');
  }
  const token = decrypt(integrationData.encryptedToken, integrationData.iv);

  if (!inventoryId) {
     const invParams = new URLSearchParams();
     invParams.append('method', 'getInventories');
     const invRes = await fetch('https://api.baselinker.com/connector.php', {
       method: 'POST',
       headers: { 'X-BLToken': token, 'Content-Type': 'application/x-www-form-urlencoded' },
       body: invParams
     });
     const invJson = await invRes.json();
     if (invJson.status === 'SUCCESS' && invJson.inventories && invJson.inventories.length > 0) {
       inventoryId = invJson.inventories[0].inventory_id;
     } else {
       throw new HttpsError('failed-precondition', 'Nie udało się pobrać domyślnego katalogu BaseLinker.');
     }
  }

  let jobRef;
  let jobData: any = {};
  
  if (jobId) {
    jobRef = db.collection(`companies/${companyId}/syncJobs`).doc(jobId);
    const snap = await jobRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Job not found.');
    jobData = snap.data();
  } else {
    jobRef = db.collection(`companies/${companyId}/syncJobs`).doc();
    jobData = {
      orgId: companyId,
      integrationId,
      status: 'running',
      processedCount: 0,
      createdCount: 0,
      updatedCount: 0,
      failedCount: 0,
      lastCursor: '1', // Baselinker page cursor
      startedAt: FieldValue.serverTimestamp(),
    };
    await jobRef.set(jobData);
  }

  if (jobData.status === 'completed' || jobData.status === 'failed') {
    return { success: true, status: jobData.status, message: 'Job already finished.' };
  }

  const currentPage = parseInt(jobData.lastCursor || '1', 10);
  
  try {
    // 1. Fetch Product List (just IDs)
    const listParams = new URLSearchParams();
    listParams.append('method', 'getInventoryProductsList');
    listParams.append('parameters', JSON.stringify({ inventory_id: inventoryId, page: currentPage }));
    
    const listRes = await fetch('https://api.baselinker.com/connector.php', {
      method: 'POST',
      headers: { 'X-BLToken': token, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: listParams
    });
    const listJson = await listRes.json();
    if (listJson.status !== 'SUCCESS') throw new Error(`BL Error: ${listJson.error_message}`);

    const productsMap = listJson.products || {};
    const productIds = Object.keys(productsMap);

    if (productIds.length === 0) {
      // Finished
      await jobRef.update({
        status: 'completed',
        finishedAt: FieldValue.serverTimestamp()
      });
      return { success: true, status: 'completed', jobId: jobRef.id };
    }

    // 2. Fetch Full Data for those IDs
    const dataParams = new URLSearchParams();
    dataParams.append('method', 'getInventoryProductsData');
    dataParams.append('parameters', JSON.stringify({ inventory_id: inventoryId, products: productIds }));
    
    const dataRes = await fetch('https://api.baselinker.com/connector.php', {
      method: 'POST',
      headers: { 'X-BLToken': token, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: dataParams
    });
    const dataJson = await dataRes.json();
    if (dataJson.status !== 'SUCCESS') throw new Error(`BL Data Error: ${dataJson.error_message}`);

    const detailedProducts = dataJson.products || {};
    const batch = db.batch();
    
    let chunkUpdated = 0;

    for (const pid of productIds) {
      const blProduct = detailedProducts[pid];
      if (!blProduct) continue;

      const sku = String(blProduct.sku || '');
      const ean = String(blProduct.ean || '');
      const name = String(blProduct.text_fields?.name || blProduct.name || '');
      const brand = String(blProduct.text_fields?.features?.Brand || '');

      // Create primary key (avoiding purely numeric auto-keys to prevent clashes, prepend BL-)
      const firestoreId = `bl-${pid}`;
      const productRef = db.collection(`companies/${companyId}/products`).doc(firestoreId);

      // We use set/merge because we want 'externalId' uniqueness mapped securely to document ID.
      // (Deduplication lookup is natively handled if ID matches). 
      // If we needed to dedup by SKU, we would query first, but for performance, BL Product ID is safest anchor.
      
      const rawW = blProduct.weight || '0';
      const rawL = blProduct.length || '0';
      const rawWd = blProduct.width || '0';
      const rawH = blProduct.height || '0';
      
      const wKg = parseFloat(String(rawW)) || 0;
      const lCm = parseFloat(String(rawL)) || 0;
      const wdCm = parseFloat(String(rawWd)) || 0;
      const hCm = parseFloat(String(rawH)) || 0;
      // Dimensions in cm -> cubic meters
      const vol = (lCm * wdCm * hCm) / 1000000;

      const payload: any = {
        productId: firestoreId,
        orgId: companyId,
        source: 'baselinker',
        sourceIntegrationId: integrationId,
        externalId: String(pid),
        externalIdExact: String(pid),
        sku,
        skuExact: sku,
        skuNormalized: normalizeString(sku),
        ean,
        eanExact: ean,
        eanNormalized: normalizeString(ean),
        name: name,
        nameNormalized: normalizeString(name),
        brand: brand,
        description: String(blProduct.text_fields?.description || ''),
        isActive: true,
        isArchived: false,
        sourceMissing: false,
        updatedAt: FieldValue.serverTimestamp(),
        logistics: {
          rawWeight: rawW,
          rawLength: rawL,
          rawWidth: rawWd,
          rawHeight: rawH,
          weight: wKg,
          length: lCm,
          width: wdCm,
          height: hCm,
          volume: vol,
          packagingType: 'unit',
          inventoryTracking: true
        }
      };

      // Handle simple image maps
      if (blProduct.images && typeof blProduct.images === 'object') {
        const imgUrls = Object.values(blProduct.images)
          .filter(u => typeof u === 'string')
          .map(u => {
            let urlStr = u as string;
            // Shoper via BL fallback - ensure .jpg
            if (urlStr.includes('shoparena.pl') || urlStr.includes('public/gfx')) {
              const lastSegment = urlStr.split('/').pop() || '';
              if (!lastSegment.includes('.')) {
                urlStr += '.jpg';
              }
            }
            return urlStr;
          });

        payload.images = imgUrls;
        if (imgUrls.length > 0) {
          payload.imageMainUrl = imgUrls[0];
          payload.imageThumbUrl = imgUrls[0];
        } else {
            payload.images = [];
        }
      } else {
        payload.images = [];
      }

      // Normally we would check if exists to increment "created" vs "updated"
      payload.createdAt = FieldValue.serverTimestamp(); // merge will ignore this if it exists due to set usage wait no, set with merge overwrites createdAt if we explicitly pass it. Let's rely on updated count generally for batch syncs unless doing heavy reads. We will classify all as processed to save DB read limits.
      
      batch.set(productRef, payload, { merge: true });
      chunkUpdated++;
    }

    await batch.commit();

    // Partial Finish - move to next page
    const nextCursor = (currentPage + 1).toString();
    const isFinished = productIds.length < 100; // Assuming BL returns max 100. If less, we are at the end.

    await jobRef.update({
      processedCount: FieldValue.increment(productIds.length),
      updatedCount: FieldValue.increment(chunkUpdated),
      status: isFinished ? 'completed' : 'partial',
      lastCursor: nextCursor,
      ...(isFinished && { finishedAt: FieldValue.serverTimestamp() })
    });

    return { success: true, status: isFinished ? 'completed' : 'partial', jobId: jobRef.id };

  } catch (err: any) {
    await jobRef.update({
      status: 'failed',
      lastErrorMessageSafe: err.message,
      finishedAt: FieldValue.serverTimestamp()
    });
    throw new HttpsError('internal', `Import Error: ${err.message}`);
  }
});

export const getIntegrationInventories = onCall({ secrets: [encryptionKeyParam] }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  const { companyId, integrationId } = data;
  if (!companyId || !integrationId) throw new HttpsError('invalid-argument', 'Missing parameters.');

  const memberDoc = await db.collection(`companies/${companyId}/members`).doc(auth.uid).get();
  if (!memberDoc.exists) throw new HttpsError('permission-denied', 'Unauthorized.');

  const integrationDocRef = db.collection(`companies/${companyId}/integrations`).doc(integrationId);
  const integrationDoc = await integrationDocRef.get();
  if (!integrationDoc.exists) throw new HttpsError('not-found', 'Integration not found.');

  const integrationData = integrationDoc.data();
  if (!integrationData?.encryptedToken || !integrationData?.iv) {
    throw new HttpsError('failed-precondition', 'Missing credentials.');
  }
  const token = decrypt(integrationData.encryptedToken, integrationData.iv);

  try {
    const params = new URLSearchParams();
    params.append('method', 'getInventories');
    
    const blRes = await fetch('https://api.baselinker.com/connector.php', {
      method: 'POST',
      headers: { 'X-BLToken': token, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    
    const blJsonResponse = await blRes.json();
    if (blJsonResponse.status !== 'SUCCESS') {
      throw new Error(`BL Error: ${blJsonResponse.error_message}`);
    }

    return { success: true, inventories: blJsonResponse.inventories || [] };
  } catch (err: any) {
    console.error('[getIntegrationInventories ERROR]:', err);
    throw new HttpsError('failed-precondition', `Nie można pobrać magazynów: ${err.message}`);
  }
});

export const deleteIntegration = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  const { companyId, integrationId } = data;
  if (!companyId || !integrationId) throw new HttpsError('invalid-argument', 'Missing parameters.');

  const memberDoc = await db.collection(`companies/${companyId}/members`).doc(auth.uid).get();
  if (!memberDoc.exists) throw new HttpsError('permission-denied', 'Unauthorized.');

  try {
    await db.collection(`companies/${companyId}/integrations`).doc(integrationId).delete();
    return { success: true };
  } catch (err: any) {
    throw new HttpsError('internal', `Failed to delete integration: ${err.message}`);
  }
});

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

async function mapProduct(companyId: string, item: any, productsCache: Map<string, any>): Promise<any> {
  const ean = item.ean ? String(item.ean).trim() : '';
  const sku = item.sku ? String(item.sku).trim() : '';
  
  // 1. EAN Exact
  if (ean) {
      const cacheKey = `ean:${ean}`;
      if (productsCache.has(cacheKey)) {
           const cached = productsCache.get(cacheKey);
           if (cached) return cached;
      } else {
           const snap = await db.collection(`companies/${companyId}/products`).where('eanExact', '==', ean).get();
           if (snap.size === 1) {
               const p = Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
               productsCache.set(cacheKey, p);
               return p;
           } else if (snap.size > 1) {
               productsCache.set(cacheKey, null);
               return null;
           }
           productsCache.set(cacheKey, false);
      }
  }

  // 2. SKU Exact
  if (sku) {
      const cacheKey = `sku:${sku}`;
      if (productsCache.has(cacheKey)) {
           const cached = productsCache.get(cacheKey);
           if (cached) return cached;
      } else {
           const snap = await db.collection(`companies/${companyId}/products`).where('skuExact', '==', sku).get();
           if (snap.size === 1) {
               const p = Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
               productsCache.set(cacheKey, p);
               return p;
           } else if (snap.size > 1) {
               productsCache.set(cacheKey, null);
               return null;
           }
           productsCache.set(cacheKey, false);
      }
      
      // 3. Normalized SKU (only if unambiguous)
      const nSku = normalizeString(sku);
      if (nSku) {
         const nCacheKey = `nsku:${nSku}`;
         if (productsCache.has(nCacheKey)) {
              const cached = productsCache.get(nCacheKey);
              if (cached) return cached;
         } else {
              const snap = await db.collection(`companies/${companyId}/products`).where('skuNormalized', '==', nSku).get();
              if (snap.size === 1) {
                  const p = Object.assign({ id: snap.docs[0].id }, snap.docs[0].data());
                  productsCache.set(nCacheKey, p);
                  return p;
              }
              productsCache.set(nCacheKey, null);
              return null;
         }
      }
  }

  return null;
}

async function processIntegrationSync(companyId: string, integrationDoc: any, operatorId: string) {
  const productsCache = new Map<string, any>();
  const integrationData = integrationDoc.data();
  if (!integrationData?.encryptedToken || !integrationData?.iv) {
    throw new Error('Brak zapisanych poświadczeń integracji.');
  }

  const token = decrypt(integrationData.encryptedToken, integrationData.iv);
  const integrationId = integrationDoc.id;

  let dateFromUnix: number;
  if (integrationData.lastSuccessfulSyncAt) {
    // 10 minut bufor bezpieczeństwa wstecz
    dateFromUnix = Math.floor(integrationData.lastSuccessfulSyncAt.toMillis() / 1000) - (10 * 60);
  } else {
    // Fallback: dzisiaj od 00:00:00
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    dateFromUnix = Math.floor(startOfDay.getTime() / 1000);
  }

  const rawStatusId = integrationData.importStatusId;
  const statusIdNum = rawStatusId != null && String(rawStatusId).trim() !== ''
    ? Number(String(rawStatusId).trim())
    : null;

  if (statusIdNum !== null && (!Number.isInteger(statusIdNum) || statusIdNum <= 0)) {
    throw new Error(`Nieprawidłowy importStatusId w konfiguracji integracji: "${rawStatusId}"`);
  }

  // dateFromUnix liczony jak dziś — zostaje jako safety bound (limit jak daleko wstecz patrzymy).
  const blParams: Record<string, any> = { date_from: dateFromUnix };
  if (statusIdNum !== null) {
    blParams.status_id = statusIdNum;
    blParams.get_unconfirmed_orders = true; // BL domyślnie pomija niezatwierdzone — wymuszamy pełne okno
  }

  const params = new URLSearchParams();
  params.append('method', 'getOrders');
  params.append('parameters', JSON.stringify(blParams));

  const jobId = db.collection(`companies/${companyId}/integrationSyncJobs`).doc().id;
  const syncJobRef = db.collection(`companies/${companyId}/integrationSyncJobs`).doc(jobId);
  const now = FieldValue.serverTimestamp();
  
  await syncJobRef.set({
    id: jobId,
    orgId: companyId,
    integrationId,
    type: 'incremental_sync',
    status: 'running',
    operatorId,
    startedAt: now,
    metrics: { fetched: 0, new: 0, skipped: 0, errors: 0 }
  });

  await integrationDoc.ref.update({
    lastAttemptAt: now,
    lastRunStatus: 'running'
  });

  try {
    const blRes = await fetch('https://api.baselinker.com/connector.php', {
      method: 'POST',
      headers: { 'X-BLToken': token, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const blJsonResponse = await blRes.json();
    if (blJsonResponse.status !== 'SUCCESS') {
      throw new Error(`BL API Error: ${blJsonResponse.error_message}`);
    }

    const orders = blJsonResponse.orders || [];
    const fetchedCount = orders.length;
    let newCount = 0;
    let skippedCount = 0;
    
    // Zabezpieczenie przed wyciekiem czasu w skrypcie: stały timestamp
    const runTimestamp = admin.firestore.Timestamp.now();

    if (fetchedCount > 0) {
      const externalIds = orders.map((o: any) => String(o.order_id));
      const existingOrdersMap = new Map();
      
      const chunks = chunkArray(externalIds, 30);
      for (const chunk of chunks) {
        const snap = await db.collection(`companies/${companyId}/orders`)
          .where('source', '==', 'baselinker')
          .where('externalOrderId', 'in', chunk)
          .get();
        snap.docs.forEach(d => existingOrdersMap.set(d.data().externalOrderId, d.id));
      }

      const seqDocRef = db.collection(`companies/${companyId}/system`).doc('orderSequence');
      const seqSnapshot = await seqDocRef.get();
      let currentSeq = seqSnapshot.exists ? (seqSnapshot.data()?.current || 0) : 0;
      let initialSeq = currentSeq;

      let currentBatch = db.batch();
      let opCount = 0;

      for (const blOrder of orders) {
        const extId = String(blOrder.order_id);
        if (existingOrdersMap.has(extId)) {
          skippedCount++;
          continue; 
        }

        currentSeq++;
        const internalOrderNumber = `ORD/BL/${new Date().getFullYear()}/${String(currentSeq).padStart(5, '0')}`;
        const newOrderId = db.collection(`companies/${companyId}/orders`).doc().id;
        const orderRef = db.collection(`companies/${companyId}/orders`).doc(newOrderId);
        
        let recipientFirstName = '';
        let recipientLastName = '';
        if (blOrder.delivery_fullname) {
           const parts = blOrder.delivery_fullname.split(' ');
           recipientFirstName = parts[0] || '';
           recipientLastName = parts.slice(1).join(' ') || '';
        }

        const recipient: any = {
           firstName: recipientFirstName,
           lastName: recipientLastName,
           companyName: blOrder.delivery_company || '',
           email: blOrder.email || '',
           phone: blOrder.phone || '',
           address: {
              street: blOrder.delivery_address || '',
              city: blOrder.delivery_city || '',
              zipCode: blOrder.delivery_postcode || '',
              country: blOrder.delivery_country_code || 'PL'
           }
        };

        const paymentMethod = blOrder.payment_method || 'Nieznana';
        
        let invoiceDetails: any = undefined;
        if (blOrder.invoice_fullname || blOrder.invoice_company || blOrder.invoice_nip) {
            invoiceDetails = {
                name: blOrder.invoice_fullname || '',
                companyName: blOrder.invoice_company || '',
                vatNumber: blOrder.invoice_nip || '',
                address: {
                    street: blOrder.invoice_address || '',
                    city: blOrder.invoice_city || '',
                    zipCode: blOrder.invoice_postcode || '',
                    country: blOrder.invoice_country_code || 'PL'
                }
            };
        }

        const items = blOrder.products || [];
        const itemCount = items.reduce((sum: number, i: any) => sum + (i.quantity || 1), 0);
        const recipientDisplayName = blOrder.delivery_company ? `${blOrder.delivery_fullname} (${blOrder.delivery_company})` : blOrder.delivery_fullname;
        const recipientCity = blOrder.delivery_city || '';
        const shippingMethodLabel = blOrder.delivery_method || 'Standard';

        // Mapping
        let firstItemProductId = '';
        let firstItemSource = 'order_fallback';
        let firstItemImageUrl = '';
        let firstItemName = items[0]?.name || '';
        let firstItemSku = items[0]?.sku || '';
        let firstItemEan = items[0]?.ean || '';

        const processedItems = [];
        for (const item of items) {
            const mappedProduct = await mapProduct(companyId, item, productsCache);
            let pId = '';
            let mappingStatus = 'unmapped';

            if (mappedProduct) {
               pId = mappedProduct.id;
               mappingStatus = 'mapped';
            }
            
            processedItems.push({
               sourceItem: item,
               mappedProductId: pId,
               mappingStatus: mappingStatus,
               mappedProduct: mappedProduct
            });
        }
        
        if (processedItems.length > 0) {
            const first = processedItems[0];
            if (first.mappingStatus === 'mapped') {
                firstItemProductId = first.mappedProductId;
                firstItemSource = 'crm_product';
                firstItemImageUrl = first.mappedProduct.imageMainUrl || (first.mappedProduct.images && first.mappedProduct.images[0]) || '';
                firstItemName = first.mappedProduct.name || first.sourceItem.name || '';
                firstItemSku = first.mappedProduct.sku || first.sourceItem.sku || '';
                firstItemEan = first.mappedProduct.ean || first.sourceItem.ean || '';
            }
        }

        currentBatch.set(orderRef, {
            id: newOrderId,
            orgId: companyId,
            source: 'baselinker',
            integrationId: integrationId,
            externalOrderId: extId,
            orderNumber: internalOrderNumber,
            recipient: recipient,
            shippingMethod: shippingMethodLabel,
            courierCode: 'unknown',
            paymentMethod: paymentMethod,
            ...(invoiceDetails ? { invoiceDetails } : {}),
            status: 'new',
            reservationStatus: 'none',
            shipmentStatus: 'not_ready',
            notes: blOrder.user_comments || '',
            internalNotes: blOrder.admin_comments || '',
            createdBy: 'system_import',
            createdAt: runTimestamp,
            updatedAt: runTimestamp,
            itemCount,
            recipientDisplayName: recipientDisplayName || '',
            recipientCity,
            shippingMethodLabel,
            // The Preview Helpers V2
            orderHelpersVersion: 2,
            firstItemSource: firstItemSource,
            firstItemProductId: firstItemProductId,
            firstItemImageUrl: firstItemImageUrl,
            firstItemName: firstItemName,
            firstItemSku: firstItemSku,
            firstItemEan: firstItemEan
        });
        opCount++;

        for (const pItem of processedItems) {
            const itemId = db.collection(`companies/${companyId}/orderItems`).doc().id;
            const itemRef = db.collection(`companies/${companyId}/orderItems`).doc(itemId);
            currentBatch.set(itemRef, {
                id: itemId,
                orderId: newOrderId,
                orgId: companyId,
                productId: pItem.mappedProductId, 
                sourceProductId: String(pItem.sourceItem.product_id),
                sku: pItem.sourceItem.sku || '',
                ean: pItem.sourceItem.ean || '',
                name: pItem.sourceItem.name || '',
                qtyOrdered: pItem.sourceItem.quantity || 1,
                qtyReserved: 0,
                qtyPicked: 0,
                qtyShipped: 0,
                mappingStatus: pItem.mappingStatus
            });
            opCount++;
        }
        newCount++;

        if (opCount > 350) {
           await currentBatch.commit();
           currentBatch = db.batch();
           opCount = 0;
        }
      }

      if (opCount > 0) {
         if (currentSeq > initialSeq) {
            currentBatch.set(seqDocRef, { current: currentSeq }, { merge: true });
         }
         await currentBatch.commit();
      }
    }

    const finishTime = FieldValue.serverTimestamp();
    const stats = { fetched: fetchedCount, new: newCount, skipped: skippedCount, errors: 0 };

    await syncJobRef.update({
      status: 'completed',
      finishedAt: finishTime,
      metrics: stats
    });

    await integrationDoc.ref.update({
      lastSuccessfulSyncAt: runTimestamp, // Rzeczywisty czas zaciągu przed procesowaniem
      lastRunStatus: 'success',
      syncStats: stats,
      lastError: null
    });

    return { success: true, ...stats };

  } catch (err: any) {
    console.error(`[processIntegrationSync] Błąd integracji ${integrationId}:`, err);
    await syncJobRef.update({
      status: 'failed',
      finishedAt: FieldValue.serverTimestamp(),
      errorMessage: err.message,
      'metrics.errors': 1
    });
    await integrationDoc.ref.update({
      lastRunStatus: 'error',
      lastError: err.message
    });
    throw err;
  }
}

async function enrichIncompleteOrders(companyId: string) {
  const productsCache = new Map<string, any>();
  const snap = await db.collection(`companies/${companyId}/orders`)
       .orderBy('createdAt', 'desc')
       .limit(100)
       .get();
       
  let batch = db.batch();
  let opCount = 0;
  
  for (const doc of snap.docs) {
       console.log("ENRICH RUN", doc.id);
       const data = doc.data();
       if (data.orderHelpersVersion === 2) continue; // Skip already completed
       
       const itemsSnap = await db.collection(`companies/${companyId}/orderItems`)
             .where('orderId', '==', doc.id)
             .get();
             
       if (itemsSnap.empty) continue;
       
       let firstItemProductId = '';
       let firstItemSource = 'order_fallback';
       let firstItemImageUrl = '';
       let firstItemName = '';
       let firstItemSku = '';
       let firstItemEan = '';
       let isFirst = true;

       for (const itemDoc of itemsSnap.docs) {
           const itemData = itemDoc.data();
           let mappingStatus = itemData.mappingStatus;
           let pId = itemData.productId;

           if (mappingStatus !== 'mapped') {
               const mappedProduct = await mapProduct(companyId, itemData, productsCache);
               if (mappedProduct) {
                   pId = mappedProduct.id;
                   mappingStatus = 'mapped';
                   batch.update(itemDoc.ref, {
                       productId: pId,
                       mappingStatus: 'mapped'
                   });
                   opCount++;
                   
                   if (isFirst) {
                      firstItemProductId = pId;
                      firstItemSource = 'crm_product';
                      firstItemImageUrl = mappedProduct.imageMainUrl || (mappedProduct.images && mappedProduct.images[0]) || '';
                      firstItemName = mappedProduct.name || itemData.name || '';
                      firstItemSku = mappedProduct.sku || itemData.sku || '';
                      firstItemEan = mappedProduct.ean || itemData.ean || '';
                   }
               } else {
                   if (isFirst) {
                      firstItemSource = 'order_fallback';
                      firstItemName = itemData.name || '';
                      firstItemSku = itemData.sku || '';
                      firstItemEan = itemData.ean || '';
                   }
               }
           } else {
               if (isFirst) {
                   if (pId) {
                       const cacheKey = `id:${pId}`;
                       let mappedProduct = productsCache.get(cacheKey);
                       if (mappedProduct === undefined) {
                           const pDoc = await db.collection(`companies/${companyId}/products`).doc(pId).get();
                           mappedProduct = pDoc.exists ? pDoc.data() : null;
                           productsCache.set(cacheKey, mappedProduct);
                       }
                       
                       if (mappedProduct) {
                           firstItemProductId = pId;
                           firstItemSource = 'crm_product';
                           firstItemImageUrl = mappedProduct.imageMainUrl || (mappedProduct.images && mappedProduct.images[0]) || '';
                           firstItemName = mappedProduct.name || itemData.name || '';
                           firstItemSku = mappedProduct.sku || itemData.sku || '';
                           firstItemEan = mappedProduct.ean || itemData.ean || '';
                       } else {
                           firstItemSource = 'order_fallback';
                           firstItemName = itemData.name || '';
                           firstItemSku = itemData.sku || '';
                           firstItemEan = itemData.ean || '';
                       }
                   }
               }
           }
           isFirst = false;
       }
       
       batch.update(doc.ref, {
           orderHelpersVersion: 2,
           firstItemProductId,
           firstItemSource,
           firstItemImageUrl,
           firstItemName,
           firstItemSku,
           firstItemEan
       });
       opCount++;
       
       if (opCount > 300) {
           await batch.commit();
           batch = db.batch();
           opCount = 0;
       }
  }
  
  if (opCount > 0) {
      await batch.commit();
  }
}

export const manualSyncBaselinkerOrders = onCall({ secrets: [encryptionKeyParam] }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  const { companyId } = data;
  if (!companyId) throw new HttpsError('invalid-argument', 'Missing companyId.');

  const memberDoc = await db.collection(`companies/${companyId}/members`).doc(auth.uid).get();
  if (!memberDoc.exists) throw new HttpsError('permission-denied', 'Brak uprawnień do firmy.');

  const integrationsSnap = await db.collection(`companies/${companyId}/integrations`)
    .where('type', 'in', ['baselinker', 'fulfillment_gepard'])
    .where('status', '==', 'active')
    .get();

  if (integrationsSnap.empty) {
    throw new HttpsError('not-found', 'Brak aktywnej integracji BaseLinker.');
  }

  let integrationDoc;
  if (data.integrationId) {
    integrationDoc = integrationsSnap.docs.find(d => d.id === data.integrationId);
    if (!integrationDoc) throw new HttpsError('not-found', 'Wskazana integracja nie jest z tego kontekstu lub jest nieaktywna.');
  } else {
    if (integrationsSnap.docs.length === 1) {
      integrationDoc = integrationsSnap.docs[0];
    } else {
      const defaults = integrationsSnap.docs.filter(d => d.data().isDefault === true);
      if (defaults.length === 0) throw new HttpsError('failed-precondition', 'Znaleziono wiele aktywnych integracji, wskaż jedną za pomocą integrationId, lub nadaj rolę domyślną isDefault.');
      integrationDoc = defaults[0];
    }
  }

  try {
    const result = await processIntegrationSync(companyId, integrationDoc, auth.uid);
    
    // Also supplement helpers for existing legacy orders
    await enrichIncompleteOrders(companyId);

    return result;
  } catch (err: any) {
    throw new HttpsError('internal', `Import Error: ${err.message}`);
  }
});

export const scheduledSyncBaselinkerOrders = onSchedule({
  schedule: 'every 1 minutes',
  timeoutSeconds: 300,
  memory: '256MiB',
  secrets: [encryptionKeyParam]
}, async (event: any) => {
  console.log('[scheduledSyncBaselinkerOrders] Uruchomienie cron-joba co 1 minutę.');
  
  const companiesSnap = await db.collection('companies').where('status', '==', 'active').get();
  
  let totalProcessed = 0;
  let totalErrors = 0;

  for (const comp of companiesSnap.docs) {
    const compId = comp.id;
    const integrationsSnap = await db.collection(`companies/${compId}/integrations`)
      .where('type', 'in', ['baselinker', 'fulfillment_gepard'])
      .where('status', '==', 'active')
      .get();
    
    for (const integrationDoc of integrationsSnap.docs) {
      const data = integrationDoc.data();
      if (data.autoSync !== true) continue;
      
      const syncIntervalMs = (data.syncInterval || 5) * 60 * 1000;
      const lastAttemptAt = data.lastAttemptAt?.toMillis() || 0;
      
      if (Date.now() - lastAttemptAt >= syncIntervalMs) {
         try {
           console.log(`[scheduledSyncBaselinkerOrders] Przetwarzanie firmy ${compId}, integracja ${integrationDoc.id}`);
           await processIntegrationSync(compId, integrationDoc, 'system_cron');
           totalProcessed++;
         } catch (err) {
           console.error(`[scheduledSyncBaselinkerOrders] Błąd w firmie ${compId}, integracja ${integrationDoc.id}:`, err);
           totalErrors++;
         }
      }
    }
  }

  console.log(`[scheduledSyncBaselinkerOrders] Zakończono przebieg. Udanych: ${totalProcessed}. Błędów: ${totalErrors}.`);
});


export const onShipmentCreatedSendBaselinkerTracking = onDocumentCreated(
  {
    document: 'companies/{companyId}/shipments/{shipmentId}',
    secrets: [encryptionKeyParam]
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const shipmentData = snap.data();
    const companyId = event.params.companyId;

    // Check if the order is associated with baselinker or fulfillment_gepard
    const orderId = shipmentData.orderId;
    if (!orderId) {
       console.log(`[BaseLinker Tracker] Pomięcie: brak orderId w shipment ${snap.id}`);
       return;
    }

    const orderDoc = await db.collection(`companies/${companyId}/orders`).doc(orderId).get();
    if (!orderDoc.exists) {
       console.log(`[BaseLinker Tracker] Pomięcie: brak dokumentu order ${orderId}`);
       return;
    }

    const orderData = orderDoc.data();
    if (orderData?.source !== 'baselinker' && orderData?.source !== 'fulfillment_gepard') {
      console.log(`[BaseLinker Tracker] Pomięcie: source to nie baselinker/fulfillment_gepard (${orderData?.source}) dla zamówienia ${orderId}`);
      return; // Not a BaseLinker order
    }
    
    // Check if we have tracking info
    const trackingNumber = shipmentData.trackingNumber;
    const courierCode = shipmentData.courierCode || shipmentData.provider || shipmentData.carrier || 'other';
    if (!trackingNumber) {
       console.log(`[BaseLinker Tracker] Pomięcie: brak trackingNumber w shipment ${snap.id}`);
       return;
    }

    // Find the integration
    const integrationId = orderData?.integrationId;
    if (!integrationId) {
       console.log(`[BaseLinker Tracker] Pomięcie: brak integrationId w zamówieniu ${orderId}`);
       return;
    }

    const integrationDoc = await db.collection(`companies/${companyId}/integrations`).doc(integrationId).get();
    if (!integrationDoc.exists) {
       console.log(`[BaseLinker Tracker] Pomięcie: brak integracji ${integrationId}`);
       return;
    }

    const integrationData = integrationDoc.data();
    if (integrationData?.type !== 'fulfillment_gepard') {
      console.log(`[BaseLinker Tracker] Pomięcie: typ integracji to nie fulfillment_gepard (${integrationData?.type})`);
      return; // Only fulfillment_gepard pushes tracking
    }

    if (!integrationData?.encryptedToken || !integrationData?.iv) {
       console.log(`[BaseLinker Tracker] Pomięcie: brak zapisanego tokenu w integracji ${integrationId}`);
       return;
    }

    const token = decrypt(integrationData.encryptedToken, integrationData.iv);

    try {
      // Walidacja externalOrderId
      const extId = Number(orderData?.externalOrderId);
      if (!Number.isInteger(extId) || extId <= 0) {
        console.log(`[BaseLinker Tracker] Pomięcie: nieprawidłowy externalOrderId (${orderData?.externalOrderId}) dla zamówienia ${orderId}`);
        return;
      }

      // Mapowanie naszego wewnętrznego kodu kuriera (z shipmentData.carrier) 
      // na courier_code akceptowany przez API BaseLinker.
      // Klucze są lowercase. Dla nieznanych kurierów fallback to 'other'.
      const carrierToBlCourier: Record<string, string> = {
        'dhl_de': 'dhl_de',
        'dhl-de': 'dhl_de',
        'dhl': 'dhl',
        'dpd': 'dpd',
        'inpost': 'inpost',
        'gls': 'gls',
        'gls_pl': 'gls',
        'fedex': 'fedex',
        'ups': 'ups',
        'poczta-polska': 'poczta-polska',
        'other': 'other'
      };
      const normalizedCarrier = String(courierCode || '').toLowerCase().trim();
      const blCourier = carrierToBlCourier[normalizedCarrier] || 'other';

      // 1. Rejestracja paczki w BL — poprawna metoda createPackageManual
      const packageParams = new URLSearchParams();
      packageParams.append('method', 'createPackageManual');
      packageParams.append('parameters', JSON.stringify({
        order_id: extId,
        courier_code: blCourier,
        package_number: trackingNumber,
        pickup_date: Math.floor(Date.now() / 1000)
      }));

      const res = await fetch('https://api.baselinker.com/connector.php', {
        method: 'POST',
        headers: { 'X-BLToken': token, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: packageParams
      });

      const jsonRes = await res.json();
      if (jsonRes.status !== 'SUCCESS') {
        console.error(`[BaseLinker Export Tracking Error] createPackageManual odrzucone dla zamówienia ${extId}:`, jsonRes.error_message, '| courier_code użyty:', blCourier);
        // Zapis błędu na zamówieniu, żeby UI mógł pokazać status
        await db.collection(`companies/${companyId}/orders`).doc(orderId).set({
          'shipping.trackingNumber': trackingNumber,
          'shipping.carrier': courierCode,
          'shipping.trackingSentToBaselinker': false,
          'shipping.trackingError': jsonRes.error_message || 'Unknown BL error',
          updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return; // KRYTYCZNE: nie wykonuj setOrderStatus jeśli paczka nie została dodana
      }

      console.log(`[BaseLinker] Dodano paczkę ${trackingNumber} (kurier BL: ${blCourier}, oryginalny: ${courierCode}) do zamówienia ${extId}`);

      // Zapis idempotencji + statystyki
      await db.collection(`companies/${companyId}/orders`).doc(orderId).set({
        'shipping.trackingNumber': trackingNumber,
        'shipping.carrier': courierCode,
        'shipping.trackingSentToBaselinker': true,
        'shipping.trackingSentAt': FieldValue.serverTimestamp(),
        'shipping.trackingError': FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      await db.collection(`companies/${companyId}/integrations`).doc(integrationId).set({
        'stats.totalTrackingSent': FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      // 2. Opcjonalna zmiana statusu po SUKCESIE paczki
      if (integrationData.exportStatusId) {
        const statusParams = new URLSearchParams();
        statusParams.append('method', 'setOrderStatus');
        statusParams.append('parameters', JSON.stringify({
          order_id: extId,
          status_id: Number(integrationData.exportStatusId)
        }));

        const statRes = await fetch('https://api.baselinker.com/connector.php', {
          method: 'POST',
          headers: { 'X-BLToken': token, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: statusParams
        });

        const statJson = await statRes.json();
        if (statJson.status !== 'SUCCESS') {
          console.error(`[BaseLinker Export Status Error] setOrderStatus nieudany dla ${extId}:`, statJson.error_message);
        } else {
          console.log(`[BaseLinker] Zmieniono status zamówienia ${extId} na ${integrationData.exportStatusId}`);
        }
      }
      
    } catch (err: any) {
      console.error('[BaseLinker Export Tracking Request Error]:', err);
    }
  }
);
