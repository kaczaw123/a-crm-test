// @ts-nocheck
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  getApiUrl,
  allegroFetch,
  allegroQueue,
  mapAllegroStatusToCrm,
  generateOrderNumber,
  getValidAllegroToken,
} from "./helpers";
import {
  AllegroCheckoutForm,
  AllegroCheckoutFormsResponse,
  CrmOrder,
} from "./types";

const encryptionKey = defineSecret("MASTER_ENCRYPTION_KEY");
const allegroClientId = defineSecret("ALLEGRO_CLIENT_ID");
const allegroClientSecret = defineSecret("ALLEGRO_CLIENT_SECRET");

// ============================================
// HELPERS
// ============================================

// ============================================
// FETCH ORDERS (MANUAL)
// ============================================

export const fetchAllegroOrders = onCall(
  {
    secrets: [encryptionKey, allegroClientId, allegroClientSecret],
    timeoutSeconds: 300,
    memory: "512MiB",
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Musisz być zalogowany");
    }

    console.log("fetchAllegroOrders v2.2 - z needsUpdate imageUrl check");
    const { companyId, integrationId, daysBack = 7 } = request.data;

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

    const integration = integrationSnap.data()!;
    if (integration.type !== "allegro") {
      throw new HttpsError("invalid-argument", "To nie jest integracja Allegro");
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

    // Oblicz datę początkową
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - daysBack);

    // Pobierz listę zamówień z Allegro
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const url = new URL(`${apiUrl}/order/checkout-forms`);
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("updatedAt.gte", fromDate.toISOString());
      url.searchParams.set("sort", "-updatedAt");

      const response = await allegroQueue.add(() =>
        allegroFetch(url.toString(), accessToken)
      );

      if (!response || !response.ok) {
        const errorText = response ? await response.text() : "No response";
        console.error("Allegro API error:", errorText);
        throw new HttpsError("internal", "Błąd pobierania zamówień z Allegro");
      }

      const data: AllegroCheckoutFormsResponse = await response.json();

      // Paginacja i rate limiting
      for (const checkoutForm of data.checkoutForms.slice(0, 50)) {
        const result = await processCheckoutForm(
          checkoutForm,
          companyId,
          integrationId,
          db,
          accessToken,
          apiUrl
        );

        if (result === "imported") {
          imported++;
        } else if (result === "updated") {
          updated++;
        } else {
          skipped++;
        }

        // 100ms przerwy dla API
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      offset += limit;
      // Przerwij po maksymalnie np. 200 iteracjach w jednym wywołaniu jeśli wciąż hasMore
      hasMore = data.checkoutForms.length === limit && (imported + updated + skipped) < 150;
    }

    // Aktualizuj statystyki integracji
    await integrationRef.update({
      lastSyncAt: FieldValue.serverTimestamp(),
      "stats.totalOrdersImported": FieldValue.increment(imported), // Only increment new ones
      updatedAt: FieldValue.serverTimestamp(),
      lastError: null,
    });

    console.log(
      `Allegro sync for ${companyId}: imported=${imported}, updated=${updated}, skipped=${skipped}`
    );

    return { 
      success: true, 
      imported, 
      updated,
      skipped, 
      total: imported + updated + skipped,
      message: `Zaimportowano ${imported}, zaktualizowano ${updated}, pominięto ${skipped} zamówień`
    };
  }
);

// ============================================
// PROCESS SINGLE CHECKOUT FORM
// ============================================

