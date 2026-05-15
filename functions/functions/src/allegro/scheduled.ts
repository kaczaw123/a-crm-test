import { onSchedule } from "firebase-functions/v2/scheduler";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { PubSub } from "@google-cloud/pubsub";
import { defineSecret } from "firebase-functions/params";
import { getApiUrl, getValidAllegroToken, allegroFetch } from "./helpers";

const encryptionKey = defineSecret("MASTER_ENCRYPTION_KEY");
const allegroClientId = defineSecret("ALLEGRO_CLIENT_ID");
const allegroClientSecret = defineSecret("ALLEGRO_CLIENT_SECRET");

const TOPIC_NAME = "allegro-sync";

// ============================================
// DISPATCHER — co 1 minutę
// ============================================
export const scheduledAllegroDispatcher = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "Europe/Warsaw",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (event) => {
    const startTime = Date.now();
    console.log("=== ALLEGRO DISPATCHER START ===");
    
    const db = getFirestore();
    const pubsub = new PubSub();
    const topic = pubsub.topic(TOPIC_NAME);
    
    const now = new Date();
    
    let dispatched = 0;
    
    // Pobierz wszystkie firmy
    const companiesSnapshot = await db.collection("companies").get();
    
    for (const companyDoc of companiesSnapshot.docs) {
      const companyId = companyDoc.id;
      
      // Pobierz aktywne integracje Allegro
      const integrationsSnapshot = await db
        .collection("companies")
        .doc(companyId)
        .collection("integrations")
        .where("type", "==", "allegro")
        .where("status", "==", "active")
        .get();
      
      for (const integrationDoc of integrationsSnapshot.docs) {
        const integration = integrationDoc.data();
        
        if (integration.autoSync !== true) continue;
        
        const syncIntervalMs = (integration.syncInterval || 5) * 60 * 1000;
        const lastSyncAt = integration.lastSyncAt?.toMillis() || 0;
        
        // Sprawdź czy wymaga synca
        if (Date.now() - lastSyncAt < syncIntervalMs) {
          continue;  // Za wcześnie
        }
        
        // Publikuj task do Pub/Sub
        const message = {
          companyId,
          integrationId: integrationDoc.id,
          timestamp: now.toISOString(),
        };
        
        await topic.publishMessage({
          data: Buffer.from(JSON.stringify(message)),
        });
        
        dispatched++;
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`=== DISPATCHER COMPLETE: ${dispatched} tasks, ${duration}ms ===`);
  }
);

// ============================================
// WORKER — przetwarzanie pojedynczej integracji
// ============================================
export const processAllegroSync = onMessagePublished(
  {
    topic: TOPIC_NAME,
    secrets: [encryptionKey, allegroClientId, allegroClientSecret],
    timeoutSeconds: 60,
    memory: "512MiB",
    // Retry configuration
    retry: true,
  },
  async (event) => {
    const message = event.data.message;
    const data = JSON.parse(Buffer.from(message.data, "base64").toString());
    
    const { companyId, integrationId } = data;
    console.log(`[WORKER] Start: ${companyId}/${integrationId}`);
    
    const startTime = Date.now();
    const db = getFirestore();
    
    try {
      // Pobierz integrację
      const integrationRef = db
        .collection("companies")
        .doc(companyId)
        .collection("integrations")
        .doc(integrationId);
      
      const integrationSnap = await integrationRef.get();
      
      if (!integrationSnap.exists) {
        console.log(`[WORKER] Integracja nie istnieje, pomijam`);
        return;
      }
      
      const integration = integrationSnap.data()!;
      
      if (integration.status !== "active") {
        console.log(`[WORKER] Integracja nieaktywna, pomijam`);
        return;
      }
      
      // Wykonaj sync
      const result = await syncAllegroOrders(companyId, integrationId, integration);
      
      const duration = Date.now() - startTime;
      console.log(`[WORKER] Done: +${result.imported}, ~${result.updated}, ${duration}ms`);
      
    } catch (error) {
      console.error(`[WORKER] Error:`, error);
      
      // Zapisz błąd
      await db
        .collection("companies")
        .doc(companyId)
        .collection("integrations")
        .doc(integrationId)
        .update({
          lastSyncError: error instanceof Error ? error.message : "Unknown error",
          lastSyncErrorAt: FieldValue.serverTimestamp(),
        });
      
      // Re-throw żeby Pub/Sub mógł retry
      throw error;
    }
  }
);

