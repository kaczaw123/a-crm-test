import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";

// Wymagane by operacje w db działały
if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Zapisuje konfigurację Apilo do bazy danych.
 */
export const saveApiloIntegration = functions.https.onCall(async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated.");
  }

  const { companyId, customName, apiUrl, clientId, clientSecret, authCode, isDefault } = request.data;

  if (!companyId || !apiUrl || !clientId || !clientSecret || !authCode) {
    throw new functions.https.HttpsError("invalid-argument", "Missing required fields: companyId, apiUrl, clientId, clientSecret, authCode");
  }

  try {
    const integrationData = {
      orgId: companyId,
      type: "apilo",
      customName: customName || "Apilo",
      status: "active",
      isDefault: isDefault || false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: request.auth.uid,
      syncStatus: "idle",
      apiUrl: apiUrl.trim(),
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      authCode: authCode.trim()
    };

    const docRef = await admin.firestore()
      .collection(`companies/${companyId}/integrations`)
      .add(integrationData);

    // Jeśli to jest default, usuń flagę z innych
    if (isDefault) {
      const snap = await admin.firestore()
        .collection(`companies/${companyId}/integrations`)
        .where("id", "!=", docRef.id)
        .where("isDefault", "==", true)
        .get();

      const batch = admin.firestore().batch();
      snap.forEach(doc => {
        batch.update(doc.ref, { isDefault: false });
      });
      await batch.commit();
    }

    return { success: true, integrationId: docRef.id };
  } catch (error: any) {
    console.error("Error saving Apilo integration:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

/**
 * Testuje połączenie z API Apilo używając podanych kluczy.
 */
export const testApiloIntegration = functions.https.onCall(async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated.");
  }

  const { companyId, integrationId } = request.data;
  if (!companyId || !integrationId) {
    throw new functions.https.HttpsError("invalid-argument", "Missing companyId or integrationId");
  }

  try {
    const docSnap = await admin.firestore()
      .doc(`companies/${companyId}/integrations/${integrationId}`)
      .get();

    if (!docSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Integration not found.");
    }

    const data = docSnap.data();
    if (!data || data.type !== "apilo") {
      throw new functions.https.HttpsError("invalid-argument", "Integration is not Apilo type.");
    }

    const { apiUrl, clientId, clientSecret, authCode, refreshToken } = data;

    if (!apiUrl || !clientId || !clientSecret) {
      throw new functions.https.HttpsError("failed-precondition", "Missing API credentials in integration doc.");
    }

    if (!authCode && !refreshToken) {
      throw new functions.https.HttpsError("failed-precondition", "Missing authCode or refreshToken.");
    }

    // Wykonanie żądania autoryzacyjnego do Apilo
    const tokenUrl = `${apiUrl.replace(/\/$/, '')}/rest/auth/token/`;
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    // Budujemy body do autoryzacji
    const bodyParams: any = {};
    if (authCode) {
      bodyParams.grantType = "authorization_code";
      bodyParams.token = authCode;
    } else if (refreshToken) {
      bodyParams.grantType = "refresh_token";
      bodyParams.token = refreshToken;
    }
    
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${authHeader}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(bodyParams)
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`Apilo API Error [${response.status}]:`, errBody);
      return { success: false, error: `Błąd autoryzacji Apilo. Sprawdź poprawność danych. Kod: ${response.status}` };
    }

    const tokenData = await response.json();
    if (!tokenData.accessToken) {
      return { success: false, error: "Brak tokenu w odpowiedzi Apilo." };
    }

    // Aktualizacja statusu
    const updates: any = {
      lastTestAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSuccessAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "active"
    };

    if (tokenData.refreshToken) {
      updates.refreshToken = tokenData.refreshToken;
    }
    
    // Usuwamy jednorazowy authCode po udanym użyciu, zastępujemy go refresh_tokenem
    if (authCode) {
      updates.authCode = admin.firestore.FieldValue.delete();
    }

    await admin.firestore()
      .doc(`companies/${companyId}/integrations/${integrationId}`)
      .update(updates);

    return { success: true, message: "Połączono pomyślnie z Apilo." };
  } catch (error: any) {
    console.error("Error testing Apilo integration:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});

/**
 * Pobiera świeży token dostępowy do Apilo używając refreshToken.
 */
async function getApiloAccessToken(integrationData: any, docRef: any) {
  const { apiUrl, clientId, clientSecret, refreshToken } = integrationData;
  if (!refreshToken) throw new Error("Brak refreshToken w integracji Apilo");

  const tokenUrl = `${apiUrl.replace(/\/$/, '')}/rest/auth/token/`;
  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${authHeader}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      grantType: "refresh_token",
      token: refreshToken
    })
  });

  if (!response.ok) {
    throw new Error(`Błąd odświeżania tokena Apilo: ${response.status}`);
  }

  const tokenData = await response.json();
  if (tokenData.refreshToken && tokenData.refreshToken !== refreshToken) {
    await docRef.update({ refreshToken: tokenData.refreshToken, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  }

  return tokenData.accessToken;
}

/**
 * Funkcja wywoływana ręcznie (np. przyciskiem "Pobierz zamówienia") lub z crona.
 */
export const syncApiloOrders = functions.https.onCall(async (request) => {
  if (!request.auth) {
    throw new functions.https.HttpsError("unauthenticated", "User must be authenticated.");
  }

  const { companyId, integrationId } = request.data;
  if (!companyId || !integrationId) {
    throw new functions.https.HttpsError("invalid-argument", "Missing parameters");
  }

  try {
    const docRef = admin.firestore().doc(`companies/${companyId}/integrations/${integrationId}`);
    const docSnap = await docRef.get();

    if (!docSnap.exists) throw new Error("Integration not found");
    const integrationData = docSnap.data() as any;

    const accessToken = await getApiloAccessToken(integrationData, docRef);

    // Incremental fetch logic
    const lastSync = integrationData.lastSuccessfulSyncAt?.toDate() || new Date(Date.now() - 24 * 60 * 60 * 1000); // default 24h back
    const createdAfter = encodeURIComponent(lastSync.toISOString());

    // Pobierz z API
    const apiUrl = `${integrationData.apiUrl.replace(/\/$/, '')}/rest/api/orders/?limit=100&createdAfter=${createdAfter}`;
    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Apilo orders fetch error:", errText);
      throw new Error(`Błąd pobierania zamówień z Apilo: ${response.status}`);
    }

    const apiloData = await response.json();
    const ordersList = apiloData.orders || [];

    let importedCount = 0;
    const batch = admin.firestore().batch();

    for (const apiloOrderStub of ordersList) {
      const orderRef = admin.firestore().collection(`companies/${companyId}/orders`).doc(`apilo_${apiloOrderStub.id}`);
      
      // Fetch details to get delivery address, invoice address, amounts, and media
      let apiloOrder = apiloOrderStub;
      try {
        const detailsUrl = `${integrationData.apiUrl.replace(/\/$/, '')}/rest/api/orders/${apiloOrderStub.id}/`;
        const detailsResp = await fetch(detailsUrl, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Accept": "application/json"
          }
        });
        if (detailsResp.ok) {
          apiloOrder = await detailsResp.json();
        }
      } catch (err) {
        console.warn(`Nie udalo sie pobrac szczegolow zamowienia Apilo ${apiloOrderStub.id}`, err);
      }

      const addr = apiloOrder.addressCustomer || {};
      const buyerName = addr.name || `${addr.firstName || ''} ${addr.lastName || ''}`.trim() || apiloOrder.customerName || 'Nieznany klient';
      const delAddr = apiloOrder.addressDelivery || addr;
      const invAddr = apiloOrder.addressInvoice || null;

      const formatStreet = (a: any) => `${a.streetName || a.street || ''} ${a.streetNumber || ''}`.trim();

      const mappedOrder = {
        orgId: companyId,
        source: "APILO",
        sourceId: String(apiloOrder.id),
        externalOrderId: String(apiloOrder.idExternal || apiloOrder.id),
        orderNumber: `AP-${apiloOrder.id}`,
        status: "new",
        reservationStatus: "none",
        shipmentStatus: "not_ready",
        createdAt: apiloOrder.createdAt ? new Date(apiloOrder.createdAt) : admin.firestore.FieldValue.serverTimestamp(),
        importedAt: admin.firestore.FieldValue.serverTimestamp(),
        integrationId: integrationId,
        
        recipient: {
          firstName: delAddr.firstName || delAddr.name?.split(' ')[0] || addr.firstName || '',
          lastName: delAddr.lastName || delAddr.name?.split(' ').slice(1).join(' ') || addr.lastName || '',
          companyName: delAddr.companyName || delAddr.company || addr.companyName || '',
          phone: delAddr.phone || addr.phone || '',
          email: delAddr.email || addr.email || '',
          address: {
            street: formatStreet(delAddr),
            zipCode: delAddr.zipCode || '',
            city: delAddr.city || '',
            country: delAddr.country || 'PL',
          }
        },
        buyer: {
          name: buyerName,
          email: addr.email || '',
          phone: addr.phone || '',
          firstName: addr.firstName || addr.name?.split(' ')[0] || '',
          lastName: addr.lastName || addr.name?.split(' ').slice(1).join(' ') || '',
          login: apiloOrder.customerLogin || '',
        },
        delivery: {
          address: {
            street: formatStreet(delAddr),
            city: delAddr.city || '',
            zipCode: delAddr.zipCode || '',
            countryCode: delAddr.country || 'PL',
          },
          method: apiloOrder.carrierName || (apiloOrder.carrierId ? `ApiloCarrier_${apiloOrder.carrierId}` : 'kurier'),
          cost: Number(apiloOrder.deliveryCost || 0)
        },
        payment: {
          totalAmount: Number(apiloOrder.originalAmountTotalWithTax || apiloOrder.totalAmount || 0),
          paidAmount: Number(apiloOrder.originalAmountTotalPaid || ((apiloOrder.paymentStatus === 2 || apiloOrder.paymentStatus === 3) ? (apiloOrder.originalAmountTotalWithTax || 0) : 0)),
          currency: apiloOrder.originalCurrency || 'PLN',
          status: (apiloOrder.paymentStatus === 2 || apiloOrder.paymentStatus === 3) ? 'PAID' : 'PENDING',
          type: apiloOrder.paymentType ? String(apiloOrder.paymentType) : '',
          provider: apiloOrder.paymentProvider || ''
        },
        ...(invAddr ? {
          invoiceDetails: {
            name: invAddr.name || `${invAddr.firstName || ''} ${invAddr.lastName || ''}`.trim(),
            companyName: invAddr.companyName || invAddr.company || '',
            vatNumber: invAddr.companyTaxNumber || invAddr.nip || invAddr.vatId || '',
            address: {
              street: formatStreet(invAddr),
              zipCode: invAddr.zipCode || '',
              city: invAddr.city || '',
              country: invAddr.country || 'PL',
            }
          },
          invoice: {
            required: apiloOrder.isInvoice || true,
            companyName: invAddr.companyName || invAddr.company || '',
            taxId: invAddr.companyTaxNumber || invAddr.nip || invAddr.vatId || '',
            address: {
              street: formatStreet(invAddr),
              city: invAddr.city || '',
              zipCode: invAddr.zipCode || '',
              countryCode: invAddr.country || 'PL',
            }
          }
        } : {}),
        items: (apiloOrder.orderItems || []).map((item: any, idx: number) => ({
          id: item.id ? String(item.id) : `apilo-item-${idx}`,
          sku: item.sku || 'UNKNOWN',
          ean: item.ean || '',
          name: item.originalName || item.name || 'Produkt z Apilo',
          quantity: item.quantity || 1,
          qtyOrdered: item.quantity || 1,
          qtyReserved: 0,
          qtyPicked: 0,
          qtyShipped: 0,
          mappingStatus: 'unmapped',
          price: Number(item.originalPriceWithTax || item.price || 0),
          currency: apiloOrder.originalCurrency || 'PLN',
          vat: Number(item.taxRate || item.tax || 23),
          weight: Number(item.weight || 0),
          imageUrl: item.media || ''
        }))
      };

      batch.set(orderRef, mappedOrder, { merge: true });
      importedCount++;
    }

    await batch.commit();

    await docRef.update({
      lastSuccessfulSyncAt: admin.firestore.FieldValue.serverTimestamp(),
      lastAttemptAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, count: importedCount };
  } catch (err: any) {
    console.error("syncApiloOrders Error:", err);
    throw new functions.https.HttpsError("internal", err.message);
  }
});

