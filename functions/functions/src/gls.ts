import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import { calculateInternalShipmentCost } from './billing/estimateCost';
import axios from 'axios';

const glsEncryptionKey = defineSecret('MASTER_ENCRYPTION_KEY');
export const glsSecrets = [glsEncryptionKey];

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

function getEncryptionKey(): Buffer {
  const keyMatch = glsEncryptionKey.value();
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

const getEndpoint = (sandbox: boolean) => sandbox ? 'https://api-sandbox.gls-group.net/shipit-farm/v1/backend' : 'https://api.gls-group.net/shipit-farm/v1/backend';

async function getOAuthToken(login: string, pass: string, sandbox: boolean) {
    const tokenEndpoint = sandbox ? 'https://api-sandbox.gls-group.net/oauth2/v2/token' : 'https://api.gls-group.net/oauth2/v2/token';
    const authHeader = 'Basic ' + Buffer.from(login + ':' + pass).toString('base64');
    
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');

    const res = await axios.post(tokenEndpoint, params.toString(), {
        headers: {
           'Authorization': authHeader,
           'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    return res.data.access_token;
}

export const saveGlsIntegration = onCall({ secrets: glsSecrets, cors: true }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  
  const { companyId, customName, login, password, contactId, sandboxMode, isDefault } = data;
  if (!companyId || !login || !password || !contactId) {
    throw new HttpsError('invalid-argument', 'Brakujące pola integracji.');
  }

  const memberDoc = await db.collection(`companies/${companyId}/members`).doc(auth.uid).get();
  if (!memberDoc.exists) throw new HttpsError('permission-denied', 'Odmowa dostępu do firmy.');

  try {
    const encLogin = encrypt(login);
    const encPass = encrypt(password);
    const encContact = encrypt(contactId);
    
    const integrationRef = db.collection(`companies/${companyId}/integrations`).doc();
    
    const payload = {
      type: 'gls_de',
      label: 'GLS DE',
      customName: customName || 'GLS Własna',
      status: 'active',
      sandboxMode: Boolean(sandboxMode),
      isDefault: Boolean(isDefault),
      encryptedLogin: encLogin.encryptedData,
      loginIv: encLogin.iv,
      encryptedPassword: encPass.encryptedData,
      passwordIv: encPass.iv,
      encryptedContactId: encContact.encryptedData,
      contactIv: encContact.iv,
      keyVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: auth.uid
    };

    if (isDefault) {
      const snap = await db.collection(`companies/${companyId}/integrations`).where('type', '==', 'gls_de').where('isDefault', '==', true).get();
      const batch = db.batch();
      snap.docs.forEach(d => batch.update(d.ref, { isDefault: false }));
      batch.set(integrationRef, payload);
      await batch.commit();
    } else {
      await integrationRef.set(payload);
    }

    return { success: true, id: integrationRef.id };
  } catch (err: any) {
    throw new HttpsError('internal', `Błąd zapisu integracji GLS: ${err.message}`);
  }
});

export const saveGlobalGlsIntegration = onCall({ secrets: glsSecrets, cors: true }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  
  if (auth.token.role !== 'superadmin' && auth.token.globalRole !== 'superadmin') {
     throw new HttpsError('permission-denied', 'Tylko superadmin może dodawać globalne integracje.');
  }

  const { customName, login, password, contactId, sandboxMode } = data;
  if (!login || !password || !contactId) {
    throw new HttpsError('invalid-argument', 'Brakujące pola integracji.');
  }

  try {
    const encLogin = encrypt(login);
    const encPass = encrypt(password);
    const encContact = encrypt(contactId);
    
    const integrationRef = db.collection('globalIntegrations').doc();
    
    const payload = {
      type: 'gls_de',
      label: 'GLS DE (Broker Globalny)',
      customName: customName || 'GLS DE (Broker)',
      status: 'active',
      sandboxMode: Boolean(sandboxMode),
      encryptedLogin: encLogin.encryptedData,
      loginIv: encLogin.iv,
      encryptedPassword: encPass.encryptedData,
      passwordIv: encPass.iv,
      encryptedContactId: encContact.encryptedData,
      contactIv: encContact.iv,
      keyVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: auth.uid
    };

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
    throw new HttpsError('internal', `Błąd zapisu globalnej integracji GLS: ${err.message}`);
  }
});

export const testGlobalGlsIntegration = onCall({ secrets: glsSecrets, cors: true }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  if (auth.token.role !== 'superadmin' && auth.token.globalRole !== 'superadmin') {
     throw new HttpsError('permission-denied', 'Tylko superadmin.');
  }
  
  const { integrationId } = data;
  const docSnap = await db.collection('globalIntegrations').doc(integrationId).get();
  if (!docSnap.exists) throw new HttpsError('not-found', 'Nie odnaleziono integracji.');
  
  const intData = docSnap.data() as any;
  if (intData.type !== 'gls_de') throw new HttpsError('failed-precondition', 'Niekompatybilny typ integracji.');
  
  try {
    const decLogin = decrypt(intData.encryptedLogin, intData.loginIv);
    const decPass = decrypt(intData.encryptedPassword, intData.passwordIv);
    console.log('Test Global GLS connection for:', decLogin, decPass ? '***' : '');
    
    await getOAuthToken(decLogin, decPass, intData.sandboxMode);
    return { success: true, message: 'Autoryzacja GLS przebiegła pomyślnie!' };
  } catch(err: any) {
    return { success: false, message: `Błąd logowania: ${err.message}` };
  }
});

export const testGlsIntegration = onCall({ secrets: glsSecrets, cors: true }, async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
  const { companyId, integrationId } = data;

  const integrationRef = db.collection(`companies/${companyId}/integrations`).doc(integrationId);
  const docSnap = await integrationRef.get();
  if (!docSnap.exists) throw new HttpsError('not-found', 'Nie odnaleziono integracji.');

  const intData = docSnap.data() as any;
  if (intData.type !== 'gls_de') throw new HttpsError('failed-precondition', 'Niekompatybilny typ integracji.');

  try {
    const decLogin = decrypt(intData.encryptedLogin, intData.loginIv);
    const decPass = decrypt(intData.encryptedPassword, intData.passwordIv);
    console.log('Test GLS connection for:', decLogin, decPass ? '***' : '');
    
    await getOAuthToken(decLogin, decPass, intData.sandboxMode);
    return { success: true, message: 'Autoryzacja GLS przebiegła pomyślnie!' };
  } catch(err: any) {
    return { success: false, message: `Błąd logowania: ${err.message}` };
  }
});

