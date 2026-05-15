import { onCall, HttpsError } from "firebase-functions/v2/https";
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
  AllegroOffer,
  AllegroOffersResponse,
  AllegroCheckoutFormsResponse,
  CrmOrder,
} from "./types";

const encryptionKey = defineSecret("MASTER_ENCRYPTION_KEY");
const allegroClientId = defineSecret("ALLEGRO_CLIENT_ID");
const allegroClientSecret = defineSecret("ALLEGRO_CLIENT_SECRET");

// Helper: Mapuj kod kraju na nazwę
function getCountryName(countryCode: string): string {
  const countries: Record<string, string> = {
    PL: "Polska",
    DE: "Niemcy",
    CZ: "Czechy",
    SK: "Słowacja",
    AT: "Austria",
    HU: "Węgry",
    LT: "Litwa",
    LV: "Łotwa",
    EE: "Estonia",
  };
  return countries[countryCode] || countryCode;
}

export const importAllegroData = onCall(
  {
    secrets: [encryptionKey, allegroClientId, allegroClientSecret],
    timeoutSeconds: 540,
    memory: "1GiB",
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Musisz być zalogowany");
    }

    const { companyId, integrationId, days } = request.data;

    if (!companyId || !integrationId) {
      throw new HttpsError("invalid-argument", "Brak companyId lub integrationId");
    }

    const requestedDays = parseInt(days) || 7;
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
    if (integration.type !== "allegro") {
      throw new HttpsError("invalid-argument", "To nie jest integracja Allegro");
    }

    const sandbox = integration.settings?.sandboxMode || false;
    console.log(`Import mode: ${sandbox ? "SANDBOX" : "PRODUCTION"}`);

    const { accessToken } = await getValidAllegroToken(
      companyId,
      integrationId,
      encryptionKey.value(),
      allegroClientId.value(),
      allegroClientSecret.value(),
      sandbox
    );

    const apiUrl = getApiUrl(sandbox);

    // ============================================
    // FAZA 1: POBIERZ PRODUKTY (OFFERS)
    // ============================================
    let allOffers: AllegroOffer[] = [];
    let offset = 0;
    const pageLimit = 100;
    let hasMoreOffers = true;

    console.log("=== FAZA 1: START ===");
    console.log(`Endpoint: ${apiUrl}/sale/product-offers`);
    console.log(`Token length: ${accessToken?.length}`);

    while (hasMoreOffers) {
      const url = new URL(`${apiUrl}/sale/offers`);
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", String(pageLimit));
      url.searchParams.set("publication.status", "ACTIVE");

      const response = await allegroQueue.add(() =>
        allegroFetch(url.toString(), accessToken)
      );

      if (!response || !response.ok) {
        const errorText = response ? await response.text() : "No response";
        console.error("Allegro API error during products fetch:", errorText);
        throw new HttpsError("internal", `Błąd pobierania ofert z Allegro: ${errorText}`);
      }

      const data: AllegroOffersResponse = await response.json();
      
      // Po pierwszym pobraniu:
      if (offset === 0) {
        console.log(`Pierwsza strona: ${data.offers?.length || 0} ofert`);
        if (data.offers?.[0]) {
          console.log(`Przykład oferty:`, {
            id: data.offers[0].id,
            name: data.offers[0].name,
            hasImage: !!data.offers[0].primaryImage?.url,
            hasEan: !!data.offers[0].ean,
          });
        }
      }

      allOffers = allOffers.concat(data.offers);

      offset += pageLimit;
      hasMoreOffers = data.offers.length === pageLimit;

      // Rate limiting: 100ms
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    let productsCount = 0;
    const mappingsRef = db
      .collection("companies")
      .doc(companyId)
      .collection("productMappings");

    let batch = db.batch();
    
    // Cache for phase 2 (Map of allegroOfferId -> product data)
    const offerDetailsCache = new Map<string, { imageUrl: string, ean: string, name: string, externalSku: string }>();

    for (const offer of allOffers) {
      productsCount++;
      
      // Cache dla FAZY 2
      offerDetailsCache.set(offer.id, {
        imageUrl: offer.primaryImage?.url || "",
        ean: "",
        name: offer.name || "",
        externalSku: offer.external?.id || ""
      });

      // Użyj offer.id jako ID dokumentu - eliminuje potrzebę query!
      const mappingRef = mappingsRef.doc(offer.id);
      
      batch.set(mappingRef, {
        source: "ALLEGRO",
        externalOfferId: offer.id,
        externalOfferName: offer.name || null,
        externalSku: offer.external?.id || null,
        externalEan: null,
        externalImageUrl: offer.primaryImage?.url || null,
        externalPrice: parseFloat(offer.sellingMode?.price?.amount || "0"),
        externalStock: offer.stock?.available || 0,
        companyId,
        integrationId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      // Limit batche (Firestore uciągnie max. 500)
      if (productsCount % 450 === 0) {
          await batch.commit();
          batch = db.batch();
          console.log(`Zapisano ${productsCount} produktów...`);
      }
    }
    // Docomituj reszte
    if (productsCount % 450 !== 0) {
        await batch.commit();
    }


    // ============================================
    // FAZA 2: POBIERZ ZAMÓWIENIA (CHECKOUT-FORMS)
    // ============================================
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - requestedDays);

    let importedOrders = 0;
    let updatedOrders = 0;
    let skippedOrders = 0;

    let ordersOffset = 0;
    const ordersLimit = 100;
    let hasMoreOrders = true;

    // Helper statistics
    const statsRef = db.collection("companies").doc(companyId).collection("stats").doc("orders");
    const statsSnap = await statsRef.get();
    let orderCounter = statsSnap.data()?.allegroCounter || 0;

    while (hasMoreOrders) {
      const url = new URL(`${apiUrl}/order/checkout-forms`);
      url.searchParams.set("offset", String(ordersOffset));
      url.searchParams.set("limit", String(ordersLimit));
      url.searchParams.set("updatedAt.gte", fromDate.toISOString());
      url.searchParams.set("sort", "-updatedAt");

      const response = await allegroQueue.add(() =>
        allegroFetch(url.toString(), accessToken)
      );

      if (!response || !response.ok) {
        const errorText = response ? await response.text() : "No response";
        console.error("Allegro API error during orders fetch:", errorText);
        throw new HttpsError("internal", `Błąd pobierania zamówień z Allegro: ${errorText}`);
      }

      const data: AllegroCheckoutFormsResponse = await response.json();

      for (const checkoutForm of data.checkoutForms) {
        // Sprawdź czy zamówienie istnieje
        const existingOrderQuery = await db
          .collection("companies")
          .doc(companyId)
          .collection("orders")
          .where("source", "==", "ALLEGRO")
          .where("externalId", "==", checkoutForm.id)
          .limit(1)
          .get();

        const existingData = !existingOrderQuery.empty ? existingOrderQuery.docs[0].data() : null;

        let needsUpdate = false;
        if (existingData) {
           needsUpdate = checkoutForm.updatedAt !== existingData.allegroUpdatedAt || existingData.items?.length === 0;
        }

        if (!existingOrderQuery.empty && !needsUpdate) {
            skippedOrders++;
            continue;
        }

        // Będziemy przetwarzać - weź Order ID
        let currentOrderNumber = "";
        if (existingData && existingData.orderNumber) {
           currentOrderNumber = existingData.orderNumber;
        } else {
           orderCounter++;
           currentOrderNumber = generateOrderNumber("AL", orderCounter);
        }

        // Mapuj produkty korzystając z lokalnego cache by nie uderzać do API ponownie
        const details = checkoutForm;
        const lineItemsList = details.lineItems || [];
        
        const items = lineItemsList.map((item: any) => {
          const offerId = item.offer?.id || "";
          
          let offerImage = "";
          let offerEan = "";
          let offerSku = item.offer?.external?.id || "";
          let offerName = item.offer?.name;
          
          if (offerId && offerDetailsCache.has(offerId)) {
             const cached = offerDetailsCache.get(offerId)!;
             offerImage = cached.imageUrl;
             offerEan = cached.ean;
             if (!offerSku) offerSku = cached.externalSku;
             if (!offerName) offerName = cached.name;
          }

          return {
            sku: offerSku || "",
            name: offerName || "Nieznany produkt",
            quantity: item.quantity || 1,
            price: parseFloat(item.price?.amount || "0"),
            currency: item.price?.currency || "PLN",
            vat: parseFloat(item.tax?.rate || "23"),
            weight: 0,
            imageUrl: offerImage,
            ean: offerEan,
            allegroOfferId: offerId,
            allegroLineItemId: item.id || "",
            crmProductId: null // Zostanie mapowane asynchronicznie przez trigger produktu lub inventory
          };
        });

        // Wysiylka pickup point
        let mappedPickupPoint = null;
        if ((details.delivery as any)?.pickupPoint) {
            const pp = (details.delivery as any).pickupPoint;
            mappedPickupPoint = {
              id: pp.id || "",
              name: pp.name || "",
              address: pp.address?.street || "",
              city: pp.address?.city || "",
              zipCode: pp.address?.zipCode || "",
              countryCode: pp.address?.countryCode || "PL"
            };
        }

        // Odbiorca
        let recipientCountryCode = details.buyer?.address?.countryCode || "PL";
        if ((details.delivery?.address as any)?.countryCode) {
           recipientCountryCode = (details.delivery.address as any).countryCode;
        }

        const crmOrder: Partial<CrmOrder> = {
          source: "ALLEGRO",
          externalId: details.id,
          orderNumber: currentOrderNumber,
          integrationId,
          status: existingData ? existingData.status : mapAllegroStatusToCrm(details.status, (details as any).fulfillment?.status || ""),
          countryCode: recipientCountryCode,
          currency: details.summary?.totalToPay?.currency || "PLN",
          
          items,

          buyer: {
            id: details.buyer?.id || "",
            login: details.buyer?.login || "",
            email: details.buyer?.email || "",
            phone: details.buyer?.phoneNumber || "",
            firstName: details.buyer?.firstName || "",
            lastName: details.buyer?.lastName || "",
            companyName: (details.buyer as any)?.companyName || null,
            isGuest: (details.buyer as any)?.guest || false,
          },

          payment: Object.keys(details.payment || {}).length > 0 ? {
            type: details.payment?.type || "UNKNOWN",
            provider: details.payment?.provider || "UNKNOWN",
            status: (details.payment as any)?.status || "UNKNOWN",
            paidAmount: parseFloat(details.payment?.paidAmount?.amount || "0"),
            totalAmount: parseFloat(details.summary?.totalToPay?.amount || "0"),
            currency: details.payment?.paidAmount?.currency || "PLN",
            finishedAt: details.payment?.finishedAt || null
          } : undefined,

          delivery: {
            method: details.delivery?.method?.name || "",
            methodId: details.delivery?.method?.id || "",
            cost: parseFloat(details.delivery?.cost?.amount || "0"),
            currency: details.delivery?.cost?.currency || "PLN",
            smart: details.delivery?.smart || false,
          } as any,

          pickupPoint: mappedPickupPoint,

          recipient: {
            firstName: details.delivery?.address?.firstName || details.buyer?.firstName || "",
            lastName: details.delivery?.address?.lastName || details.buyer?.lastName || "",
            companyName: details.delivery?.address?.companyName || "",
            email: details.buyer?.email || "",
            phone: details.delivery?.address?.phoneNumber || details.buyer?.phoneNumber || "",
            address: {
              street: details.delivery?.address?.street || "",
              city: details.delivery?.address?.city || "",
              zipCode: details.delivery?.address?.zipCode || "",
              country: getCountryName(recipientCountryCode),
              countryCode: recipientCountryCode,
            },
          },
          
          invoice: details.invoice?.required ? {
              required: true,
              companyName: details.invoice?.address?.company?.name || "",
              taxId: details.invoice?.address?.company?.taxId || "",
          } : { required: false },

          orderedAt: details.lineItems?.[0]?.boughtAt 
            ? new Date(details.lineItems[0].boughtAt) 
            : new Date(details.updatedAt),
        };

        if (existingData) {
            // DONT overwrite createdAt
            await existingOrderQuery.docs[0].ref.update({
                ...crmOrder,
                updatedAt: FieldValue.serverTimestamp() as unknown as Date,
            });
            updatedOrders++;
        } else {
            // NEW ORDER: set createdAt to now
            await db.collection("companies").doc(companyId).collection("orders").add({
                ...crmOrder,
                createdAt: FieldValue.serverTimestamp() as unknown as Date,
                updatedAt: FieldValue.serverTimestamp() as unknown as Date,
            });
            importedOrders++;
        }

        // Rate limiting: 100ms
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      ordersOffset += ordersLimit;
      hasMoreOrders = data.checkoutForms.length === ordersLimit;
    }

    // Uaktualnij statystyki
    await statsRef.set(
      {
        allegroCounter: orderCounter,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Aktualizuj statystyki integracji
    await integrationRef.update({
      lastSyncAt: FieldValue.serverTimestamp(),
      "stats.totalOrdersImported": FieldValue.increment(importedOrders),
      updatedAt: FieldValue.serverTimestamp(),
      lastError: null,
    });

    console.log(`Allegro unified import for ${companyId}: imported=${importedOrders}, updated=${updatedOrders}, skipped=${skippedOrders}, products=${productsCount}`);

    return { 
      success: true, 
      products: productsCount,
      ordersImported: importedOrders, 
      ordersUpdated: updatedOrders,
      ordersSkipped: skippedOrders, 
      message: `Pobrano ${importedOrders} nowych, zaktualizowano ${updatedOrders} zamówień oraz ${productsCount} produktów`
    };
  }
);
