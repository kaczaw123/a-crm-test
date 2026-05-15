import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import { PDFDocument } from 'pdf-lib';
import { calculateInternalShipmentCost } from './billing/estimateCost';

const dhlApiKey = defineSecret('DHL_API_KEY');
const dhlApiSecret = defineSecret('DHL_API_SECRET');
const dhlEncryptionKey = defineSecret('MASTER_ENCRYPTION_KEY');
export const dhlSecrets = [dhlApiKey, dhlApiSecret, dhlEncryptionKey];

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

// Helper AES En/Decryption
function getEncryptionKey(): Buffer {
  const keyMatch = dhlEncryptionKey.value();
  return crypto.createHash('sha256').update(String(keyMatch)).digest();
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

const getEndpoint = (sandbox: boolean) => sandbox ? 'https://api-sandbox.dhl.com' : 'https://api-eu.dhl.com';

const countryMap: Record<string, string> = {
  'DE': 'DEU', 'PL': 'POL', 'AT': 'AUT', 'CH': 'CHE',
  'FR': 'FRA', 'NL': 'NLD', 'BE': 'BEL', 'CZ': 'CZE',
  'SK': 'SVK', 'HU': 'HUN', 'IT': 'ITA', 'ES': 'ESP',
  'DK': 'DNK', 'SE': 'SWE', 'NO': 'NOR', 'FI': 'FIN',
  'GB': 'GBR', 'US': 'USA'
};

const toAlpha3 = (code: string) => countryMap[code] || code;

async function getDhlBearerToken(endpoint: string, login: string, pass: string): Promise<string> {
    console.log('ROPC fields present:', {
      username: !!login,
      password: !!pass, 
      client_id: !!dhlApiKey.value(),
      client_secret: !!dhlApiSecret.value()
    });

    const body = new URLSearchParams({
        grant_type: 'password',
        username: login,
        password: pass,
        client_id: dhlApiKey.value(),
        client_secret: dhlApiSecret.value()
    });

    const res = await fetch(`${endpoint}/parcel/de/account/auth/ropc/v1/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "Brak body błędu");
        throw new Error(`Błąd autoryzacji ROPC: ${res.status} | Szczegóły: ${errText}`);
    }

    const data = await res.json();
    return data.access_token;
}

// ==========================================================
// 1. ZARZĄDZANIE INTEGRACJĄ (Credentials)
// ==========================================================
export const saveDhlIntegration = onCall({ secrets: dhlSecrets, cors: true }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  
  const { companyId, customName, login, password, accountNumber, accountNumberExport, sandboxMode, isDefault } = data;
  if (!companyId || !login || !password || !accountNumber) {
    throw new HttpsError('invalid-argument', 'Brakujące pola integracji.');
  }

  const memberDoc = await db.collection(`companies/${companyId}/members`).doc(auth.uid).get();
  if (!memberDoc.exists) throw new HttpsError('permission-denied', 'Odmowa dostępu do firmy.');

  try {
    const encLogin = encrypt(login);
    const encPass = encrypt(password);
    const encAccount = encrypt(accountNumber);
    
    // Tworzymy unikalne IV dla każdego by zachować maksymalne rygory AES
    const integrationRef = db.collection(`companies/${companyId}/integrations`).doc();
    
    const payload = {
      type: 'dhl_de',
      label: 'DHL DE',
      customName: customName || 'DHL Własna',
      status: 'active',
      sandboxMode: Boolean(sandboxMode),
      isDefault: Boolean(isDefault),
      encryptedLogin: encLogin.encryptedData,
      loginIv: encLogin.iv,
      encryptedPassword: encPass.encryptedData,
      passwordIv: encPass.iv,
      encryptedAccountNumber: encAccount.encryptedData,
      accountIv: encAccount.iv,
      keyVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: auth.uid
    };

    if (accountNumberExport && accountNumberExport.trim()) {
      const encAccountExport = encrypt(accountNumberExport.trim());
      (payload as any).encryptedAccountNumberExport = encAccountExport.encryptedData;
      (payload as any).accountExportIv = encAccountExport.iv;
    }

    if (isDefault) {
      // Oznacz inne jako "nie domyślne" jeśli ta jest domyślna
      const snap = await db.collection(`companies/${companyId}/integrations`).where('type', '==', 'dhl_de').where('isDefault', '==', true).get();
      const batch = db.batch();
      snap.docs.forEach(d => batch.update(d.ref, { isDefault: false }));
      batch.set(integrationRef, payload);
      await batch.commit();
    } else {
      await integrationRef.set(payload);
    }

    return { success: true, id: integrationRef.id };
  } catch (err: any) {
    throw new HttpsError('internal', `Błąd zapisu integracji DHL: ${err.message}`);
  }
});

export const testDhlIntegration = onCall({ secrets: dhlSecrets, cors: true }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  const { companyId, integrationId } = data;

  const integrationRef = db.collection(`companies/${companyId}/integrations`).doc(integrationId);
  const docSnap = await integrationRef.get();
  if (!docSnap.exists) throw new HttpsError('not-found', 'Nie odnaleziono integracji.');

  const intData = docSnap.data() as any;
  if (intData.type !== 'dhl_de') throw new HttpsError('failed-precondition', 'Niekompatybilny typ integracji.');

  try {
    const decLogin = decrypt(intData.encryptedLogin, intData.loginIv);
    const decPass = decrypt(intData.encryptedPassword, intData.passwordIv);
    const endpoint = getEndpoint(intData.sandboxMode);
    
    await getDhlBearerToken(endpoint, decLogin, decPass);
    return { success: true, message: 'Połączono pomyślnie z API REST DHL!' };
  } catch(err: any) {
    return { success: false, message: `Błąd logowania (ROPC): Sprawdź Login GKP / Hasło / Sandbox. Szczegóły: ${err.message}` };
  }
});

export const saveGlobalDhlIntegration = onCall({ secrets: dhlSecrets, cors: true }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  
  if (auth.token.role !== 'superadmin' && auth.token.globalRole !== 'superadmin') {
     throw new HttpsError('permission-denied', 'Tylko superadmin może dodawać globalne integracje.');
  }

  const { customName, login, password, accountNumber, accountNumberExport, sandboxMode } = data;
  if (!login || !password || !accountNumber) {
    throw new HttpsError('invalid-argument', 'Brakujące pola integracji.');
  }

  try {
    const encLogin = encrypt(login);
    const encPass = encrypt(password);
    const encAccount = encrypt(accountNumber);
    
    const integrationRef = db.collection('globalIntegrations').doc();
    
    const payload = {
      type: 'dhl_de',
      label: 'DHL DE (Broker Globalny)',
      customName: customName || 'DHL DE (Broker)',
      status: 'active',
      sandboxMode: Boolean(sandboxMode),
      encryptedLogin: encLogin.encryptedData,
      loginIv: encLogin.iv,
      encryptedPassword: encPass.encryptedData,
      passwordIv: encPass.iv,
      encryptedAccountNumber: encAccount.encryptedData,
      accountIv: encAccount.iv,
      keyVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: auth.uid
    };

    if (accountNumberExport && accountNumberExport.trim()) {
      const encAccountExport = encrypt(accountNumberExport.trim());
      (payload as any).encryptedAccountNumberExport = encAccountExport.encryptedData;
      (payload as any).accountExportIv = encAccountExport.iv;
    }

    await integrationRef.set(payload);

    await db.collection('globalIntegrationsAudit').doc().set({
        integrationId: integrationRef.id,
        action: 'create',
        performedBy: auth.uid,
        performedAt: FieldValue.serverTimestamp(),
        ipAddress: request.rawRequest?.ip || 'unknown'
    });

    return { success: true, id: integrationRef.id };
  } catch (err: any) {
    throw new HttpsError('internal', `Błąd zapisu globalnej integracji DHL: ${err.message}`);
  }
});

export const listGlobalIntegrations = onCall({ cors: true }, async (request) => {
  const { auth } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  
  const isSuperadmin = auth.token.role === 'superadmin' || auth.token.globalRole === 'superadmin';
  
  try {
    const snap = await db.collection('globalIntegrations').get();
    const result: any[] = [];
    
    snap.docs.forEach(doc => {
       const data = doc.data();
       // Tylko superadmin widzi wyłączone integracje
       if (!isSuperadmin && data.status !== 'active') return;
       
       result.push({
          id: doc.id,
          type: data.type,
          customName: data.customName,
          label: data.label,
          status: data.status,
          sandboxMode: data.sandboxMode,
          isDefault: data.isDefault,
          createdAt: data.createdAt
       });
    });
    
    return result;
  } catch(err: any) {
    throw new HttpsError('internal', 'Błąd pobierania globalnych integracji');
  }
});

export const testGlobalDhlIntegration = onCall({ secrets: dhlSecrets, cors: true }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  if (auth.token.role !== 'superadmin' && auth.token.globalRole !== 'superadmin') {
     throw new HttpsError('permission-denied', 'Tylko superadmin.');
  }
  
  const { integrationId } = data;
  const docSnap = await db.collection('globalIntegrations').doc(integrationId).get();
  if (!docSnap.exists) throw new HttpsError('not-found', 'Nie odnaleziono integracji.');
  
  const intData = docSnap.data() as any;
  if (intData.type !== 'dhl_de') throw new HttpsError('failed-precondition', 'Niekompatybilny typ integracji.');
  
  try {
    const decLogin = decrypt(intData.encryptedLogin, intData.loginIv);
    const decPass = decrypt(intData.encryptedPassword, intData.passwordIv);
    const endpoint = getEndpoint(intData.sandboxMode);
    
    await getDhlBearerToken(endpoint, decLogin, decPass);
    return { success: true, message: 'Połączono pomyślnie z API REST DHL (Global)!' };
  } catch(err: any) {
    return { success: false, message: `Błąd logowania: ${err.message}` };
  }
});

export const deleteGlobalDhlIntegration = onCall({ cors: true }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  if (auth.token.role !== 'superadmin' && auth.token.globalRole !== 'superadmin') {
     throw new HttpsError('permission-denied', 'Tylko superadmin.');
  }
  
  const { integrationId } = data;
  try {
     await db.collection('globalIntegrations').doc(integrationId).update({
        status: 'disabled'
     });
     
     await db.collection('globalIntegrationsAudit').doc().set({
        integrationId: integrationId,
        action: 'disable',
        performedBy: auth.uid,
        performedAt: FieldValue.serverTimestamp(),
        ipAddress: request.rawRequest?.ip || 'unknown'
    });
    
    return { success: true };
  } catch(err: any) {
     throw new HttpsError('internal', 'Błąd podczas usuwania integracji');
  }
});

export const enableGlobalDhlIntegration = onCall({ cors: true }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  if (auth.token.role !== 'superadmin' && auth.token.globalRole !== 'superadmin') {
     throw new HttpsError('permission-denied', 'Tylko superadmin.');
  }
  
  const { integrationId } = data;
  try {
     await db.collection('globalIntegrations').doc(integrationId).update({
        status: 'active'
     });
     
     await db.collection('globalIntegrationsAudit').doc().set({
        integrationId: integrationId,
        action: 'enable',
        performedBy: auth.uid,
        performedAt: FieldValue.serverTimestamp(),
        ipAddress: request.rawRequest?.ip || 'unknown'
    });
    
    return { success: true };
  } catch(err: any) {
     throw new HttpsError('internal', 'Błąd podczas aktywacji integracji');
  }
});

// ==========================================================
// 2. ETYKIETY I WYSYŁKA
// ==========================================================
export const createDhlLabel = onCall({ timeoutSeconds: 60, secrets: dhlSecrets, cors: true }, async (request) => {
   const { auth, data } = request;
   if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
   
   const { companyId, integrationId, sender: reqSender, recipient, parcel, reference, products, orderId } = data;
   
   type ProductItem = {
      productId: string;
      warehouseId: string;
      sku: string;
      ean: string;
      name: string;
      issuedQty: number;
   };
   const productList: ProductItem[] = products || [];

   console.log('Products received:', JSON.stringify(productList));

   const companyDoc = await db.collection('companies').doc(companyId).get();
   const companyData = companyDoc.data() || {};
   const deductionMode = companyData.settings?.inventoryDeductionMode || 'on_label';

   // Get order active reservations
   const orderReservations: any[] = [];
   if (orderId && deductionMode === 'on_label') {
      const resDocs = await db.collection(`companies/${companyId}/stockReservations`)
         .where('orderId', '==', orderId)
         .where('status', '==', 'active')
         .get();
      resDocs.forEach(d => orderReservations.push({ id: d.id, ...d.data() }));
   }

   if (productList.length > 0) {
      let defaultWarehouseId: string | null = null;
      for (const product of productList) {
         if (!product.warehouseId) {
            if (!defaultWarehouseId) {
                const warehouseSnap = await db
                  .collection(`companies/${companyId}/warehouses`)
                  .where('isDefault', '==', true)
                  .limit(1)
                  .get();
                defaultWarehouseId = warehouseSnap.docs[0]?.id || '';
            }
            product.warehouseId = defaultWarehouseId;
         }

         const stockId = `${product.productId}_${product.warehouseId}`;
         const stockRef = db.collection(`companies/${companyId}/inventoryStock`).doc(stockId);
         const stockSnap = await stockRef.get();
    
         if (!stockSnap.exists) {
            if (deductionMode === 'on_label') {
                throw new HttpsError('failed-precondition', `Produkt ${product.sku} nie posiada stanów w magazynie (ID: ${product.warehouseId}).`);
            } else {
                continue; // Jeśli on_pack, nie blokujemy DHL z powodu braku wirtualnego stoku, bo stok zdjęty zostanie przy pakowaniu
            }
         }
         
         if (deductionMode === 'on_label') {
             const resDoc = orderReservations.find(r => r.productId === product.productId && r.locationId === product.warehouseId);
             
             if (resDoc) {
                 const qtyReserved = resDoc.qtyReserved || 0;
                 if (qtyReserved < product.issuedQty) {
                     throw new HttpsError('failed-precondition', `Niewystarczająca rezerwacja dla ${product.sku}. Zarezerwowano: ${qtyReserved}, wymagane: ${product.issuedQty}`);
                 }
                 (product as any).reservationId = resDoc.id;
             } else {
                 const qtyAvailable = stockSnap.data()?.qtyAvailable || 0;
                 if (qtyAvailable < product.issuedQty) {
                    throw new HttpsError('failed-precondition', `Niewystarczający stan dla ${product.sku}. Dostępne: ${qtyAvailable}, wymagane: ${product.issuedQty}`);
                 }
             }
         }
      }
   }   
   const sender = reqSender || {
       company: companyData?.name || "Gepard Logistics",
       name: companyData?.name || "Gepard Logistics",
       street: "Johannes-R.-Becher-Straße",
       streetNumber: "29",
       zip: "02827",
       city: "Görlitz",
       country: "DE"
   };
   
   const integrationSource = data.integrationSource || (data.isGlobalBroker ? 'global' : 'own');
   const shipmentRef = db.collection(`companies/${companyId}/shipments`).doc();
   const shipmentId = shipmentRef.id;

   let integrationRef;
   let integrationMode: 'own' | 'gkp' = 'own';
   let globalIntegrationId: string | null = null;
   let ref1: string | null = null;

   if (integrationSource === 'global') {
      integrationRef = db.collection('globalIntegrations').doc(integrationId);
      integrationMode = 'gkp';
      globalIntegrationId = integrationId;
      ref1 = `GEP-${companyId.substring(0, 8)}-${shipmentId.substring(0, 12)}`;
   } else {
      integrationRef = db.collection(`companies/${companyId}/integrations`).doc(integrationId);
   }
   
   const docSnap = await integrationRef.get();
   if (!docSnap.exists) throw new HttpsError('not-found', 'Integration doc not found.');
   const intData = docSnap.data() as any;

   const decLogin = decrypt(intData.encryptedLogin, intData.loginIv);
   const decPass = decrypt(intData.encryptedPassword, intData.passwordIv);
   const decAccount = decrypt(intData.encryptedAccountNumber, intData.accountIv);
   
   let decAccountExport = null;
   if (intData.encryptedAccountNumberExport && intData.accountExportIv) {
       decAccountExport = decrypt(intData.encryptedAccountNumberExport, intData.accountExportIv);
   }

   const endpoint = getEndpoint(intData.sandboxMode);
   
   try {
     const token = await getDhlBearerToken(endpoint, decLogin, decPass);
     
     const rCountry = (recipient.country || 'DE').toUpperCase();
     const isDomestic = rCountry === 'DE' || rCountry === 'DEU';
     const dhlProduct = isDomestic ? "V01PAK" : "V53WPAK";
     let finalBilling = '';
     
     if (isDomestic) {
         finalBilling = decAccount;
     } else {
         if (decAccountExport) {
             finalBilling = decAccountExport.replace(/\s+/g, '');
         } else {
             const cleanBill = decAccount.replace(/\s+/g, '');
             if (cleanBill.length >= 12) {
                finalBilling = cleanBill.substring(0, 10) + '53' + cleanBill.substring(12);
             } else {
                finalBilling = cleanBill;
             }
         }
     }

     const payload = {
        profile: "STANDARD_GRUPPENPROFIL",
        shipments: [
           {
              product: dhlProduct,
              billingNumber: finalBilling,
              shipDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date()),
              customerReference: integrationMode === 'gkp' ? ref1 : (reference || undefined),
              shipper: {
                 name1: sender?.company || sender?.name || "Gepard Logistics",
                 addressStreet: sender?.street || "Johannes-R.-Becher-Straße",
                 addressHouse: sender?.streetNumber || "29",
                 postalCode: sender?.zip || "02827",
                 city: sender?.city || "Görlitz",
                 country: sender?.country ? toAlpha3(sender.country) : "DEU"
              },
              consignee: {
                 name1: recipient.company || recipient.name,
                 addressStreet: recipient.street,
                 addressHouse: recipient.streetNumber || "",
                 postalCode: recipient.zip,
                 city: recipient.city,
                 country: toAlpha3(recipient.country || 'DE'),
                 email: recipient.email || undefined
              },
              details: {
                 weight: { uom: "g", value: Math.round(parcel.weight * 1000) },
                 contents: data.contents || undefined
              }
           }
        ]
     };

     if (parcel.width && parcel.height && parcel.length) {
       (payload.shipments[0].details as any).dim = {
         uom: "cm", width: parcel.width, length: parcel.length, height: parcel.height
       };
     }

     console.log('SENDING TO DHL PAYLOAD:', JSON.stringify(payload));

     const res = await fetch(`${endpoint}/parcel/de/shipping/v2/orders`, {
       method: 'POST',
       headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
       },
       body: JSON.stringify(payload)
     });
     
     const resultJson = await res.json();
     console.log('DHL response:', JSON.stringify(resultJson));
     
     if (resultJson.status?.statusCode !== 200 || resultJson.status?.validationState === 'Error') {
         throw new Error(JSON.stringify(resultJson));
     }

     if (!resultJson?.items?.[0]) {
       throw new HttpsError('internal', 
         'Nieoczekiwana odpowiedź DHL: ' + JSON.stringify(resultJson));
     }
     const trackingNumber = resultJson.items[0].shipmentNo;
     const base64Label = resultJson.items[0].label?.b64;
     
     // 1. Zapis etykiety PDF w Firebase Storage
     const dateObj = new Date();
     const yyyy = dateObj.getFullYear();
     const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
     
     const pdfBuffer = Buffer.from(base64Label, 'base64');
     const bucket = storage.bucket();
     const filePath = `shipments/${companyId}/${yyyy}/${mm}/${trackingNumber}.pdf`;
     const fileRef = bucket.file(filePath);
     
     await fileRef.save(pdfBuffer, {
         metadata: { contentType: 'application/pdf' },
         public: false
     });
     
     // Obliczenie ceny systemowej do zapisania w bazie
     let calculatedBilling: any = null;
     try {
         const isB2B = !!(recipient.company && recipient.company.trim().length > 0);
         const costResult = await calculateInternalShipmentCost({
             companyId: companyId,
             carrierId: 'dhl_at', // Mapowanie dhl_de -> dhl_at
             destCountry: recipient.country || 'DE',
             weight: parcel.weight,
             serviceCode: 'STANDARD',
             isB2B
         });
         calculatedBilling = {
             totalClientCost: costResult.priceToClient.total,
             currency: costResult.priceToClient.currency,
             pricingSource: costResult.metadata.pricingSource,
             breakdown: costResult.priceToClient.breakdown
         };
     } catch (err) {
         console.warn(`[DHL_DE] Nie udało się wyliczyć kosztu dla ${trackingNumber}:`, err);
     }

     // 2. Zapis Dokumentu Firestore
     const shipmentData: any = {
         companyId: companyId,
         carrier: "dhl_de",
         integrationMode,
         globalIntegrationId,
         ref1,
         integrationId: integrationId,
         isGlobalBroker: integrationSource === 'global',
         brokerId: integrationSource === 'global' ? integrationId : null,
         orderId: orderId || null,
         sandboxMode: intData.sandboxMode,
         trackingNumber: trackingNumber,
         labelStoragePath: filePath,
         status: "created",
         addressCheckStatus: "ok", // lub unknown
         sender: sender,
         recipient: recipient,
         parcel: parcel,
         reference: reference || "",
         contents: data.contents || "",
         searchTokens: [
               trackingNumber.toLowerCase(), 
               recipient.name?.toLowerCase(), 
               recipient.city?.toLowerCase(),
               sender.name?.toLowerCase()
         ].filter(Boolean),
         billing: calculatedBilling,
         createdAt: FieldValue.serverTimestamp(),
         createdBy: auth.uid
     };

     const batch = db.batch();
     
     let wzId: string | null = null;
     let wzNumber: string | null = null;

     if (productList.length > 0 && deductionMode === 'on_label') {
         const now = FieldValue.serverTimestamp();
         const wzRef = db.collection(`companies/${companyId}/outboundShipments`).doc();
         wzId = wzRef.id;

         const wzStatsRef = db.collection(`companies/${companyId}/stats`).doc('outbound');
         const wzStatsSnap = await wzStatsRef.get();
         const wzCount = (wzStatsSnap.data()?.total || 0) + 1;
         wzNumber = `WZ/${yyyy}/${String(wzCount).padStart(4, '0')}`;

         batch.set(wzRef, {
            documentNumber: wzNumber,
            status: 'completed',
            type: 'shipment',
            carrier: 'dhl_de',
            trackingNumber,
            shipmentId: shipmentRef.id,
            recipient,
            itemsCount: productList.length,
            totalIssuedQty: productList.reduce((sum, p) => sum + p.issuedQty, 0),
            reference: reference || '',
            referenceId: orderId || null,
            referenceType: orderId ? 'ORDER_SHIPMENT' : 'MANUAL',
            createdAt: now,
            createdBy: auth.uid
         });

         batch.set(wzStatsRef, { total: FieldValue.increment(1) }, { merge: true });

         for (const product of productList) {
            const itemRef = wzRef.collection('items').doc();
            batch.set(itemRef, {
               productId: product.productId,
               sku: product.sku,
               ean: product.ean || '',
               name: product.name,
               issuedQty: product.issuedQty,
               warehouseId: product.warehouseId
            });

            const stockId = `${product.productId}_${product.warehouseId}`;
            const stockRef = db.collection(`companies/${companyId}/inventoryStock`).doc(stockId);
            
            if ((product as any).reservationId) {
                batch.update(stockRef, {
                   qtyOnHand: FieldValue.increment(-product.issuedQty),
                   qtyReserved: FieldValue.increment(-product.issuedQty)
                });
                
                const resDocRef = db.collection(`companies/${companyId}/stockReservations`).doc((product as any).reservationId);
                batch.update(resDocRef, { status: 'shipped' });
                
            } else {
                batch.update(stockRef, {
                   qtyOnHand: FieldValue.increment(-product.issuedQty),
                   qtyAvailable: FieldValue.increment(-product.issuedQty)
                });
            }

            const movRef = db.collection(`companies/${companyId}/inventoryMovements`).doc();
            batch.set(movRef, {
               type: 'ISSUE',
               productId: product.productId,
               locationId: product.warehouseId,
               qty: -product.issuedQty,
               referenceId: orderId || wzRef.id,
               referenceType: orderId ? 'ORDER_SHIPMENT' : 'MANUAL',
               trackingNumber: trackingNumber,
               note: orderId 
                 ? `Wysyłka DHL #${trackingNumber}` 
                 : 'Wysyłka DHL manualna',
               createdAt: now,
               createdBy: auth.uid
            });
         }
     }

      if (orderId) {
         const orderRef = db.collection(`companies/${companyId}/orders`).doc(orderId);
         
         const commonUpdate: any = {
            trackingNumber: trackingNumber,
            labelStoragePath: filePath,
            hasLabel: true,
            carrier: 'DHL_DE',
            updatedAt: FieldValue.serverTimestamp()
         };
         
         if (deductionMode === 'on_label') {
             batch.update(orderRef, {
                ...commonUpdate,
                wzId: wzId,
                shippingStatus: 'shipped',
                shipmentStatus: 'confirmed',
                shippedAt: FieldValue.serverTimestamp()
             });
             
             // Update orderItems shipped items to sync UI
             const itemsQuery = await db.collection(`companies/${companyId}/orderItems`).where('orderId', '==', orderId).get();
             itemsQuery.forEach(itemDoc => {
                const itemData = itemDoc.data();
                batch.update(itemDoc.ref, { 
                   qtyShipped: itemData.qtyReserved || itemData.qtyOrdered || 0,
                   qtyReserved: 0
                });
             });
             
         } else {
             // on_pack
             batch.update(orderRef, {
                ...commonUpdate,
                shippingStatus: 'label_created'
             });
         }

         const logRef = db.collection(`companies/${companyId}/orderActivityLogs`).doc();
         batch.set(logRef, {
            orgId: companyId,
            orderId: orderId,
            action: 'LABEL_GENERATED',
            operatorId: auth.uid,
            trackingNumber: trackingNumber,
            carrier: 'dhl_de',
            timestamp: FieldValue.serverTimestamp()
         });
      }

      const finalShipmentData: any = { ...shipmentData };
     if (wzId && wzNumber) {
         finalShipmentData.wzId = wzId;
         finalShipmentData.wzNumber = wzNumber;
     }
     
     batch.set(shipmentRef, finalShipmentData);
     
     // 3. Increment counters
     const statsRef = db.collection(`companies/${companyId}/stats`).doc('shipments');
     batch.set(statsRef, {
        total: FieldValue.increment(1),
        byStatus: { created: FieldValue.increment(1) },
        byCarrier: { dhl_de: FieldValue.increment(1) },
        byMonth: { [`${yyyy}-${mm}`]: FieldValue.increment(1) }
     }, { merge: true });
     
     await batch.commit();

     return { success: true, trackingNumber, labelStoragePath: filePath, shipmentId: shipmentRef.id, wzId, wzNumber };

   } catch (err: any) {
      console.error("[DHL API ERR]:", err);
      throw new HttpsError('internal', `Wystąpił błąd krytyczny połączenia z DHL: ${err.message}`);
   }
});