/**
 * Scheduled CRON job for Apilo
 */
import { onSchedule } from "firebase-functions/v2/scheduler";

export const scheduledSyncApiloOrders = onSchedule({
  schedule: 'every 1 minutes',
  timeoutSeconds: 300,
  memory: '256MiB'
}, async (event) => {
  const db = admin.firestore();
  const companiesSnap = await db.collection('companies').where('status', '==', 'active').get();

  for (const comp of companiesSnap.docs) {
    const compId = comp.id;
    const integrationsSnap = await db.collection(`companies/${compId}/integrations`)
      .where('type', '==', 'apilo')
      .where('status', '==', 'active')
      .get();
      
    for (const integrationDoc of integrationsSnap.docs) {
      const data = integrationDoc.data();
      if (data.autoSync !== true) continue;
      
      const syncIntervalMs = (data.syncInterval || 5) * 60 * 1000;
      const lastAttemptAt = data.lastAttemptAt?.toMillis() || 0;
      
      if (Date.now() - lastAttemptAt >= syncIntervalMs) {
         try {
            await syncApiloOrders.run({
               data: { companyId: compId, integrationId: integrationDoc.id },
               auth: { uid: 'system_cron' }
            } as any);
         } catch(e) {
            console.error(`Apilo CRON error for ${compId}:`, e);
         }
      }
    }
  }
});
