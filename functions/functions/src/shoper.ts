import { onCall, HttpsError, onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

// Definiujemy dostęp do hasła w Secret Manager
const encryptionKeyParam = defineSecret('MASTER_ENCRYPTION_KEY');

function getEncryptionKey(): Buffer {
  const key = encryptionKeyParam.value();
  return crypto.createHash('sha256').update(String(key)).digest();
}

function encryptData(text: string): { encryptedData: string, iv: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', getEncryptionKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { encryptedData: encrypted, iv: iv.toString('hex') };
}

function decryptData(encryptedData: string, ivHex: string): string {
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', getEncryptionKey(), iv);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Types
interface ShoperCredentials {
  apiUrl: string;
  username: string;
  passwordEncrypted: string;
  iv: string;
}

// 1. Zapis konfiguracji
export const saveShoperIntegration = onCall(
  { enforceAppCheck: false, secrets: [encryptionKeyParam] },
  async (request) => {
    const { data, auth } = request;
    if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');

    const { companyId, customName, apiUrl, username, password, isDefault } = data;
    if (!companyId || !apiUrl || !username || !password) {
      throw new HttpsError('invalid-argument', 'Brak wymaganych danych.');
    }

    try {
      const db = admin.firestore();

      // Weryfikacja dostępu do firmy
      const profileSnap = await db.collection('users').doc(auth.uid).get();
      const profile = profileSnap.data();
      if (!profile || (profile.companyId !== companyId && profile.activeCompanyId !== companyId)) {
        throw new HttpsError('permission-denied', 'Brak dostępu do firmy.');
      }

      // Szyfrowanie hasła
      const { encryptedData: passwordEncrypted, iv } = encryptData(password);

      const integrationData = {
        type: 'shoper',
        orgId: companyId,
        customName: customName || 'Sklep Shoper',
        status: 'active',
        isDefault: !!isDefault,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        shoper: {
          apiUrl: apiUrl.replace(/\/$/, ''), // usuń ewentualny slash na końcu
          username,
          passwordEncrypted,
          iv
        }
      };

      if (isDefault) {
        const batch = db.batch();
        const existing = await db.collection(`companies/${companyId}/integrations`).where('isDefault', '==', true).get();
        existing.forEach(doc => {
          batch.update(doc.ref, { isDefault: false });
        });
        const newRef = db.collection(`companies/${companyId}/integrations`).doc();
        batch.set(newRef, integrationData);
        await batch.commit();
        return { success: true, id: newRef.id };
      } else {
        const docRef = await db.collection(`companies/${companyId}/integrations`).add(integrationData);
        return { success: true, id: docRef.id };
      }
    } catch (error: any) {
      console.error('saveShoperIntegration error:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);

// 2. Testowanie połączenia
export const testShoperIntegration = onCall(
  { enforceAppCheck: false, secrets: [encryptionKeyParam] },
  async (request) => {
    const { data, auth } = request;
    if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
    const { companyId, integrationId } = data;

    try {
      const db = admin.firestore();
      const intSnap = await db.collection(`companies/${companyId}/integrations`).doc(integrationId).get();
      if (!intSnap.exists) throw new HttpsError('not-found', 'Nie znaleziono integracji.');
      
      const intData = intSnap.data() as any;
      if (intData.orgId !== companyId) throw new HttpsError('permission-denied', 'Brak dostępu.');
      
      const creds = intData.shoper as ShoperCredentials;
      if (!creds || !creds.iv) throw new HttpsError('invalid-argument', 'Brak konfiguracji Shoper.');

      const password = decryptData(creds.passwordEncrypted, creds.iv);
      
      // Próba pobrania tokenu WebAPI
      const authHeader = Buffer.from(`${creds.username}:${password}`).toString('base64');
      const authUrl = `${creds.apiUrl}/webapi/rest/auth`;
      
      const response = await fetch(authUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json'
        }
      });
      const responseData = await response.json();

      if (responseData && responseData.access_token) {
        await db.collection(`companies/${companyId}/integrations`).doc(integrationId).update({ status: 'active', errorMsg: null });
        return { success: true, message: 'Pomyślnie połączono z Shoper REST API.' };
      } else {
        throw new Error('Niepoprawna odpowiedź autoryzacji.');
      }
    } catch (error: any) {
      console.error('testShoperIntegration error:', error.message);
      await admin.firestore().collection(`companies/${companyId}/integrations`).doc(integrationId).update({ 
        status: 'error', 
        errorMsg: error.message 
      });
      throw new HttpsError('internal', 'Test nieudany: ' + error.message);
    }
  }
);

// Wewnętrzna funkcja do usypiania
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Wykonaj żądanie GET z obsługą limitów Leaky Bucket
async function shoperGetWithLimits(url: string, token: string): Promise<any> {
  const maxRetries = 3;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) {
        if (response.status === 429) {
          console.log(`Shoper API 429 Limit reached. Sleeping 3s...`);
          await sleep(3000);
          continue; // spróbuj ponownie
        }
        throw new Error(`Błąd HTTP ${response.status}`);
      }

      // Sprawdź nagłówki limitów
      const apiCallsStr = response.headers.get('x-shop-api-calls');
      const apiLimitStr = response.headers.get('x-shop-api-limit');
      
      if (apiCallsStr && apiLimitStr) {
        const calls = parseInt(apiCallsStr);
        const limit = parseInt(apiLimitStr);
        // Zostaw bufor 10 zapytań
        if (calls >= limit - 10) {
          console.log(`Shoper API Limit warning: ${calls}/${limit}. Sleeping 1.5s...`);
          await sleep(1500);
        }
      }
      return await response.json();
    } catch (error: any) {
      throw error;
    }
  }
  throw new Error(`Przekroczono maksymalną liczbę prób z powodu limitów API Shopera.`);
}

// 3. Synchronizacja
export const syncShoperOrders = onCall(
  { timeoutSeconds: 540, memory: '1GiB', enforceAppCheck: false, secrets: [encryptionKeyParam] },
  async (request) => {
    const { data, auth } = request;
    if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
    const { companyId, integrationId } = data;

    try {
      const db = admin.firestore();
      let integrationsQuery = db.collection(`companies/${companyId}/integrations`).where('type', '==', 'shoper');
      if (integrationId) integrationsQuery = integrationsQuery.where(admin.firestore.FieldPath.documentId(), '==', integrationId);
      
      const intSnap = await integrationsQuery.get();
      if (intSnap.empty) return { success: true, message: 'Brak konfiguracji Shoper.', fetched: 0, imported: 0, skipped: 0 };

      let totalFetched = 0;
      let totalImported = 0;
      let totalSkipped = 0;

      for (const intDoc of intSnap.docs) {
        const intData = intDoc.data();
        if (intData.status !== 'active') continue;
        
        const creds = intData.shoper as ShoperCredentials;
        if (!creds || !creds.iv) continue;

        const password = decryptData(creds.passwordEncrypted, creds.iv);
        const authHeader = Buffer.from(`${creds.username}:${password}`).toString('base64');
        const authUrl = `${creds.apiUrl}/webapi/rest/auth`;
        
        // 1. Generuj Token
        const authRes = await fetch(authUrl, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${authHeader}` }
        });
        const authResData = await authRes.json();
        const accessToken = authResData.access_token;
        if (!accessToken) continue;

        // 2. Pobierz słowniki (dostawy i płatności) do tłumaczenia ID na nazwy
        let shippingMap = new Map();
        let paymentMap = new Map();
        try {
           const shippingsData = await shoperGetWithLimits(`${creds.apiUrl}/webapi/rest/shippings`, accessToken);
           (shippingsData.list || []).forEach((s: any) => shippingMap.set(s.shipping_id.toString(), s.name));
           
           const paymentsData = await shoperGetWithLimits(`${creds.apiUrl}/webapi/rest/payments`, accessToken);
           (paymentsData.list || []).forEach((p: any) => paymentMap.set(p.payment_id.toString(), p.title));
        } catch(e) {
           console.log('Nie udało się pobrać słowników z Shoper API:', e);
        }

        // Incremental logic
        const lastSync = intData.lastSuccessfulSyncAt?.toDate() || new Date(Date.now() - 24 * 60 * 60 * 1000);
        const iso = lastSync.toISOString().replace('T', ' ').substring(0, 19);
        const filtersStr = encodeURIComponent(JSON.stringify({ "date": { ">": iso } }));

        // 3. Pobierz zamówienia
        const ordersUrl = `${creds.apiUrl}/webapi/rest/orders?limit=100&filters=${filtersStr}`;
        const ordersData = await shoperGetWithLimits(ordersUrl, accessToken);
        
        const shoperOrders = ordersData.list || [];
        totalFetched += shoperOrders.length;

        for (const sOrder of shoperOrders) {
          const orderIdStr = sOrder.order_id.toString();
          
          // Sprawdź czy istnieje
          const ordersRef = db.collection('companies').doc(companyId).collection('orders');
          const q = await ordersRef.where('source', '==', 'shoper').where('orderId', '==', orderIdStr).limit(1).get();
          if (!q.empty) {
             totalSkipped++;
             continue; 
          }

          // 3. Pobierz produkty dla tego zamówienia
          const prodUrl = `${creds.apiUrl}/webapi/rest/order-products?filters={"order_id":${sOrder.order_id}}`;
          const prodData = await shoperGetWithLimits(prodUrl, accessToken);
          const shoperProducts = prodData.list || [];

          // 4. Mapowanie
          const orderItems = shoperProducts.map((p: any) => ({
            id: p.id.toString(),
            name: p.name,
            sku: p.code || '',
            ean: '', 
            quantity: parseFloat(p.quantity) || 1,
            price: parseFloat(p.price) || 0,
            taxRate: parseFloat(p.tax) || 0,
            currency: sOrder.currency?.name || 'PLN',
            mappingStatus: 'unmapped'
          }));

          const crmOrder = {
            source: 'shoper',
            orderId: orderIdStr,
            orderNumber: sOrder.order_id.toString(),
            orderedAt: sOrder.date ? new Date(sOrder.date) : new Date(),
            createdAt: sOrder.date ? new Date(sOrder.date) : new Date(),
            importedAt: admin.firestore.FieldValue.serverTimestamp(),
            integrationId: intDoc.id,
            status: 'new', 
            
            buyer: {
              email: sOrder.email || '',
              phone: sOrder.delivery_address?.phone || sOrder.billing_address?.phone || '',
              login: ''
            },
            
            recipient: {
              firstName: sOrder.delivery_address?.firstname || '',
              lastName: sOrder.delivery_address?.lastname || '',
              companyName: sOrder.delivery_address?.company || '',
              email: sOrder.email || '',
              phone: sOrder.delivery_address?.phone || sOrder.billing_address?.phone || '',
              address: {
                street: `${sOrder.delivery_address?.street1 || ''} ${sOrder.delivery_address?.street2 || ''}`.trim(),
                city: sOrder.delivery_address?.city || '',
                zipCode: sOrder.delivery_address?.postcode || '',
                country: sOrder.delivery_address?.country || 'PL'
              }
            },
            
            invoiceDetails: {
              name: `${sOrder.billing_address?.firstname || ''} ${sOrder.billing_address?.lastname || ''}`.trim(),
              companyName: sOrder.billing_address?.company || '',
              vatNumber: sOrder.billing_address?.tax_id || '',
              address: {
                street: `${sOrder.billing_address?.street1 || ''} ${sOrder.billing_address?.street2 || ''}`.trim(),
                city: sOrder.billing_address?.city || '',
                zipCode: sOrder.billing_address?.postcode || '',
                country: sOrder.billing_address?.country || 'PL'
              }
            },
            
            delivery: {
              method: sOrder.shipping?.name || shippingMap.get(sOrder.shipping_id?.toString()) || `Wysyłka #${sOrder.shipping_id}`,
              cost: parseFloat(sOrder.shipping_cost) || 0,
              currency: sOrder.currency?.name || 'PLN'
            },
            
            payment: {
              type: sOrder.payment?.name || paymentMap.get(sOrder.payment_id?.toString()) || `Płatność #${sOrder.payment_id}`,
              status: (parseFloat(sOrder.paid) || 0) >= (parseFloat(sOrder.sum) || 0) ? 'paid' : 'unpaid',
              totalAmount: parseFloat(sOrder.sum) || 0,
              paidAmount: parseFloat(sOrder.paid) || 0,
              currency: sOrder.currency?.name || 'PLN'
            },
            
            paymentMethod: sOrder.payment?.name || paymentMap.get(sOrder.payment_id?.toString()) || `Płatność #${sOrder.payment_id}`,
            shippingMethod: sOrder.shipping?.name || shippingMap.get(sOrder.shipping_id?.toString()) || `Wysyłka #${sOrder.shipping_id}`,
            
            items: orderItems,
            itemCount: orderItems.length,
            firstItemName: orderItems[0]?.name || '',
            firstItemSku: orderItems[0]?.sku || ''
          };

          const batch = db.batch();
          const orderDocRef = ordersRef.doc();
          batch.set(orderDocRef, crmOrder);

          // Utworzenie wpisów orderItems
          for (const item of orderItems) {
            const itemRef = db.collection(`companies/${companyId}/orderItems`).doc();
            batch.set(itemRef, {
              ...item,
              orderId: orderDocRef.id,
              companyId,
              qtyOrdered: item.quantity,
              qtyReserved: 0,
              qtyPacked: 0,
              qtyShipped: 0
            });
          }

          await batch.commit();
          totalImported++;
        }
      }

      // Zapisujemy lastSuccessfulSyncAt
      for (const intDoc of intSnap.docs) {
         if (intDoc.data().status === 'active') {
             await intDoc.ref.update({
                 lastSuccessfulSyncAt: admin.firestore.FieldValue.serverTimestamp(),
                 lastAttemptAt: admin.firestore.FieldValue.serverTimestamp()
             });
         }
      }

      return { success: true, fetched: totalFetched, imported: totalImported, skipped: totalSkipped };
    } catch (error: any) {
      console.error('syncShoperOrders error:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);

// 4. Synchronizacja produktów
export const syncShoperProducts = onCall(
  { timeoutSeconds: 540, memory: '1GiB', enforceAppCheck: false, secrets: [encryptionKeyParam] },
  async (request) => {
    const { data, auth } = request;
    if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
    const { companyId, integrationId } = data;

    try {
      const db = admin.firestore();
      let integrationsQuery = db.collection(`companies/${companyId}/integrations`).where('type', '==', 'shoper');
      if (integrationId) integrationsQuery = integrationsQuery.where(admin.firestore.FieldPath.documentId(), '==', integrationId);
      
      const intSnap = await integrationsQuery.get();
      if (intSnap.empty) return { success: true, message: 'Brak konfiguracji Shoper.', fetched: 0, imported: 0, skipped: 0 };

      let totalFetched = 0;
      let totalImported = 0;
      let totalSkipped = 0;

      for (const intDoc of intSnap.docs) {
        const intData = intDoc.data();
        if (intData.status !== 'active') continue;
        
        const creds = intData.shoper as ShoperCredentials;
        if (!creds || !creds.iv) continue;

        const password = decryptData(creds.passwordEncrypted, creds.iv);
        const authHeader = Buffer.from(`${creds.username}:${password}`).toString('base64');
        const authUrl = `${creds.apiUrl}/webapi/rest/auth`;
        
        const authRes = await fetch(authUrl, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${authHeader}` }
        });
        const authResData = await authRes.json();
        const accessToken = authResData.access_token;
        if (!accessToken) continue;

        let page = 1;
        let pages = 1;
        
        do {
          const productsUrl = `${creds.apiUrl}/webapi/rest/products?limit=50&page=${page}`;
          const productsData = await shoperGetWithLimits(productsUrl, accessToken);
          
          if (page === 1) {
            pages = productsData.pages || 1;
          }
          
          const shoperProducts = productsData.list || [];
          totalFetched += shoperProducts.length;

          const productsRef = db.collection('companies').doc(companyId).collection('products');

          for (const sProd of shoperProducts) {
            const prodIdStr = sProd.product_id.toString();
            
            const q = await productsRef.where('source', '==', 'shoper').where('productId', '==', prodIdStr).limit(1).get();
            if (!q.empty) {
               totalSkipped++;
               continue; 
            }

            const weight = parseFloat(sProd.weight) || parseFloat(sProd.vol_weight) || 0;
            const width = parseFloat(sProd.width) || parseFloat(sProd.dimension_w) || 0;
            const height = parseFloat(sProd.height) || parseFloat(sProd.dimension_h) || 0;
            const length = parseFloat(sProd.depth) || parseFloat(sProd.dimension_l) || 0;
            const volume = (width * height * length) / 1000000;

            let imageUrl = '';
            let debugStr = '';
            try {
              let imgObj: any = null;
              
              if (sProd.main_image) {
                if (typeof sProd.main_image === 'object' && sProd.main_image.gfx_id) {
                  imgObj = sProd.main_image;
                  debugStr = `got obj gfx_id=${imgObj.gfx_id}`;
                } else {
                  const gfxId = sProd.main_image;
                  imgObj = await shoperGetWithLimits(`${creds.apiUrl}/webapi/rest/product-images/${gfxId}`, accessToken);
                  debugStr = `fetched gfx_id=${gfxId}`;
                }
              } else {
                const filterStr = encodeURIComponent(JSON.stringify({ product_id: parseInt(prodIdStr) }));
                const imgRes = await shoperGetWithLimits(`${creds.apiUrl}/webapi/rest/product-images?filters=${filterStr}`, accessToken);
                if (imgRes && imgRes.list && imgRes.list.length > 0) {
                  imgObj = imgRes.list[0];
                  debugStr = `fetched list len=${imgRes.list.length}`;
                } else {
                  debugStr = `no list found`;
                }
              }

              if (imgObj && imgObj.gfx_id) {
                const fileName = imgObj.unic_name || imgObj.name || 'image.jpg';
                let relUrl = imgObj.url || `userdata/public/gfx/${imgObj.gfx_id}/${fileName}`;
                
                // Czasami Shoper w imgObj.url zwraca ścieżkę bez rozszerzenia!
                const lastSegment = relUrl.split('/').pop() || '';
                if (!lastSegment.includes('.')) {
                  relUrl += '.jpg';
                }
                
                imageUrl = relUrl.startsWith('http') ? relUrl : `${creds.apiUrl}/${relUrl.replace(/^\//, '')}`;
                debugStr += ` -> URL: ${imageUrl}`;
              } else {
                debugStr += ` -> NO OBJ/GFX_ID`;
              }
            } catch(e: any) {
              console.log(`Brak obrazka dla ${prodIdStr}`);
              debugStr += ` -> ERROR: ${e.message}`;
            }

            if (totalFetched <= 10) {
              await intDoc.ref.update({
                debugOutput: admin.firestore.FieldValue.arrayUnion(`Prod ${prodIdStr} [${sProd.main_image}]: ${debugStr}`)
              });
            }

            const crmProduct = {
              productId: prodIdStr,
              orgId: companyId,
              source: 'shoper',
              sourceIntegrationId: intDoc.id,
              
              externalId: prodIdStr,
              externalIdExact: prodIdStr,
              
              sku: sProd.code || '',
              skuExact: sProd.code || '',
              skuNormalized: (sProd.code || '').toLowerCase(),
              
              ean: sProd.ean || '',
              eanExact: sProd.ean || '',
              eanNormalized: (sProd.ean || '').toLowerCase(),
              
              name: sProd.translations?.pl_PL?.name || sProd.name || `Produkt #${prodIdStr}`,
              nameNormalized: (sProd.translations?.pl_PL?.name || sProd.name || '').toLowerCase(),
              
              description: sProd.translations?.pl_PL?.description || sProd.description || '',
              
              images: imageUrl ? [imageUrl] : [],
              imageThumbUrl: imageUrl,
              imageMainUrl: imageUrl,
              
              isActive: sProd.active === 1 || sProd.active === '1' || sProd.active === true,
              isArchived: false,
              sourceMissing: false,
              
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              
              logistics: {
                rawWeight: sProd.weight || sProd.vol_weight || 0,
                weight: weight,
                length: length,
                width: width,
                height: height,
                volume: volume,
                inventoryTracking: true
              }
            };

            await productsRef.add(crmProduct);
            totalImported++;
          }
          
          page++;
        } while (page <= pages);
      }

      return { success: true, fetched: totalFetched, imported: totalImported, skipped: totalSkipped };
    } catch (error: any) {
      console.error('syncShoperProducts error:', error);
      throw new HttpsError('internal', error.message);
    }
  }
);

export const getDebugShoper = onRequest(async (req: any, res: any) => {
  try {
    const db = admin.firestore();
    const snap = await db.collection(`companies/UpvMJ68DThYs6ZPDntt4/inventoryStock`).get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((i: any) => i.sku && i.sku.includes('7S'));
    res.json({ count: data.length, items: data });
  } catch(e: any) {
    res.status(500).send(e.message);
  }
});

import { onSchedule } from 'firebase-functions/v2/scheduler';

export const scheduledSyncShoperOrders = onSchedule({
  schedule: 'every 1 minutes',
  timeoutSeconds: 540,
  memory: '512MiB',
  secrets: [encryptionKeyParam]
}, async (event) => {
  const db = admin.firestore();
  const companiesSnap = await db.collection('companies').where('status', '==', 'active').get();

  for (const comp of companiesSnap.docs) {
    const compId = comp.id;
    const integrationsSnap = await db.collection(`companies/${compId}/integrations`)
      .where('type', '==', 'shoper')
      .where('status', '==', 'active')
      .get();
      
    for (const integrationDoc of integrationsSnap.docs) {
      const data = integrationDoc.data();
      if (data.autoSync !== true) continue;
      
      const syncIntervalMs = (data.syncInterval || 5) * 60 * 1000;
      const lastAttemptAt = data.lastAttemptAt?.toMillis() || 0;
      
      if (Date.now() - lastAttemptAt >= syncIntervalMs) {
         try {
            await syncShoperOrders.run({
               data: { companyId: compId, integrationId: integrationDoc.id },
               auth: { uid: 'system_cron' }
            } as any);
         } catch(e) {
            console.error(`Shoper CRON error for ${compId}:`, e);
         }
      }
    }
  }
});