export const deleteGlobalGlsIntegration = onCall({ cors: true }, async (request) => {
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

export const enableGlobalGlsIntegration = onCall({ cors: true }, async (request) => {
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

export const createGlsLabel = onCall({ timeoutSeconds: 60, secrets: glsSecrets, cors: true }, async (request) => {
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
                continue;
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
   let integrationMode: 'own' | 'broker' = 'own';
   let globalIntegrationId: string | null = null;
   let ref1: string | null = null;

   if (integrationSource === 'global') {
      integrationRef = db.collection('globalIntegrations').doc(integrationId);
      integrationMode = 'broker';
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
   const decContactId = decrypt(intData.encryptedContactId, intData.contactIv);

   const endpoint = getEndpoint(intData.sandboxMode);
   console.log('GLS config loaded for endpoint:', endpoint, 'login:', decLogin, 'pass len:', decPass.length, 'contactId:', decContactId);
   
   try {
     const token = await getOAuthToken(decLogin, decPass, intData.sandboxMode);
     
     const shipmentPayload = {
       Shipment: {
          Shipper: {
              ContactID: decContactId,
              AlternativeShipperAddress: {
                 Name1: (sender.name || sender.company || "Sender").substring(0,40),
                 CountryCode: sender.country || "DE",
                 City: (sender.city || "").substring(0,40),
                 ZIPCode: sender.zip,
                 Street: (sender.street || "").substring(0,40),
                 StreetNumber: (sender.streetNumber || "").substring(0,10)
              }
          },
          Consignee: {
              Address: {
                 Name1: (recipient.name || recipient.company || "Recipient").substring(0,40),
                 CountryCode: recipient.country || "DE",
                 City: (recipient.city || "").substring(0,40),
                 ZIPCode: recipient.zip,
                 Street: (recipient.street || "").substring(0,40),
                 StreetNumber: (recipient.streetNumber || "").substring(0,10)
              }
          },
          Product: "PARCEL",
          ShipmentUnit: [
             {
                Weight: parseFloat(parcel.weight) || 1.0
             }
          ]
       },
       PrintingOptions: {
           ReturnLabels: {
               TemplateSet: "NONE",
               LabelFormat: "PDF"
           }
       }
     };

     const endpointUrl = getEndpoint(intData.sandboxMode);
     const res = await axios.post(endpointUrl + '/rs/shipments', shipmentPayload, {
         headers: {
             'Authorization': `Bearer ${token}`,
             'Content-Type': 'application/glsVersion1+json',
             'Accept': 'application/glsVersion1+json'
         }
     });

     const createdShipment = res.data.CreatedShipment;
     if (!createdShipment || !createdShipment.ParcelData || createdShipment.ParcelData.length === 0) {
         throw new Error("Invalid response from GLS: Missing ParcelData");
     }

     const trackingNumber = createdShipment.ParcelData[0].TrackID;
     let base64Label = "";
     
     if (createdShipment.PrintData && createdShipment.PrintData.length > 0) {
         const dataField = createdShipment.PrintData[0].Data;
         if (typeof dataField === 'string') {
             base64Label = dataField;
         } else if (Array.isArray(dataField)) {
             if (typeof dataField[0] === 'number') {
                 // Array of bytes
                 base64Label = Buffer.from(dataField).toString('base64');
             } else {
                 // Array of strings?
                 base64Label = dataField[0];
             }
         } else {
             throw new Error("GLS API returned unknown data type for PrintData");
         }
     } else {
         throw new Error("GLS API did not return label print data.");
     }

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
         const destCountry = (recipient.country || 'DE').toUpperCase();
         const isInternational = destCountry !== 'DE';
         const isB2B = !!(recipient.company && recipient.company.trim().length > 0);
         const costResult = await calculateInternalShipmentCost({
             companyId: companyId,
             carrierId: 'gls_de',
             destCountry: destCountry,
             weight: parcel.weight,
             serviceCode: isInternational ? 'EBP' : 'BP',
             isB2B
         });
         calculatedBilling = {
             totalClientCost: costResult.priceToClient.total,
             currency: costResult.priceToClient.currency,
             pricingSource: costResult.metadata.pricingSource,
             breakdown: costResult.priceToClient.breakdown
         };
     } catch (err) {
         console.warn(`[GLS_DE] Nie udało się wyliczyć kosztu dla ${trackingNumber}:`, err);
     }

     // 2. Zapis Dokumentu Firestore
     const shipmentData: any = {
         companyId: companyId,
         carrier: "gls_de",
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
         addressCheckStatus: "ok",
         sender: sender,
         recipient: recipient,
         parcel: parcel,
         reference: integrationMode === 'broker' ? ref1 : (reference || ""),
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
            carrier: 'gls_de',
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
                 ? `Wysyłka GLS #${trackingNumber}` 
                 : 'Wysyłka GLS manualna',
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
            carrier: 'GLS_DE',
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
             
             const itemsQuery = await db.collection(`companies/${companyId}/orderItems`).where('orderId', '==', orderId).get();
             itemsQuery.forEach(itemDoc => {
                const itemData = itemDoc.data();
                batch.update(itemDoc.ref, { 
                   qtyShipped: itemData.qtyReserved || itemData.qtyOrdered || 0,
                   qtyReserved: 0
                });
             });
             
         } else {
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
            carrier: 'gls_de',
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
        byCarrier: { gls_de: FieldValue.increment(1) },
        byMonth: { [`${yyyy}-${mm}`]: FieldValue.increment(1) }
     }, { merge: true });
     
     await batch.commit();

     return { success: true, trackingNumber, labelStoragePath: filePath, shipmentId: shipmentRef.id, wzId, wzNumber };

   } catch (err: any) {
      console.error("[GLS API ERR]:", err);
      throw new HttpsError('internal', `Wystąpił błąd krytyczny połączenia z GLS: ${err.message}`);
   }
});

export const getGlsTracking = onCall({ timeoutSeconds: 15, secrets: glsSecrets, cors: true }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
    const { trackingNumber } = data;
    if (!trackingNumber) throw new HttpsError('invalid-argument', 'Brak trackingu');
    
    // Simulate tracking
    return { status: 'in_transit', events: [], estimatedDelivery: null };
});

export const cancelGlsShipment = onCall({ secrets: glsSecrets, cors: true }, async (request) => {
    const { auth, data } = request;
    if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');
    const { trackingNumber, integrationId, companyId, isGlobalBroker } = data;
    if (!trackingNumber) throw new HttpsError('invalid-argument', 'Brak trackingu');
    
    let intData: any = null;
    if (isGlobalBroker) {
       const docSnap = await db.collection('globalIntegrations').doc(integrationId).get();
       intData = docSnap.data();
    } else {
       const docSnap = await db.collection(`companies/${companyId}/integrations`).doc(integrationId).get();
       intData = docSnap.data();
    }
    
    if (!intData) throw new HttpsError('not-found', 'Nie odnaleziono integracji.');

    try {
        const decLogin = decrypt(intData.encryptedLogin, intData.loginIv);
        const decPass = decrypt(intData.encryptedPassword, intData.passwordIv);
        const token = await getOAuthToken(decLogin, decPass, intData.sandboxMode);
        const endpointUrl = getEndpoint(intData.sandboxMode);

        await axios.post(endpointUrl + `/rs/shipments/cancel/${trackingNumber}`, {}, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/glsVersion1+json',
                'Accept': 'application/glsVersion1+json'
            }
        });

        return { success: true };
    } catch(err: any) {
        throw new HttpsError('internal', 'Błąd anulowania przesyłki GLS: ' + err.message);
    }
});
