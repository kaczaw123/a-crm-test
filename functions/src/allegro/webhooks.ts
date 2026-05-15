// @ts-nocheck
import { onRequest } from "firebase-functions/v2/https";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApiUrl, allegroFetch, allegroQueue, getValidAllegroToken } from "./helpers";
import {
  AllegroEventPayload,
  AllegroEventBatch,
  AllegroEventType,
  AllegroCheckoutForm,
  CrmOrder,
} from "./types";
import { mapAllegroStatusToCrm, generateOrderNumber } from "./helpers";

const encryptionKey = defineSecret("MASTER_ENCRYPTION_KEY");
const allegroClientId = defineSecret("ALLEGRO_CLIENT_ID");
const allegroClientSecret = defineSecret("ALLEGRO_CLIENT_SECRET");

// ============================================
// Typy zdarzeń które obsługujemy
// ============================================

const SUPPORTED_EVENT_TYPES: AllegroEventType[] = [
  "ORDER_CREATED",
  "ORDER_FILLED_IN",
  "ORDER_READY_FOR_PROCESSING",
  "ORDER_CANCELLED",
  "ORDER_PAYMENT_CAPTURED",
];

// ============================================
// HTTP ENDPOINT: Odbieranie webhooków z Allegro
// ============================================

export const allegroWebhook = onRequest(
  {
    secrets: [encryptionKey, allegroClientId, allegroClientSecret],
    cors: false, // Allegro wymaga odpowiedzi bez CORS
    maxInstances: 10,
    invoker: "public",
  },
  async (req, res) => {
    // Allegro wysyła tylko POST
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    // Pobierz integration ID z query params lub headers
    const integrationId = req.query.integrationId as string;
    const companyId = req.query.companyId as string;

    if (!integrationId || !companyId) {
      console.error("Missing integrationId or companyId in webhook URL");
      res.status(400).send("Missing parameters");
      return;
    }

    const db = getFirestore();

    try {
      // Weryfikuj że integracja istnieje
      const integrationRef = db
        .collection("companies")
        .doc(companyId)
        .collection("integrations")
        .doc(integrationId);

      const integrationSnap = await integrationRef.get();
      if (!integrationSnap.exists) {
        console.error(`Integration ${integrationId} not found`);
        res.status(404).send("Integration not found");
        return;
      }

      const integration = integrationSnap.data()!;
      if (integration.type !== "allegro") {
        res.status(400).send("Invalid integration type");
        return;
      }

      // Parsuj body
      const body: AllegroEventBatch = req.body;

      if (!body.events || !Array.isArray(body.events)) {
        console.error("Invalid webhook payload:", body);
        res.status(400).send("Invalid payload");
        return;
      }

      console.log(`Received ${body.events.length} Allegro events for ${companyId}/${integrationId}`);

      // Przetwórz każde zdarzenie
      for (const event of body.events) {
        await processWebhookEvent(event, companyId, integrationId, integration, db);
      }

      // Allegro oczekuje 2xx dla sukcesu
      res.status(200).send("OK");

    } catch (error) {
      console.error("Webhook processing error:", error);
      // Zwróć 500 aby Allegro ponowiło próbę
      res.status(500).send("Internal error");
    }
  }
);

// ============================================
// HELPER: Przetwarzanie pojedynczego zdarzenia
// ============================================

