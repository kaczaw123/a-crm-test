import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export function normalizeString(val?: string) {
  if (!val) return '';
  return val.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

export async function mapProduct(companyId: string, item: any, productsCache: Map<string, any>): Promise<any> {
  const ean = item.ean ? String(item.ean).trim() : '';
  const sku = item.sku ? String(item.sku).trim() : '';
  
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

async function internalRemapOrders(companyId: string, orderIdsToCheck?: string[]) {
   const productsCache = new Map<string, any>();
   
   let ordersQuery: admin.firestore.Query = db.collection(`companies/${companyId}/orders`)
     .where('status', 'in', ['new', 'processing', 'awaiting_stock', 'ready_for_shipping']);
     
   if (orderIdsToCheck && orderIdsToCheck.length > 0) {
      const chunks = [];
      for(let i=0; i<orderIdsToCheck.length; i+=30) chunks.push(orderIdsToCheck.slice(i, i+30));
      
      const snaps = await Promise.all(chunks.map(chunk => 
         db.collection(`companies/${companyId}/orders`).where(admin.firestore.FieldPath.documentId(), 'in', chunk).get()
      ));
      
      const docs = snaps.flatMap(s => s.docs);
      return await processOrderDocs(companyId, docs, productsCache);
   } else {
      const snap = await ordersQuery.get();
      return await processOrderDocs(companyId, snap.docs, productsCache);
   }
}

async function processOrderDocs(companyId: string, orderDocs: admin.firestore.QueryDocumentSnapshot[], productsCache: Map<string, any>) {
   let totalRemapped = 0;
   let ordersAffected = 0;
   
   for (const orderDoc of orderDocs) {
      const orderId = orderDoc.id;
      const orderData = orderDoc.data();
      
      const itemsSnap = await db.collection(`companies/${companyId}/orderItems`)
         .where('orderId', '==', orderId)
         .where('mappingStatus', '==', 'unmapped')
         .get();
         
      if (itemsSnap.empty) continue;
      
      let orderModified = false;
      let firstItemUpdates: any = null;
      let isFirstItemMappedNow = false;
      
      const batch = db.batch();
      
      for (const itemDoc of itemsSnap.docs) {
         const itemData = itemDoc.data();
         
         const mappedProduct = await mapProduct(companyId, itemData, productsCache);
         if (mappedProduct) {
            batch.update(itemDoc.ref, {
               productId: mappedProduct.id,
               mappingStatus: 'mapped'
            });
            totalRemapped++;
            orderModified = true;
            
            if (!isFirstItemMappedNow && (!orderData.firstItemProductId || orderData.firstItemSource !== 'crm_product')) {
               isFirstItemMappedNow = true;
               firstItemUpdates = {
                  firstItemSource: 'crm_product',
                  firstItemProductId: mappedProduct.id,
                  firstItemImageUrl: mappedProduct.imageMainUrl || (mappedProduct.images && mappedProduct.images[0]) || '',
                  firstItemName: mappedProduct.name || itemData.name || '',
                  firstItemSku: mappedProduct.sku || itemData.sku || '',
                  firstItemEan: mappedProduct.ean || itemData.ean || ''
               };
            }
         }
      }
      
      if (orderModified) {
         ordersAffected++;
         const orderUpdate: any = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
         };
         if (firstItemUpdates) {
            Object.assign(orderUpdate, firstItemUpdates);
         }
         batch.update(orderDoc.ref, orderUpdate);
         await batch.commit();
      }
   }
   
   return { totalRemapped, ordersAffected };
}

export const autoRemapOrderItemsCallable = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  
  const { companyId, orderId } = data;
  if (!companyId) throw new HttpsError('invalid-argument', 'Brak parametrów.');

  const memberDoc = await db.collection(`companies/${companyId}/members`).doc(auth.uid).get();
  if (!memberDoc.exists) {
     const token = auth.token as any;
     const isSuperadmin = token.role === 'superadmin' || token.globalRole === 'superadmin';
     if (!isSuperadmin) throw new HttpsError('permission-denied', 'Brak uprawnień.');
  }

  const result = await internalRemapOrders(companyId, orderId ? [orderId] : undefined);
  return { success: true, ...result };
});