export const getDhlTracking = onCall({ timeoutSeconds: 15, secrets: dhlSecrets, cors: true }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
    const { trackingNumber } = data;
    if (!trackingNumber) throw new HttpsError('invalid-argument', 'Brak trackingu');
    
    // 1. Znajdź paczkę w bazie aby zdobyć klucze
    const snap = await db.collectionGroup('shipments').where('trackingNumber', '==', trackingNumber).limit(1).get();
    if (snap.empty) throw new HttpsError('not-found', 'Przepraszamy, nie odnaleziono powiązanej przesyłki w systemie.');
    
    const shipNode = snap.docs[0];
    const finalCompanyId = shipNode.ref.parent.parent?.id;
    const finalIntegrationId = shipNode.data().integrationId;
    
    const intDoc = await db.collection(`companies/${finalCompanyId}/integrations`).doc(finalIntegrationId).get();
    if (!intDoc.exists) throw new HttpsError('not-found', 'Brak aktywnej integracji DHL.');
    const intData = intDoc.data() as any;
    
    const decLogin = decrypt(intData.encryptedLogin, intData.loginIv);
    const decPass = decrypt(intData.encryptedPassword, intData.passwordIv);
    const endpoint = getEndpoint(intData.sandboxMode);
    
    const xmlPayload = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<data appname="${decLogin}" language-code="de" password="${decPass}" piece-code="${trackingNumber}" request="d-get-piece-detail"/>`;

    const bAuth = Buffer.from(`${dhlApiKey.value()}:${dhlApiSecret.value()}`).toString('base64');
    
    try {
        const res = await fetch(`${endpoint}/parcel/de/tracking/v0/shipments?xml=${encodeURIComponent(xmlPayload)}`, {
            headers: { "Authorization": `Basic ${bAuth}` }
        });
        
        if (!res.ok) {
           return { status: 'in_transit', events: [], estimatedDelivery: null };
        }
        
        const textData = await res.text();
        
        let mappedStatus = 'in_transit';
        if (textData.includes('delivered') || textData.includes('zugestellt')) mappedStatus = 'delivered';
        
        return { 
           status: mappedStatus, 
           events: [], 
           estimatedDelivery: null 
        };
    } catch(err: any) {
        throw new HttpsError('internal', `Tracking Error: ${err.message}`);
    }
});

export const verifyDhlAddress = onCall({ secrets: dhlSecrets, cors: true }, async (request) => {
   const { auth, data } = request;
   if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
   
   const { companyId, integrationId, address, postalCode, country } = data;
   // fallback compatibility with old address object or new direct fields
   const reqZip = postalCode || address?.zip || "00000";
   const reqCountry = country || address?.country || 'DE';

   if (!integrationId || !reqZip) return { valid: true, suggestion: null, suggestions: [] };
   
   const integrationRef = db.collection(`companies/${companyId}/integrations`).doc(integrationId);
   const docSnap = await integrationRef.get();
   if (!docSnap.exists) return { valid: true, suggestion: null, suggestions: [] };
   const intData = docSnap.data() as any;
   const endpoint = getEndpoint(intData.sandboxMode);
   
   try {
       const res = await fetch(
         `${endpoint}/location-finder/v1/find-by-address?countryCode=${reqCountry}&postalCode=${reqZip}`,
         {
           headers: {
             'DHL-API-Key': dhlApiKey.value(),
             'Accept': 'application/json'
           }
         }
       );
       
       const result = await res.json();
       console.log('DHL location raw:', JSON.stringify(result));

       const cities = [...new Set(
         result.locations?.map((l: any) => l.place?.address?.addressLocality) || []
       )].filter(Boolean) as string[];

       return { valid: cities.length > 0, suggestions: cities, suggestion: null };
   } catch (err: any) {
       console.error("DHL ADDR VERIFICATION ERR:", err);
       return { valid: true, suggestion: null, suggestions: [] };
   }
});

export const cancelDhlShipment = onCall({ secrets: dhlSecrets, cors: true }, async (request) => {
   const { auth, data } = request;
   if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
   const { companyId, shipmentId } = data;
   if (!companyId || !shipmentId) throw new HttpsError('invalid-argument', 'Puste ID.');
   
   const docRef = db.collection(`companies/${companyId}/shipments`).doc(shipmentId);
   const docSnap = await docRef.get();
   if (!docSnap.exists) throw new HttpsError('not-found', 'Shipment not found');
   const shipData = docSnap.data();

   if (!shipData?.integrationId) {
       // To przesyłka z zewnątrz (np. zaimportowana z Arkusza). 
       // Nie możemy jej anulować przez API, więc po prostu usuwamy rekord z naszej bazy.
       await docRef.update({
           status: 'cancelled',
           cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
           cancelledBy: auth.uid
       });
       return { success: true, message: 'Usunięto zewnętrzny rekord przesyłki.' };
   }

   try {
     const batch = db.batch();
     batch.update(docRef, { status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });
     
     const dateObj = shipData?.createdAt?.toDate ? shipData.createdAt.toDate() : new Date();
     const yMo = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
     
     const statsRef = db.collection(`companies/${companyId}/stats`).doc('shipments');
     batch.set(statsRef, {
          byStatus: { 
              created: FieldValue.increment(-1),
              cancelled: FieldValue.increment(1) 
          },
          byMonth: {
              [yMo]: FieldValue.increment(-1)
          }
     }, { merge: true });
     
     await batch.commit();
     
     return { success: true, message: 'Etykieta została anulowana w systemie lokalnym A-CMR.' };
   } catch(e: any) {
     throw new HttpsError('internal', `Wystąpił błąd przy anulowaniu etykiety: ${e.message}`);
   }
});

// ==========================================================
// 3. MERGE, DRUKOWANIE ZBIORCZE i CLEANUP
// ==========================================================

export const mergeDhlLabels = onCall({ memory: "1GiB", timeoutSeconds: 120, cors: true }, async (request) => {
   const { auth, data } = request;
   if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
   
   const { companyId, shipmentIds } = data;
   if (!companyId || !Array.isArray(shipmentIds)) throw new HttpsError('invalid-argument', 'Brak parametrów.');
   
   if (shipmentIds.length > 100) {
      throw new HttpsError('failed-precondition', 'Maksymalnie 100 etykiet w jednym wydruku.');
   }
   if (shipmentIds.length === 0) {
      throw new HttpsError('invalid-argument', 'Zaznacz min. 1 list.');
   }

   try {
     const bucket = storage.bucket();
     const mergedPdf = await PDFDocument.create();

     // Dla uproszczenia strzałów bazy dzielimy na chunki po 10 gdybyśmy używali 'in', lub uderzamy pojedynczym .getAll()
     const refs = shipmentIds.map(id => db.collection(`companies/${companyId}/shipments`).doc(id));
     const docs = await db.getAll(...refs);
     
     const paths = docs.map(d => d.data()?.labelStoragePath).filter(Boolean);
     
     if (paths.length === 0) throw new Error("Te obiekty nie posiadają załączonych PDFów.");

     for (const p of paths) {
        const file = bucket.file(p);
        const [exists] = await file.exists();
        if (exists) {
           const [buffer] = await file.download();
           const pdfDoc = await PDFDocument.load(buffer);
           const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
           copiedPages.forEach(page => mergedPdf.addPage(page));
        }
     }

     const finalPdfBytes = await mergedPdf.save();
     const batchId = `BATCH_PRINT_${Date.now()}_${auth.uid}`;
     const tempPath = `temp/${companyId}/batch-print/${batchId}.pdf`;
     
     const finalFile = bucket.file(tempPath);
     const downloadToken = crypto.randomUUID();
     
     await finalFile.save(Buffer.from(finalPdfBytes), {
         metadata: { 
             contentType: 'application/pdf',
             metadata: {
                 firebaseStorageDownloadTokens: downloadToken
             }
         },
         public: false
     });

     const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(tempPath)}?alt=media&token=${downloadToken}`;

     return { success: true, signedUrl: url, url: url };

   } catch(e: any) {
      console.error("Błąd generacji PDF zbiorczego:", e);
      throw new HttpsError('internal', `Główny błąd łączenia PDF: ${e.message}`);
   }
});