async function processWebhookEvent(
  event: AllegroEventPayload,
  companyId: string,
  integrationId: string,
  integration: FirebaseFirestore.DocumentData,
  db: FirebaseFirestore.Firestore
): Promise<void> {
  const checkoutFormId = event.subject.oid;

  // Zaloguj zdarzenie
  const logRef = db
    .collection("companies")
    .doc(companyId)
    .collection("webhookLogs")
    .doc(event.id);

  await logRef.set({
    eventId: event.id,
    eventType: event.type,
    checkoutFormId,
    receivedAt: FieldValue.serverTimestamp(),
    processedAt: null,
    status: "received",
    error: null,
    integrationId,
    companyId,
  });

  try {
    // Sprawdź czy to zdarzenie nas interesuje
    if (!SUPPORTED_EVENT_TYPES.includes(event.type)) {
      console.log(`Ignoring unsupported event type: ${event.type}`);
      await logRef.update({ status: "processed", processedAt: FieldValue.serverTimestamp() });
      return;
    }

    await logRef.update({ status: "processing" });

    const { accessToken } = await getValidAllegroToken(
      companyId,
      integrationId,
      encryptionKey.value(),
      allegroClientId.value(),
      allegroClientSecret.value(),
      false
    );

    const sandbox = false;
    const apiUrl = getApiUrl(sandbox);

    // Pobierz szczegóły zamówienia z Allegro
    const orderResponse = await allegroQueue.add(() =>
      allegroFetch(`${apiUrl}/order/checkout-forms/${checkoutFormId}`, accessToken)
    );

    if (!orderResponse || !orderResponse.ok) {
      throw new Error(`Failed to fetch order: ${orderResponse ? await orderResponse.text() : "No response"}`);
    }

    const checkoutForm: AllegroCheckoutForm = await orderResponse.json();

    // Sprawdź czy zamówienie już istnieje
    const existingOrderQuery = await db
      .collection("companies")
      .doc(companyId)
      .collection("orders")
      .where("source", "==", "ALLEGRO")
      .where("externalId", "==", checkoutFormId)
      .limit(1)
      .get();

    if (existingOrderQuery.empty) {
      // Nowe zamówienie - utwórz
      await createOrderFromWebhook(checkoutForm, companyId, integrationId, db);
      console.log(`Created new order from webhook: ${checkoutFormId}`);
    } else {
      // Istniejące zamówienie - zaktualizuj status
      const existingDoc = existingOrderQuery.docs[0];
      const newStatus = mapAllegroStatusToCrm(
        checkoutForm.status,
        checkoutForm.fulfillment.status
      );

      await existingDoc.ref.update({
        status: newStatus,
        "allegroData.revision": checkoutForm.revision,
        "payment.status": checkoutForm.payment.finishedAt ? "PAID" : "PENDING",
        "payment.paidAt": checkoutForm.payment.finishedAt
          ? new Date(checkoutForm.payment.finishedAt)
          : null,
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`Updated order from webhook: ${checkoutFormId} -> ${newStatus}`);
    }

    // Sukces
    await logRef.update({
      status: "processed",
      processedAt: FieldValue.serverTimestamp(),
    });

  } catch (error) {
    console.error(`Failed to process event ${event.id}:`, error);
    await logRef.update({
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
      processedAt: FieldValue.serverTimestamp(),
    });
  }
}

// ============================================
// HELPER: Tworzenie zamówienia z webhooka
// ============================================

async function createOrderFromWebhook(
  checkoutForm: AllegroCheckoutForm,
  companyId: string,
  integrationId: string,
  db: FirebaseFirestore.Firestore
): Promise<void> {
  // Pobierz licznik zamówień
  const statsRef = db
    .collection("companies")
    .doc(companyId)
    .collection("stats")
    .doc("orders");

  const statsSnap = await statsRef.get();
  const orderCounter = (statsSnap.data()?.allegroCounter || 0) + 1;

  // Mapuj produkty
  const items = await Promise.all(
    checkoutForm.lineItems.map(async (item) => {
      const sku = item.offer.external?.id || "";
      let crmProductId: string | null = null;

      if (sku) {
        const productQuery = await db
          .collection("companies")
          .doc(companyId)
          .collection("products")
          .where("sku", "==", sku)
          .limit(1)
          .get();

        if (!productQuery.empty) {
          crmProductId = productQuery.docs[0].id;
        }
      }

      return {
        sku,
        name: item.offer.name,
        quantity: item.quantity,
        price: parseFloat(item.price.amount),
        allegroOfferId: item.offer.id,
        allegroLineItemId: item.id,
        crmProductId,
      };
    })
  );

  // Utwórz zamówienie
  const crmOrder: CrmOrder = {
    source: "ALLEGRO",
    externalId: checkoutForm.id,
    externalOrderNumber: checkoutForm.id.substring(0, 12).toUpperCase(),

    orderNumber: generateOrderNumber("AL", orderCounter),
    status: mapAllegroStatusToCrm(
      checkoutForm.status,
      checkoutForm.fulfillment.status
    ),

    recipient: {
      firstName: checkoutForm.delivery.address.firstName,
      lastName: checkoutForm.delivery.address.lastName,
      companyName: checkoutForm.delivery.address.companyName || "",
      email: checkoutForm.buyer.email,
      phone: checkoutForm.delivery.address.phoneNumber || checkoutForm.buyer.phoneNumber || "",
      address: {
        street: checkoutForm.delivery.address.street,
        city: checkoutForm.delivery.address.city,
        zipCode: checkoutForm.delivery.address.zipCode,
        country: checkoutForm.delivery.address.countryCode,
      },
    },

    items,

    payment: {
      method: checkoutForm.payment.type,
      status: checkoutForm.payment.finishedAt ? "PAID" : "PENDING",
      amount: parseFloat(checkoutForm.summary.totalToPay.amount),
      currency: checkoutForm.summary.totalToPay.currency,
      paidAt: checkoutForm.payment.finishedAt
        ? new Date(checkoutForm.payment.finishedAt)
        : null,
    },

    delivery: {
      method: checkoutForm.delivery.method.name,
      provider: null,
      cost: checkoutForm.delivery.cost
        ? parseFloat(checkoutForm.delivery.cost.amount)
        : 0,
    },

    allegroData: {
      checkoutFormId: checkoutForm.id,
      buyerId: checkoutForm.buyer.id,
      buyerLogin: checkoutForm.buyer.login,
      messageToSeller: checkoutForm.messageToSeller,
      revision: checkoutForm.revision,
    },

    shipping: {
      trackingNumber: null,
      carrier: null,
      labelUrl: null,
      shippedAt: null,
      trackingSentToAllegro: false,
    },

    companyId,
    integrationId,

    createdAt: FieldValue.serverTimestamp() as any,
    updatedAt: FieldValue.serverTimestamp() as any,
    importedAt: FieldValue.serverTimestamp() as any,
  };

  await db.collection("companies").doc(companyId).collection("orders").add(crmOrder);

  // Aktualizuj licznik
  await statsRef.set(
    {
      allegroCounter: orderCounter,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Aktualizuj statystyki integracji
  await db
    .collection("companies")
    .doc(companyId)
    .collection("integrations")
    .doc(integrationId)
    .update({
      "stats.totalOrdersImported": FieldValue.increment(1),
      lastSyncAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
}

// ============================================
// REJESTRACJA SUBSKRYPCJI WEBHOOKÓW
// ============================================

export const registerAllegroWebhook = onCall(
  {
    secrets: [encryptionKey, allegroClientId, allegroClientSecret],
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Musisz być zalogowany");
    }

    const { companyId, integrationId } = request.data;

    if (!companyId || !integrationId) {
      throw new HttpsError("invalid-argument", "Brak companyId lub integrationId");
    }

    const db = getFirestore();

    // Pobierz integrację
    const integrationRef = db
      .collection("companies")
      .doc(companyId)
      .collection("integrations")
      .doc(integrationId);

    const integrationSnap = await integrationRef.get();
    if (!integrationSnap.exists) {
      throw new HttpsError("not-found", "Integracja nie istnieje");
    }

    const { accessToken, integration } = await getValidAllegroToken(
      companyId,
      integrationId,
      encryptionKey.value(),
      allegroClientId.value(),
      allegroClientSecret.value(),
      false
    );

    const sandbox = false;
    const apiUrl = getApiUrl(sandbox);

    // URL webhooka
    // WAŻNE: Zmień na prawdziwy URL twojej funkcji
    const projectId = process.env.GCLOUD_PROJECT || "gep-a-crm";
    const region = "europe-west1"; // lub inny region
    const webhookUrl = `https://${region}-${projectId}.cloudfunctions.net/allegroWebhook?companyId=${companyId}&integrationId=${integrationId}`;

    // Sprawdź czy subskrypcja już istnieje
    const existingSubsResponse = await allegroFetch(
      `${apiUrl}/sale/offer-events/subscriptions`,
      accessToken
    );

    if (existingSubsResponse.ok) {
      const existingSubs = await existingSubsResponse.json();
      const existingSub = existingSubs.subscriptions?.find(
        (s: any) => s.url === webhookUrl
      );

      if (existingSub) {
        // Subskrypcja już istnieje
        await integrationRef.update({
          webhookSubscriptionId: existingSub.id,
          webhookUrl: webhookUrl,
          webhookStatus: "active",
          updatedAt: FieldValue.serverTimestamp(),
        });

        return {
          success: true,
          subscriptionId: existingSub.id,
          message: "Webhook już zarejestrowany",
        };
      }
    }

    // Zarejestruj nową subskrypcję
    const createResponse = await allegroFetch(
      `${apiUrl}/sale/offer-events/subscriptions`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          url: webhookUrl,
          eventTypes: SUPPORTED_EVENT_TYPES,
        }),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new HttpsError("internal", `Błąd rejestracji webhooka: ${errorText}`);
    }

    const subscription = await createResponse.json();

    // Zapisz ID subskrypcji w integracji
    await integrationRef.update({
      webhookSubscriptionId: subscription.id,
      webhookUrl: webhookUrl,
      webhookStatus: "active",
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      subscriptionId: subscription.id,
      webhookUrl,
    };
  }
);

// ============================================
// WYREJESTROWANIE SUBSKRYPCJI
// ============================================

export const unregisterAllegroWebhook = onCall(
  {
    secrets: [encryptionKey, allegroClientId, allegroClientSecret],
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Musisz być zalogowany");
    }

    const { companyId, integrationId } = request.data;

    if (!companyId || !integrationId) {
      throw new HttpsError("invalid-argument", "Brak companyId lub integrationId");
    }

    const db = getFirestore();

    const integrationRef = db
      .collection("companies")
      .doc(companyId)
      .collection("integrations")
      .doc(integrationId);

    const integrationSnap = await integrationRef.get();
    if (!integrationSnap.exists) {
      throw new HttpsError("not-found", "Integracja nie istnieje");
    }

    const integration = integrationSnap.data()!;
    const subscriptionId = integration.webhookSubscriptionId;

    if (!subscriptionId) {
      return { success: true, message: "Brak aktywnego webhooka" };
    }

    const { accessToken } = await getValidAllegroToken(
      companyId,
      integrationId,
      encryptionKey.value(),
      allegroClientId.value(),
      allegroClientSecret.value(),
      false
    );

    const sandbox = false;
    const apiUrl = getApiUrl(sandbox);

    // Usuń subskrypcję
    const deleteResponse = await allegroFetch(
      `${apiUrl}/sale/offer-events/subscriptions/${subscriptionId}`,
      accessToken,
      { method: "DELETE" }
    );

    // 404 = już usunięta, traktujemy jako sukces
    if (!deleteResponse.ok && deleteResponse.status !== 404) {
      const errorText = await deleteResponse.text();
      throw new HttpsError("internal", `Błąd usuwania webhooka: ${errorText}`);
    }

    // Wyczyść dane webhooka w integracji
    await integrationRef.update({
      webhookSubscriptionId: FieldValue.delete(),
      webhookUrl: FieldValue.delete(),
      webhookStatus: "inactive",
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
  }
);

// ============================================
// SPRAWDZENIE STATUSU WEBHOOKA
// ============================================

export const getAllegroWebhookStatus = onCall(
  {
    secrets: [encryptionKey],
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Musisz być zalogowany");
    }

    const { companyId, integrationId } = request.data;

    if (!companyId || !integrationId) {
      throw new HttpsError("invalid-argument", "Brak companyId lub integrationId");
    }

    const db = getFirestore();

    const integrationSnap = await db
      .collection("companies")
      .doc(companyId)
      .collection("integrations")
      .doc(integrationId)
      .get();

    if (!integrationSnap.exists) {
      throw new HttpsError("not-found", "Integracja nie istnieje");
    }

    const integration = integrationSnap.data()!;

    const logsSnap = await db
      .collection("companies")
      .doc(companyId)
      .collection("webhookLogs")
      .where("integrationId", "==", integrationId)
      .get();
      
    // Sortuj w JavaScript by uniknąć zapotrzebowania na Firestore Composite Index
    const logs = logsSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => {
         const dateA = a.receivedAt?.toDate?.() || new Date(0);
         const dateB = b.receivedAt?.toDate?.() || new Date(0);
         return dateB.getTime() - dateA.getTime();
      })
      .slice(0, 10);

    return {
      subscriptionId: integration.webhookSubscriptionId || null,
      webhookUrl: integration.webhookUrl || null,
      status: integration.webhookStatus || "inactive",
      recentLogs: logs,
    };
  }
);