export const setOrderItemMapping = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  const { companyId, orderItemId, productId } = data;
  if (!companyId || !orderItemId || !productId) {
    throw new HttpsError('invalid-argument', 'Wymagane: companyId, orderItemId, productId.');
  }
  // Autoryzacja
  const memberDoc = await db.collection(`companies/${companyId}/members`).doc(auth.uid).get();
  if (!memberDoc.exists) {
    throw new HttpsError('permission-denied', 'User is not a member of this company.');
  }
  // Walidacja docelowego produktu
  const productRef = db.collection(`companies/${companyId}/products`).doc(productId);
  const productSnap = await productRef.get();
  if (!productSnap.exists) {
    throw new HttpsError('not-found', `Produkt ${productId} nie istnieje.`);
  }
  if (productSnap.data()?.isArchived === true) {
    throw new HttpsError('failed-precondition', 'Nie można mapować na zarchiwizowany produkt.');
  }
  // Walidacja orderItem
  const itemRef = db.collection(`companies/${companyId}/orderItems`).doc(orderItemId);
  const itemSnap = await itemRef.get();
  if (!itemSnap.exists) {
    throw new HttpsError('not-found', `OrderItem ${orderItemId} nie istnieje.`);
  }
  await itemRef.update({
    productId: productId,
    mappingStatus: 'mapped',
    mappedManually: true,
    mappedBy: auth.uid,
    mappedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Aktualizacja zamówienia rodzica — flaga, że ma manualne mapowanie + 
  // refresh helperów preview. Lista zamówień używa firstItemSource do 
  // ikony "zmapowano".
  const orderId = itemSnap.data()?.orderId;
  if (orderId) {
    const orderRef = db.collection(`companies/${companyId}/orders`).doc(orderId);
    const productData = productSnap.data() as any;
    const updatePayload: any = {
      hasManualMapping: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    // Jeśli to pierwsza pozycja zamówienia — zaktualizuj też preview helpers,
    // żeby ikona produktu też się odświeżyła.
    const orderSnap = await orderRef.get();
    const orderData = orderSnap.data();
    if (orderData?.firstItemSource !== 'crm_product') {
      // Sprawdź czy ten orderItem jest pierwszy (po createdAt)
      const itemsSnap = await db.collection(`companies/${companyId}/orderItems`)
        .where('orderId', '==', orderId)
        .get();
      const sortedItems = itemsSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || 0;
          const bTime = b.createdAt?.toMillis?.() || 0;
          return aTime - bTime;
        });
      if (sortedItems.length > 0 && sortedItems[0].id === orderItemId) {
        updatePayload.firstItemSource = 'crm_product';
        updatePayload.firstItemProductId = productId;
        updatePayload.firstItemName = productData.name || '';
        updatePayload.firstItemSku = productData.sku || '';
        updatePayload.firstItemEan = productData.ean || '';
        updatePayload.firstItemImageUrl = productData.imageThumbUrl || productData.imageMainUrl || (productData.images && productData.images[0]) || '';
      }
    }
    await orderRef.update(updatePayload);
  }

  // Sygnał audytu
  console.log(`[setOrderItemMapping] User ${auth.uid} zmapował orderItem ${orderItemId} -> product ${productId} (firma: ${companyId}).`);
  return { success: true };
});

export const scheduledAutoRemap = onSchedule({
  schedule: 'every 15 minutes',
  timeoutSeconds: 300,
  memory: '256MiB'
}, async (event: any) => {
  console.log('[scheduledAutoRemap] Uruchomienie cron-joba remapowania co 15 minut.');
  
  const companiesSnap = await db.collection('companies').where('status', '==', 'active').get();
  
  let globalRemapped = 0;
  let globalAffected = 0;

  for (const comp of companiesSnap.docs) {
    const compId = comp.id;
    try {
      console.log(`[scheduledAutoRemap] Przetwarzanie firmy ${compId}`);
      const res = await internalRemapOrders(compId);
      globalRemapped += res.totalRemapped;
      globalAffected += res.ordersAffected;
    } catch (err) {
      console.error(`[scheduledAutoRemap] Błąd w firmie ${compId}:`, err);
    }
  }

  console.log(`[scheduledAutoRemap] Zakończono. Zmapowano pozycji: ${globalRemapped} w zamówieniach: ${globalAffected}.`);
});

/**
 * Trigger: gdy zmieni się orderItem (mappingStatus / productId), 
 * przelicz na zamówieniu rodzica:
 *  - firstItemSource (= 'crm_product' jeśli pierwszy item po createdAt 
 *    ma mappingStatus 'mapped', inaczej zachowaj istniejące)
 *  - firstItem* preview helpers
 *  - allItemsMapped (boolean)
 */