async function processCheckoutForm(
  checkoutForm: AllegroCheckoutForm,
  companyId: string,
  integrationId: string,
  db: FirebaseFirestore.Firestore,
  accessToken: string,
  apiUrl: string
): Promise<"imported" | "skipped" | "updated"> {
  // Sprawdź czy zamówienie już istnieje (deduplikacja)
  const existingOrder = await db
    .collection("companies")
    .doc(companyId)
    .collection("orders")
    .where("source", "==", "ALLEGRO")
    .where("externalId", "==", checkoutForm.id)
    .limit(1)
    .get();

  if (!existingOrder.empty) {
    // Zamówienie już istnieje - sprawdź czy trzeba zaktualizować (brak items lub inna rewizja)
    const existingDoc = existingOrder.docs[0];
    const existingData = existingDoc.data();

    const forceUpdate = (checkoutForm as any).forceUpdate === true || existingData.forceUpdate === true; // we can't easily pass it from UI here, so let's just force debug
    
    // SZCZEGÓŁOWE LOGI
    console.log(`=== DIAGNOZA ZAMÓWIENIA ${checkoutForm.id} ===`);
    console.log(`items: ${JSON.stringify(existingData.items?.[0])?.substring(0, 200)}`);
    console.log(`items[0].imageUrl: "${existingData.items?.[0]?.imageUrl}"`);
    console.log(`countryCode: "${existingData.countryCode}"`);
    console.log(`delivery: ${JSON.stringify(existingData.delivery)?.substring(0, 200)}`);
    console.log(`delivery.method: "${existingData.delivery?.method}"`);

    const needsUpdate = forceUpdate || (
      !existingData.items ||
      existingData.items.length === 0 ||
      !existingData.items[0]?.imageUrl ||
      !existingData.countryCode ||
      !existingData.delivery?.method ||
      existingData.allegroData?.revision !== checkoutForm.revision
    );

    console.log(`Zamówienie ${checkoutForm.id}: needsUpdate=${needsUpdate}, items length=${existingData.items?.length}`);

    // Jeśli nie ma potrzeby aktualizacji, pomiń
    if (!needsUpdate) {
      return "skipped";
    }

    if (forceUpdate) {
      console.log(`>>> FORCE UPDATE dla ${checkoutForm.id}`);
    }
  }

  // KROK 2: FETCH ORDER DETAILS (to get lineItems, delivery, etc)
  const detailsResponse = await allegroQueue.add(() =>
    allegroFetch(`${apiUrl}/order/checkout-forms/${checkoutForm.id}`, accessToken)
  );

  if (!detailsResponse || !detailsResponse.ok) {
    console.error(`Błąd pobierania szczegółów ${checkoutForm.id}: ${detailsResponse?.status}`);
    return "skipped";
  }

  const details = await detailsResponse.json();

  console.log("=== ALLEGRO CHECKOUT-FORM DETAILS ===");
  console.log(JSON.stringify(details, null, 2).substring(0, 5000));

  // Pobierz licznik zamówień dla generowania numeru
  let orderNumber = checkoutForm.id.substring(0, 12).toUpperCase();
  if (existingOrder.empty) {
    const statsRef = db
      .collection("companies")
      .doc(companyId)
      .collection("stats")
      .doc("orders");

    const statsSnap = await statsRef.get();
    let orderCounter = (statsSnap.data()?.allegroCounter || 0) + 1;
    
    orderNumber = generateOrderNumber("AL", orderCounter);

    // Aktualizuj licznik (robimy to tylko raz dla nowych zamówień)
    await statsRef.set(
      {
        allegroCounter: orderCounter,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } else {
    // Zachowaj powiązany numer z poprzedniego importu by nie nadpisać
    orderNumber = existingOrder.docs[0].data().orderNumber || orderNumber;
  }

  // Mapuj produkty
  const lineItemsList = details.lineItems || [];
  const items = await Promise.all(
    lineItemsList.map(async (item: any) => {
      // Szukaj mapowania produktu
      const sku = item.offer?.external?.id || item.offer?.id || "";
      let crmProductId: string | null = null;

      if (sku) {
        // Sprawdź czy istnieje produkt z tym SKU
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
        name: item.offer?.name || "Nieznany produkt",
        quantity: item.quantity || 1,
        price: parseFloat(item.price?.amount || "0"),
        currency: item.price?.currency || "PLN",
        allegroOfferId: item.offer?.id || "",
        allegroLineItemId: item.id || "",
        crmProductId,
        imageUrl: "", // Będzie uzupełnione przez fetchAllegroOffers
        ean: item.offer?.ean || "",  // Tylko prawdziwy EAN, nie SKU
      };
    })
  );

  // Dane odbiorcy
  const buyer = details.buyer || {};
  const delivery = details.delivery || {};
  const address = delivery.address || {};

  // Utwórz zamówienie w formacie CRM
  const crmOrder: CrmOrder = {
    source: "ALLEGRO",
    externalId: details.id,
    externalOrderNumber: details.id.substring(0, 12).toUpperCase(),

    orderNumber,
    status: mapAllegroStatusToCrm(
      details.status,
      details.fulfillment?.status
    ),

    recipient: {
      firstName: address.firstName || buyer.firstName || "",
      lastName: address.lastName || buyer.lastName || "",
      companyName: address.companyName || "",
      email: buyer.email || "",
      phone: address.phoneNumber || buyer.phoneNumber || "",
      address: {
        street: address.street || "",
        city: address.city || "",
        zipCode: address.zipCode || address.postCode || "",
        countryCode: details.delivery?.address?.countryCode || details.buyer?.address?.countryCode || "PL",
      },
    },

    countryCode: details.delivery?.address?.countryCode || details.buyer?.address?.countryCode || "PL",

    items,

    payment: {
      method: details.payment?.type || "",
      status: details.payment?.paidAmount ? "PAID" : "PENDING",
      amount: parseFloat(details.summary?.totalToPay?.amount || "0"),
      paidAmount: parseFloat(details.payment?.paidAmount?.amount || "0"),
      currency: details.summary?.totalToPay?.currency || "PLN",
      paidAt: details.payment?.finishedAt
        ? new Date(details.payment.finishedAt)
        : null,
      provider: details.payment?.provider || "",
    },

    delivery: {
      method: delivery.method?.name || "",
      methodId: delivery.method?.id || "",
      provider: delivery.method?.id || "",
      cost: delivery.cost ? parseFloat(delivery.cost.amount || "0") : 0,
      currency: delivery.cost?.currency || "PLN",
      pickupPointId: delivery.pickupPoint?.id || "",
      pickupPointName: delivery.pickupPoint?.name || "",
      pickupPointAddress: delivery.pickupPoint?.address || "",
    },

    allegroData: {
      checkoutFormId: details.id,
      buyerId: buyer.id || "",
      buyerLogin: buyer.login || "",
      messageToSeller: details.messageToSeller || "",
      revision: details.revision || "",
      boughtAt: lineItemsList[0]?.boughtAt ? new Date(lineItemsList[0].boughtAt) : null,
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

    // Daty Allegro - uwzględniamy poprawne daty z Allegro
    allegroCreatedAt: details.updatedAt ? new Date(details.updatedAt) : new Date(),
    allegroBoughtAt: lineItemsList[0]?.boughtAt ? new Date(lineItemsList[0].boughtAt) : null,
    
    updatedAt: FieldValue.serverTimestamp(),
    importedAt: FieldValue.serverTimestamp(),
  } as any;

  // Zapisz zamówienie
  if (!existingOrder.empty) {
    // Zachowaj oryginalną datę utworzenia
    const existingCreatedAt = existingOrder.docs[0].data().createdAt;
    crmOrder.createdAt = existingCreatedAt;
    
    await existingOrder.docs[0].ref.update(crmOrder as any);
    return "updated";
  } else {
    crmOrder.createdAt = FieldValue.serverTimestamp() as any;
    
    await db
      .collection("companies")
      .doc(companyId)
      .collection("orders")
      .add(crmOrder);
      
    return "imported";
  }
}

// ============================================
// AUTO-SYNC (SCHEDULED - opcjonalnie)
// ============================================

export const syncAllegroOrdersScheduled = onSchedule(
  {
    schedule: "every 15 minutes",
    secrets: [encryptionKey, allegroClientId, allegroClientSecret],
    timeoutSeconds: 540, // 9 minut
  },
  async () => {
    const db = getFirestore();

    // Pobierz wszystkie aktywne integracje Allegro z włączoną synchronizacją
    const integrationsSnap = await db
      .collectionGroup("integrations")
      .where("type", "==", "allegro")
      .where("status", "==", "active")
      .where("settings.syncOrders", "==", true)
      .get();

    console.log(
      `Auto-sync: Found ${integrationsSnap.size} Allegro integrations with syncOrders=true`
    );

    for (const doc of integrationsSnap.docs) {
      try {
        const data = doc.data();

        // Wyciągnij companyId z ścieżki dokumentu
        const pathParts = doc.ref.path.split("/");
        const companyId = pathParts[1];
        const integrationId = doc.id;

        // Pobierz ważny access token
        const { accessToken } = await getValidAllegroToken(
          companyId,
          integrationId,
          encryptionKey.value(),
          allegroClientId.value(),
          allegroClientSecret.value(),
      false
    );

        const sandbox = data.settings?.sandboxMode || false;
        const apiUrl = getApiUrl(sandbox);

        // Pobierz zamówienia z ostatnich 24h
        const fromDate = new Date();
        fromDate.setHours(fromDate.getHours() - 24);

        let imported = 0;
        let skipped = 0;
        let offset = 0;
        const limit = 100;
        let hasMore = true;

        while (hasMore) {
          const url = new URL(`${apiUrl}/order/checkout-forms`);
          url.searchParams.set("offset", String(offset));
          url.searchParams.set("limit", String(limit));
          url.searchParams.set("updatedAt.gte", fromDate.toISOString());
          url.searchParams.set("sort", "-updatedAt");

          const response = await allegroQueue.add(() =>
            allegroFetch(url.toString(), accessToken)
          );

          if (!response || !response.ok) {
            throw new Error(
              `API error: ${response ? await response.text() : "No response"}`
            );
          }

          const responseData: AllegroCheckoutFormsResponse = await response.json();

          for (const checkoutForm of responseData.checkoutForms.slice(0, 50)) {
            const result = await processCheckoutForm(
              checkoutForm,
              companyId,
              integrationId,
              db,
              accessToken,
              apiUrl
            );
            if (result === "imported") imported++;
            else skipped++;

            // 100ms przerwy
            await new Promise((resolve) => setTimeout(resolve, 100));
          }

          offset += limit;
          hasMore = responseData.checkoutForms.length === limit && (imported + skipped) < 150;
        }

        // Aktualizuj statystyki
        if (imported > 0) {
          await doc.ref.update({
            lastSyncAt: FieldValue.serverTimestamp(),
            "stats.totalOrdersImported": FieldValue.increment(imported),
            updatedAt: FieldValue.serverTimestamp(),
            lastError: null,
          });
        }

        console.log(
          `Auto-sync ${companyId}/${integrationId}: imported ${imported} orders`
        );
      } catch (error) {
        console.error(`Auto-sync failed for ${doc.id}:`, error);
        await doc.ref.update({
          lastError: `Auto-sync failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  }
);