export const cleanupTempLabels = onSchedule('0 * * * *', async (event) => {
    // Harmonogram uruchamia się o pełnej godzinie.
    // Usunięcie starych PDF do kosza z całego bucketa 'temp/*/*/batch-print/'
    const bucket = storage.bucket();
    // Szukamy prefiksu temp/
    const [files] = await bucket.getFiles({ prefix: 'temp/' });
    const now = Date.now();
    
    let deleted = 0;
    for (const f of files) {
       // Jeśli plik zawiera 'batch-print' i jest starszy niż 1 godzina 
       if (f.name.includes('batch-print/')) {
           const [metadata] = await f.getMetadata();
           const timeStr = metadata.timeCreated;
           if (!timeStr) continue;
           const timeCreated = new Date(timeStr).getTime();
           if (now - timeCreated > 60 * 60 * 1000) { // starszy niz godzina
               await f.delete().catch(()=>null);
               deleted++;
           }
       }
    }
    console.log(`[cleanupTempLabels] Usunięto ${deleted} starych plików wydruku tymczasowego.`);
});

export const archiveOldShipments = onSchedule('0 0 1 * *', async (event) => {
   const cutoffDate = new Date();
   cutoffDate.setFullYear(cutoffDate.getFullYear() - 1); // 12 miesięcy wstecz
   
   const companiesSnap = await db.collection('companies').get();
   for (const cmp of companiesSnap.docs) {
       const companyId = cmp.id;
       const oldShipmentsSnap = await db.collection(`companies/${companyId}/shipments`)
            .where('createdAt', '<', Timestamp.fromDate(cutoffDate))
            .limit(500) // limit for safety in single run or use pagination if needed
            .get();
            
       if (oldShipmentsSnap.empty) continue;
       
       const batch = db.batch();
       oldShipmentsSnap.docs.forEach(docSnap => {
           const archiveRef = db.collection(`companies/${companyId}/shipmentsArchive`).doc(docSnap.id);
           batch.set(archiveRef, docSnap.data());
           batch.delete(docSnap.ref);
       });
       
       await batch.commit();
       console.log(`[archiveOldShipments] Zarchiwizowano ${oldShipmentsSnap.size} przesyłek dla firmy ${companyId}.`);
   }
});