export const onOrderItemMappingChanged = onDocumentWritten(
  'companies/{companyId}/orderItems/{itemId}',
  async (event) => {
    const beforeData = event.data?.before?.data();
    const afterData = event.data?.after?.data();
    
    // Skip pure deletions
    if (!afterData) return;
    
    // Skip irrelevant updates (only react to mapping changes)
    if (beforeData) {
      const mappingChanged = beforeData.mappingStatus !== afterData.mappingStatus 
        || beforeData.productId !== afterData.productId;
      if (!mappingChanged) return;
    }
    
    const companyId = event.params.companyId;
    const orderId = afterData.orderId;
    if (!orderId) return;
    
    const orderRef = db.collection(`companies/${companyId}/orders`).doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return;
    
    // Fetch all sibling items
    const itemsSnap = await db.collection(`companies/${companyId}/orderItems`)
      .where('orderId', '==', orderId)
      .get();
    
    if (itemsSnap.empty) return;
    
    const sortedItems = itemsSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return aTime - bTime;
      });
    
    const firstItem = sortedItems[0];
    const allItemsMapped = sortedItems.every(i => i.mappingStatus === 'mapped');
    
    const updatePayload: any = {
      allItemsMapped,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    // Aktualizuj firstItemSource + helpers gdy pierwszy item jest zmapowany
    if (firstItem.mappingStatus === 'mapped' && firstItem.productId) {
      // Pobierz dane produktu, żeby wypełnić preview
      const productSnap = await db.collection(`companies/${companyId}/products`)
        .doc(firstItem.productId).get();
      if (productSnap.exists) {
        const pData = productSnap.data() as any;
        updatePayload.firstItemSource = 'crm_product';
        updatePayload.firstItemProductId = firstItem.productId;
        updatePayload.firstItemName = pData.name || firstItem.name || '';
        updatePayload.firstItemSku = pData.sku || firstItem.sku || '';
        updatePayload.firstItemEan = pData.ean || firstItem.ean || '';
        updatePayload.firstItemImageUrl = pData.imageThumbUrl || pData.imageMainUrl || (pData.images && pData.images[0]) || '';
      }
    }
    
    await orderRef.update(updatePayload);
    console.log(`[onOrderItemMappingChanged] Order ${orderId} (firma ${companyId}): allItemsMapped=${allItemsMapped}, firstItemSource=${updatePayload.firstItemSource || '(unchanged)'}`);
  }
);

/**
 * One-shot backfill: dla wszystkich zamówień firmy przelicz preview 
 * helpers + allItemsMapped na podstawie aktualnych orderItems.
 * Wywołanie jednorazowe po deployu.
 */
export const backfillOrderMappingHelpers = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be authenticated.');
  
  const { companyId } = data;
  if (!companyId) throw new HttpsError('invalid-argument', 'Missing companyId.');
  
  const memberDoc = await db.collection(`companies/${companyId}/members`).doc(auth.uid).get();
  if (!memberDoc.exists) {
    throw new HttpsError('permission-denied', 'User is not a member of this company.');
  }
  
  // Pobierz wszystkie zamówienia firmy
  const ordersSnap = await db.collection(`companies/${companyId}/orders`).get();
  
  let processed = 0;
  let updated = 0;
  const productCache = new Map<string, any>();
  
  for (const orderDoc of ordersSnap.docs) {
    processed++;
    const orderId = orderDoc.id;
    const orderData = orderDoc.data();
    
    const itemsSnap = await db.collection(`companies/${companyId}/orderItems`)
      .where('orderId', '==', orderId)
      .get();
    
    if (itemsSnap.empty) continue;
    
    const sortedItems = itemsSnap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return aTime - bTime;
      });
    
    const firstItem = sortedItems[0];
    const allItemsMapped = sortedItems.every(i => i.mappingStatus === 'mapped');
    
    const updatePayload: any = { allItemsMapped };
    let needsUpdate = orderData.allItemsMapped !== allItemsMapped;
    
    if (firstItem.mappingStatus === 'mapped' && firstItem.productId 
        && orderData.firstItemSource !== 'crm_product') {
      let pData = productCache.get(firstItem.productId);
      if (!pData) {
        const pSnap = await db.collection(`companies/${companyId}/products`)
          .doc(firstItem.productId).get();
        if (pSnap.exists) {
          pData = pSnap.data();
          productCache.set(firstItem.productId, pData);
        }
      }
      if (pData) {
        updatePayload.firstItemSource = 'crm_product';
        updatePayload.firstItemProductId = firstItem.productId;
        updatePayload.firstItemName = pData.name || firstItem.name || '';
        updatePayload.firstItemSku = pData.sku || firstItem.sku || '';
        updatePayload.firstItemEan = pData.ean || firstItem.ean || '';
        updatePayload.firstItemImageUrl = pData.imageThumbUrl || pData.imageMainUrl || (pData.images && pData.images[0]) || '';
        needsUpdate = true;
      }
    }
    
    if (needsUpdate) {
      await orderDoc.ref.update(updatePayload);
      updated++;
    }
  }
  
  console.log(`[backfillOrderMappingHelpers] firma ${companyId}: przetworzono ${processed}, zaktualizowano ${updated}`);
  return { success: true, processed, updated };
});