// ============================================
// SYNC LOGIC — pobieranie zamówień
// ============================================
async function syncAllegroOrders(
  companyId: string,
  integrationId: string,
  integration: any
): Promise<{ imported: number; updated: number }> {
  const db = getFirestore();
  
  const sandbox = integration.settings?.sandboxMode || false;
  const apiUrl = getApiUrl(sandbox);
  
  // Pobierz od lastSyncAt (lub 24h dla pierwszego synca)
  const lastSyncAt = integration.lastSyncAt?.toDate?.() || null;
  const fromDate = lastSyncAt 
    ? new Date(lastSyncAt.getTime() - 60000)  // -1 min bufor
    : new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  // Pobierz token
  const { accessToken } = await getValidAllegroToken(
    companyId,
    integrationId,
    encryptionKey.value(),
    allegroClientId.value(),
    allegroClientSecret.value(),
    sandbox
  );
  
  // Pobierz cache produktów
  const mappingsSnapshot = await db
    .collection("companies")
    .doc(companyId)
    .collection("productMappings")
    .get();
  
  const offerCache = new Map<string, any>();
  for (const doc of mappingsSnapshot.docs) {
    const data = doc.data();
    if (data.externalOfferId) {
      offerCache.set(data.externalOfferId, {
        imageUrl: data.externalImageUrl || "",
        ean: data.externalEan || "",
        name: data.externalOfferName || "",
        sku: data.externalSku || "",
      });
    }
  }
  
  // Pobierz zamówienia
  const url = new URL(`${apiUrl}/order/checkout-forms`);
  url.searchParams.set("updatedAt.gte", fromDate.toISOString());
  url.searchParams.set("sort", "-updatedAt");
  url.searchParams.set("limit", "100");
  
  const response = await allegroFetch(url.toString(), accessToken);
  
  if (!response || !response.ok) {
    throw new Error(`Allegro API: ${response?.status}`);
  }
  
  const data = await response.json();
  const checkoutForms = data.checkoutForms || [];
  
  let imported = 0;
  let updated = 0;
  
  for (const form of checkoutForms) {
    // Sprawdź czy istnieje
    const existingQuery = await db
      .collection("companies")
      .doc(companyId)
      .collection("orders")
      .where("source", "==", "ALLEGRO")
      .where("externalId", "==", form.id)
      .limit(1)
      .get();
    
    const existingData = !existingQuery.empty ? existingQuery.docs[0].data() : null;
    
    // Sprawdź revision
    if (existingData && existingData.allegroData?.revision === form.revision) {
      continue;
    }
    
    // Mapuj przedmioty
    const items = (form.lineItems || []).map((item: any) => {
      const offerId = item.offer?.id || "";
      const cached = offerCache.get(offerId);
      return {
        sku: item.offer?.external?.id || cached?.sku || "",
        name: item.offer?.name || cached?.name || "Nieznany produkt",
        quantity: item.quantity || 1,
        price: parseFloat(item.price?.amount || "0"),
        currency: item.price?.currency || "PLN",
        vat: parseFloat(item.tax?.rate || "23"),
        imageUrl: cached?.imageUrl || "",
        ean: cached?.ean || "",
        allegroOfferId: offerId,
      };
    });
    
    // Buduj zamówienie
    const delivery = form.delivery || {};
    const payment = form.payment || {};
    const buyer = form.buyer || {};
    const address = delivery.address || {};
    
    const orderData: any = {
      source: "ALLEGRO",
      externalId: form.id,
      integrationId,
      status: existingData?.status || "new",
      items,
      buyer: {
        id: buyer.id || "",
        login: buyer.login || "",
        email: buyer.email || "",
        phone: buyer.phoneNumber || "",
        firstName: buyer.firstName || "",
        lastName: buyer.lastName || "",
      },
      payment: {
        type: payment.type || "",
        provider: payment.provider || "",
        paidAmount: parseFloat(payment.paidAmount?.amount || "0"),
        totalAmount: parseFloat(form.summary?.totalToPay?.amount || "0"),
        currency: payment.paidAmount?.currency || "PLN",
        finishedAt: payment.finishedAt || null,
      },
      delivery: {
        method: delivery.method?.name || "",
        methodId: delivery.method?.id || "",
        cost: parseFloat(delivery.cost?.amount || "0"),
        currency: delivery.cost?.currency || "PLN",
        smart: delivery.smart || false,
      },
      recipient: {
        firstName: address.firstName || buyer.firstName || "",
        lastName: address.lastName || buyer.lastName || "",
        phone: address.phoneNumber || buyer.phoneNumber || "",
        email: buyer.email || "",
        address: {
          street: address.street || "",
          city: address.city || "",
          zipCode: address.zipCode || "",
          countryCode: address.countryCode || "PL",
        },
      },
      countryCode: address.countryCode || "PL",
      currency: payment.paidAmount?.currency || "PLN",
      allegroData: {
        checkoutFormId: form.id,
        revision: form.revision,
      },
      orderedAt: form.lineItems?.[0]?.boughtAt 
        ? new Date(form.lineItems[0].boughtAt) 
        : new Date(form.updatedAt),
      updatedAt: FieldValue.serverTimestamp(),
    };
    
    if (existingData) {
      await existingQuery.docs[0].ref.update({
        ...orderData,
        orderNumber: existingData.orderNumber,
        createdAt: existingData.createdAt,
      });
      updated++;
    } else {
      // Generuj numer zamówienia
      const statsRef = db.collection("companies").doc(companyId).collection("stats").doc("orders");
      const statsSnap = await statsRef.get();
      let counter = (statsSnap.data()?.allegroCounter || 0) + 1;
      const year = new Date().getFullYear();
      const orderNumber = `ORD/AL/${year}/${String(counter).padStart(5, "0")}`;
      
      await db.collection("companies").doc(companyId).collection("orders").add({
        ...orderData,
        orderNumber,
        createdAt: FieldValue.serverTimestamp(),
      });
      
      await statsRef.set({ allegroCounter: counter }, { merge: true });
      imported++;
    }
  }
  
  // Zaktualizuj lastSyncAt
  await db
    .collection("companies")
    .doc(companyId)
    .collection("integrations")
    .doc(integrationId)
    .update({
      lastSyncAt: FieldValue.serverTimestamp(),
      lastSyncError: null,
    });
  
  return { imported, updated };
}
