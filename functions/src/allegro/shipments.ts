// @ts-nocheck
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApiUrl, allegroFetch, allegroQueue, getValidAllegroToken } from "./helpers";
import { CARRIER_MAPPING } from "./types";

const encryptionKey = defineSecret("MASTER_ENCRYPTION_KEY");
const allegroClientId = defineSecret("ALLEGRO_CLIENT_ID");
const allegroClientSecret = defineSecret("ALLEGRO_CLIENT_SECRET");

// ============================================
// TRIGGER: Auto-wysyłka tracking po zapisie shipment
// ============================================

export const onShipmentCreatedSendTracking = onDocumentWritten(
  {
    document: "companies/{companyId}/shipments/{shipmentId}",
    secrets: [encryptionKey, allegroClientId, allegroClientSecret],
  },
  async (event) => {
    const beforeData = event.data?.before?.data();
    const afterData = event.data?.after?.data();

    // Sprawdź czy to nowy tracking number (nie było wcześniej lub zmienił się)
    if (!afterData) return; // Dokument usunięty
    
    const trackingNumber = afterData.trackingNumber;
    const previousTrackingNumber = beforeData?.trackingNumber;

    // Jeśli tracking się nie zmienił, pomiń
    if (trackingNumber === previousTrackingNumber) return;

    // Jeśli brak tracking number, pomiń
    if (!trackingNumber) return;

    // Sprawdź czy to zamówienie z Allegro
    const orderId = afterData.orderId;
    if (!orderId) {
      console.log("Shipment without orderId, skipping Allegro tracking");
      return;
    }

    const companyId = event.params.companyId;
    const db = getFirestore();

    // Pobierz zamówienie
    const orderRef = db
      .collection("companies")
      .doc(companyId)
      .collection("orders")
      .doc(orderId);

    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      console.log(`Order ${orderId} not found, skipping`);
      return;
    }

    const orderData = orderSnap.data()!;

    // Sprawdź czy to zamówienie z Allegro
    if (orderData.source !== "ALLEGRO") {
      console.log(`Order ${orderId} is not from Allegro, skipping`);
      return;
    }

    // Sprawdź czy tracking już został wysłany
    if (orderData.shipping?.trackingSentToAllegro) {
      console.log(`Tracking already sent to Allegro for order ${orderId}`);
      return;
    }

    // Pobierz integrację Allegro
    const integrationId = orderData.integrationId;
    if (!integrationId) {
      console.error(`Order ${orderId} has no integrationId`);
      return;
    }

    const integrationRef = db
      .collection("companies")
      .doc(companyId)
      .collection("integrations")
      .doc(integrationId);

    const integrationSnap = await integrationRef.get();
    if (!integrationSnap.exists) {
      console.error(`Integration ${integrationId} not found`);
      return;
    }

    const integration = integrationSnap.data()!;

    // Sprawdź czy auto-tracking jest włączony
    if (!integration.settings?.autoSendTracking) {
      console.log(`Auto tracking disabled for integration ${integrationId}`);
      return;
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
    const checkoutFormId = orderData.allegroData?.checkoutFormId;

    if (!checkoutFormId) {
      console.error(`Order ${orderId} has no checkoutFormId`);
      return;
    }

    // Mapuj carrier
    const carrier = afterData.carrier || "DHL";
    const carrierInfo = CARRIER_MAPPING[carrier.toUpperCase()] || CARRIER_MAPPING.OTHER;

    // Pobierz lineItemIds z zamówienia
    const lineItemIds = orderData.items?.map((item: any) => item.allegroLineItemId).filter(Boolean) || [];

    // Jeśli brak lineItemIds, spróbuj pobrać z Allegro
    let finalLineItemIds = lineItemIds;
    if (finalLineItemIds.length === 0) {
      try {
        const orderResponse = await allegroQueue.add(() =>
          allegroFetch(`${apiUrl}/order/checkout-forms/${checkoutFormId}`, accessToken)
        );

        if (orderResponse && orderResponse.ok) {
          const allegroOrder = await orderResponse.json();
          finalLineItemIds = allegroOrder.lineItems?.map((item: any) => item.id) || [];
        }
      } catch (error) {
        console.error("Failed to fetch Allegro order for lineItemIds:", error);
      }
    }

    // Wyślij tracking do Allegro
    try {
      const shipmentPayload = {
        carrierId: carrierInfo.id,
        carrierName: carrierInfo.name,
        waybill: trackingNumber,
        lineItemIds: finalLineItemIds,
      };

      console.log(`Sending tracking to Allegro:`, shipmentPayload);

      const response = await allegroQueue.add(() =>
        allegroFetch(
          `${apiUrl}/order/checkout-forms/${checkoutFormId}/shipments`,
          accessToken,
          {
            method: "POST",
            body: JSON.stringify(shipmentPayload),
          }
        )
      );

      if (!response || !response.ok) {
        const errorText = response ? await response.text() : "No response";
        throw new Error(`Allegro API error: ${errorText}`);
      }

      console.log(`Tracking ${trackingNumber} sent to Allegro for order ${orderId}`);

      // Zaktualizuj zamówienie
      await orderRef.update({
        "shipping.trackingNumber": trackingNumber,
        "shipping.carrier": carrier,
        "shipping.trackingSentToAllegro": true,
        "shipping.trackingSentAt": FieldValue.serverTimestamp(),
        "shipping.shippedAt": FieldValue.serverTimestamp(),
        status: "shipped",
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Zaktualizuj statystyki integracji
      await integrationRef.update({
        "stats.totalTrackingSent": FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });

    } catch (error) {
      console.error(`Failed to send tracking to Allegro:`, error);

      // Zapisz błąd w zamówieniu
      await orderRef.update({
        "shipping.trackingNumber": trackingNumber,
        "shipping.carrier": carrier,
        "shipping.trackingSentToAllegro": false,
        "shipping.trackingError": error instanceof Error ? error.message : "Unknown error",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
);

// ============================================
// MANUAL: Wyślij tracking ręcznie
// ============================================

export const sendAllegroTracking = onCall(
  {
    secrets: [encryptionKey, allegroClientId, allegroClientSecret],
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Musisz być zalogowany");
    }

    const { companyId, orderId, trackingNumber, carrier } = request.data;

    if (!companyId || !orderId || !trackingNumber) {
      throw new HttpsError(
        "invalid-argument",
        "Brak companyId, orderId lub trackingNumber"
      );
    }

    const db = getFirestore();

    // Pobierz zamówienie
    const orderRef = db
      .collection("companies")
      .doc(companyId)
      .collection("orders")
      .doc(orderId);

    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      throw new HttpsError("not-found", "Zamówienie nie istnieje");
    }

    const orderData = orderSnap.data()!;

    if (orderData.source !== "ALLEGRO") {
      throw new HttpsError("invalid-argument", "To nie jest zamówienie z Allegro");
    }

    // Pobierz integrację
    const integrationId = orderData.integrationId;
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
    const checkoutFormId = orderData.allegroData?.checkoutFormId;

    if (!checkoutFormId) {
      throw new HttpsError("invalid-argument", "Brak checkoutFormId w zamówieniu");
    }

    // Mapuj carrier
    const carrierInfo = CARRIER_MAPPING[(carrier || "DHL").toUpperCase()] || CARRIER_MAPPING.OTHER;

    // Pobierz lineItemIds z Allegro
    const orderResponse = await allegroFetch(
      `${apiUrl}/order/checkout-forms/${checkoutFormId}`,
      accessToken
    );

    if (!orderResponse.ok) {
      throw new HttpsError("internal", "Nie udało się pobrać zamówienia z Allegro");
    }

    const allegroOrder = await orderResponse.json();
    const lineItemIds = allegroOrder.lineItems?.map((item: any) => item.id) || [];

    // Wyślij tracking
    const shipmentPayload = {
      carrierId: carrierInfo.id,
      carrierName: carrierInfo.name,
      waybill: trackingNumber,
      lineItemIds,
    };

    const response = await allegroFetch(
      `${apiUrl}/order/checkout-forms/${checkoutFormId}/shipments`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify(shipmentPayload),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new HttpsError("internal", `Błąd Allegro API: ${errorText}`);
    }

    // Zaktualizuj zamówienie
    await orderRef.update({
      "shipping.trackingNumber": trackingNumber,
      "shipping.carrier": carrier || "DHL",
      "shipping.trackingSentToAllegro": true,
      "shipping.trackingSentAt": FieldValue.serverTimestamp(),
      "shipping.shippedAt": FieldValue.serverTimestamp(),
      status: "shipped",
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Zaktualizuj statystyki
    await integrationRef.update({
      "stats.totalTrackingSent": FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true, trackingNumber };
  }
);

// ============================================
// RETRY: Ponów nieudaną wysyłkę tracking
// ============================================

export const retryAllegroTracking = onCall(
  {
    secrets: [encryptionKey, allegroClientId, allegroClientSecret],
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Musisz być zalogowany");
    }

    const { companyId, orderId } = request.data;

    if (!companyId || !orderId) {
      throw new HttpsError("invalid-argument", "Brak companyId lub orderId");
    }

    const db = getFirestore();
    const orderRef = db
      .collection("companies")
      .doc(companyId)
      .collection("orders")
      .doc(orderId);

    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      throw new HttpsError("not-found", "Zamówienie nie istnieje");
    }

    const orderData = orderSnap.data()!;
    const trackingNumber = orderData.shipping?.trackingNumber || orderData.trackingNumber;
    const carrier = orderData.shipping?.carrier || "DHL";

    if (!trackingNumber) {
      throw new HttpsError("invalid-argument", "Zamówienie nie ma numeru tracking");
    }

    if (orderData.source !== "ALLEGRO") {
      throw new HttpsError("invalid-argument", "To nie jest zamówienie z Allegro");
    }

    const integrationId = orderData.integrationId;
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
    const checkoutFormId = orderData.allegroData?.checkoutFormId;

    if (!checkoutFormId) {
      throw new HttpsError("invalid-argument", "Brak checkoutFormId w zamówieniu");
    }

    const carrierInfo = CARRIER_MAPPING[(carrier || "DHL").toUpperCase()] || CARRIER_MAPPING.OTHER;

    // Pobierz lineItemIds
    const allegroOrderResponse = await allegroFetch(
      `${apiUrl}/order/checkout-forms/${checkoutFormId}`,
      accessToken
    );

    if (!allegroOrderResponse.ok) {
      throw new HttpsError("internal", "Nie udało się pobrać zamówienia z Allegro");
    }

    const allegroOrder = await allegroOrderResponse.json();
    const lineItemIds = allegroOrder.lineItems?.map((item: any) => item.id) || [];

    const response = await allegroFetch(
      `${apiUrl}/order/checkout-forms/${checkoutFormId}/shipments`,
      accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          carrierId: carrierInfo.id,
          carrierName: carrierInfo.name,
          waybill: trackingNumber,
          lineItemIds,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new HttpsError("internal", `Błąd Allegro API: ${errorText}`);
    }

    await orderRef.update({
      "shipping.trackingSentToAllegro": true,
      "shipping.trackingSentAt": FieldValue.serverTimestamp(),
      "shipping.trackingError": FieldValue.delete(),
      status: "shipped",
      updatedAt: FieldValue.serverTimestamp(),
    });

    await integrationRef.update({
      "stats.totalTrackingSent": FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
  }
);
