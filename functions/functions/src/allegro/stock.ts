// @ts-nocheck
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApiUrl, allegroFetch, allegroQueue, getValidAllegroToken } from "./helpers";
import { StockSyncResult } from "./types";

const encryptionKey = defineSecret("MASTER_ENCRYPTION_KEY");
const allegroClientId = defineSecret("ALLEGRO_CLIENT_ID");
const allegroClientSecret = defineSecret("ALLEGRO_CLIENT_SECRET");

// ============================================
// TRIGGER: Auto-sync stock przy zmianie inventoryStock
// ============================================

export const onInventoryStockChangeSyncAllegro = onDocumentWritten(
  {
    document: "companies/{companyId}/inventoryStock/{stockId}",
    secrets: [encryptionKey, allegroClientId, allegroClientSecret],
  },
  async (event) => {
    const beforeData = event.data?.before?.data();
    const afterData = event.data?.after?.data();

    // Dokument usunięty - ustaw stan na 0
    if (!afterData && beforeData) {
      await syncStockToAllegro(
        event.params.companyId,
        beforeData.productId || beforeData.sku,
        0
      );
      return;
    }

    // Brak danych
    if (!afterData) return;

    // Sprawdź czy qtyAvailable się zmieniło
    const previousQty = beforeData?.qtyAvailable ?? 0;
    const newQty = afterData.qtyAvailable ?? 0;

    if (previousQty === newQty) return;

    const productId = afterData.productId;
    const sku = afterData.sku;

    if (!productId && !sku) {
      console.log("inventoryStock without productId or sku, skipping");
      return;
    }

    console.log(
      `Stock changed for ${sku || productId}: ${previousQty} -> ${newQty}`
    );

    await syncStockToAllegro(
      event.params.companyId,
      productId || sku,
      newQty
    );
  }
);

// ============================================
// HELPER: Sync stock to Allegro
// ============================================

async function syncStockToAllegro(
  companyId: string,
  productIdOrSku: string,
  quantity: number
): Promise<void> {
  const db = getFirestore();

  // Znajdź mapowania dla tego produktu
  const mappingsQuery = await db
    .collection("companies")
    .doc(companyId)
    .collection("productMappings")
    .where("source", "==", "ALLEGRO")
    .where("status", "==", "mapped")
    .where("crmProductId", "==", productIdOrSku)
    .get();

  // Jeśli nie znaleziono po productId, spróbuj po SKU
  let mappings = mappingsQuery.docs;
  if (mappings.length === 0) {
    const skuMappingsQuery = await db
      .collection("companies")
      .doc(companyId)
      .collection("productMappings")
      .where("source", "==", "ALLEGRO")
      .where("status", "==", "mapped")
      .where("crmSku", "==", productIdOrSku)
      .get();
    mappings = skuMappingsQuery.docs;
  }

  if (mappings.length === 0) {
    console.log(`No Allegro mappings found for ${productIdOrSku}`);
    return;
  }

  console.log(`Found ${mappings.length} Allegro mappings for ${productIdOrSku}`);

  // Grupuj mapowania po integrationId
  const mappingsByIntegration = new Map<string, typeof mappings>();
  for (const mapping of mappings) {
    const data = mapping.data();
    const integrationId = data.integrationId;
    if (!mappingsByIntegration.has(integrationId)) {
      mappingsByIntegration.set(integrationId, []);
    }
    mappingsByIntegration.get(integrationId)!.push(mapping);
  }

  // Dla każdej integracji zaktualizuj stany
  for (const [integrationId, integrationMappings] of mappingsByIntegration) {
    try {
      // Pobierz integrację
      const integrationRef = db
        .collection("companies")
        .doc(companyId)
        .collection("integrations")
        .doc(integrationId);

      const integrationSnap = await integrationRef.get();
      if (!integrationSnap.exists) {
        console.error(`Integration ${integrationId} not found`);
        continue;
      }

      const integration = integrationSnap.data()!;

      // Sprawdź czy sync stanów jest włączony
      if (!integration.settings?.syncStockToAllegro) {
        console.log(`Stock sync disabled for integration ${integrationId}`);
        continue;
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

      // Zaktualizuj każdą ofertę
      for (const mappingDoc of integrationMappings) {
        const mapping = mappingDoc.data();
        const offerId = mapping.externalOfferId;

        try {
          // Allegro używa "offer-quantity-change-commands" do zmiany stanów
          const commandId = `stock-sync-${Date.now()}-${Math.random().toString(36).substring(7)}`;

          const response = await allegroQueue.add(() =>
            allegroFetch(
              `${apiUrl}/sale/offer-quantity-change-commands/${commandId}`,
              accessToken,
              {
                method: "PUT",
                body: JSON.stringify({
                  modification: {
                    changeType: "FIXED",
                    value: Math.max(0, quantity), // Allegro nie akceptuje ujemnych
                  },
                  offerCriteria: [
                    {
                      offers: [{ id: offerId }],
                      type: "CONTAINS_OFFERS",
                    },
                  ],
                }),
              }
            )
          );

          if (!response || !response.ok) {
            const errorText = response ? await response.text() : "No response";
            throw new Error(`Allegro API error: ${errorText}`);
          }

          console.log(`Stock updated for Allegro offer ${offerId}: ${quantity}`);

          // Zaktualizuj mapping
          await mappingDoc.ref.update({
            lastStockSyncAt: FieldValue.serverTimestamp(),
            lastStockValue: quantity,
            stockSyncError: null,
          });

        } catch (error) {
          console.error(`Failed to update stock for offer ${offerId}:`, error);
          await mappingDoc.ref.update({
            stockSyncError: error instanceof Error ? error.message : "Unknown error",
            lastStockSyncAttempt: FieldValue.serverTimestamp(),
          });
        }
      }

    } catch (error) {
      console.error(`Failed to process integration ${integrationId}:`, error);
    }
  }
}

// ============================================
// MANUAL: Synchronizuj wszystkie stany
// ============================================

export const syncAllStockToAllegro = onCall(
  {
    secrets: [encryptionKey, allegroClientId, allegroClientSecret],
    timeoutSeconds: 540, // 9 minut
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

    // Pobierz wszystkie zmapowane produkty dla tej integracji
    const mappingsSnap = await db
      .collection("companies")
      .doc(companyId)
      .collection("productMappings")
      .where("source", "==", "ALLEGRO")
      .where("integrationId", "==", integrationId)
      .where("status", "==", "mapped")
      .get();

    const results: StockSyncResult[] = [];
    let synced = 0;
    let failed = 0;

    for (const mappingDoc of mappingsSnap.docs) {
      const mapping = mappingDoc.data();
      const offerId = mapping.externalOfferId;
      const crmProductId = mapping.crmProductId;
      const crmSku = mapping.crmSku;

      // Pobierz aktualny stan z inventoryStock
      let currentQty = 0;

      // Szukaj po productId
      const stockByProductQuery = await db
        .collection("companies")
        .doc(companyId)
        .collection("inventoryStock")
        .where("productId", "==", crmProductId)
        .limit(1)
        .get();

      if (!stockByProductQuery.empty) {
        currentQty = stockByProductQuery.docs[0].data().qtyAvailable || 0;
      } else if (crmSku) {
        // Szukaj po SKU
        const stockBySkuQuery = await db
          .collection("companies")
          .doc(companyId)
          .collection("inventoryStock")
          .where("sku", "==", crmSku)
          .limit(1)
          .get();

        if (!stockBySkuQuery.empty) {
          currentQty = stockBySkuQuery.docs[0].data().qtyAvailable || 0;
        }
      }

      const previousQty = mapping.lastStockValue ?? -1;

      try {
        const commandId = `stock-sync-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        const response = await allegroQueue.add(() =>
          allegroFetch(
            `${apiUrl}/sale/offer-quantity-change-commands/${commandId}`,
            accessToken,
            {
              method: "PUT",
              body: JSON.stringify({
                modification: {
                  changeType: "FIXED",
                  value: Math.max(0, currentQty),
                },
                offerCriteria: [
                  {
                    offers: [{ id: offerId }],
                    type: "CONTAINS_OFFERS",
                  },
                ],
              }),
            }
          )
        );

        if (!response || !response.ok) {
          const errorText = response ? await response.text() : "No response";
          throw new Error(`Allegro API error: ${errorText}`);
        }

        await mappingDoc.ref.update({
          lastStockSyncAt: FieldValue.serverTimestamp(),
          lastStockValue: currentQty,
          stockSyncError: null,
        });

        results.push({
          offerId,
          sku: crmSku || crmProductId,
          previousQty,
          newQty: currentQty,
          success: true,
        });

        synced++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";

        await mappingDoc.ref.update({
          stockSyncError: errorMessage,
          lastStockSyncAttempt: FieldValue.serverTimestamp(),
        });

        results.push({
          offerId,
          sku: crmSku || crmProductId,
          previousQty,
          newQty: currentQty,
          success: false,
          error: errorMessage,
        });

        failed++;
      }
    }

    // Zaktualizuj integrację
    await integrationRef.update({
      lastStockSyncAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`Stock sync for ${companyId}: synced=${synced}, failed=${failed}`);

    return { synced, failed, results };
  }
);

// ============================================
// MANUAL: Synchronizuj pojedynczy produkt
// ============================================

export const syncSingleStockToAllegro = onCall(
  {
    secrets: [encryptionKey, allegroClientId, allegroClientSecret],
    cors: true,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Musisz być zalogowany");
    }

    const { companyId, mappingId, quantity } = request.data;

    if (!companyId || !mappingId) {
      throw new HttpsError("invalid-argument", "Brak companyId lub mappingId");
    }

    const db = getFirestore();

    // Pobierz mapping
    const mappingRef = db
      .collection("companies")
      .doc(companyId)
      .collection("productMappings")
      .doc(mappingId);

    const mappingSnap = await mappingRef.get();
    if (!mappingSnap.exists) {
      throw new HttpsError("not-found", "Mapowanie nie istnieje");
    }

    const mapping = mappingSnap.data()!;
    const offerId = mapping.externalOfferId;
    const integrationId = mapping.integrationId;

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

    // Oblicz ilość do wysłania
    let qtyToSync = quantity;

    if (qtyToSync === undefined || qtyToSync === null) {
      // Pobierz z inventoryStock
      const crmProductId = mapping.crmProductId;
      const crmSku = mapping.crmSku;

      const stockQuery = await db
        .collection("companies")
        .doc(companyId)
        .collection("inventoryStock")
        .where("productId", "==", crmProductId)
        .limit(1)
        .get();

      if (!stockQuery.empty) {
        qtyToSync = stockQuery.docs[0].data().qtyAvailable || 0;
      } else if (crmSku) {
        const skuQuery = await db
          .collection("companies")
          .doc(companyId)
          .collection("inventoryStock")
          .where("sku", "==", crmSku)
          .limit(1)
          .get();

        if (!skuQuery.empty) {
          qtyToSync = skuQuery.docs[0].data().qtyAvailable || 0;
        } else {
          qtyToSync = 0;
        }
      } else {
        qtyToSync = 0;
      }
    }

    // Wyślij do Allegro
    const commandId = `stock-sync-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const response = await allegroFetch(
      `${apiUrl}/sale/offer-quantity-change-commands/${commandId}`,
      accessToken,
      {
        method: "PUT",
        body: JSON.stringify({
          modification: {
            changeType: "FIXED",
            value: Math.max(0, qtyToSync),
          },
          offerCriteria: [
            {
              offers: [{ id: offerId }],
              type: "CONTAINS_OFFERS",
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new HttpsError("internal", `Błąd Allegro API: ${errorText}`);
    }

    await mappingRef.update({
      lastStockSyncAt: FieldValue.serverTimestamp(),
      lastStockValue: qtyToSync,
      stockSyncError: null,
    });

    return { success: true, quantity: qtyToSync };
  }
);
