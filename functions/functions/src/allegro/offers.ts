import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getApiUrl, allegroFetch, allegroQueue, getValidAllegroToken } from "./helpers";
import { AllegroOffer, AllegroOffersResponse, ProductMapping } from "./types";

const encryptionKey = defineSecret("MASTER_ENCRYPTION_KEY");
const allegroClientId = defineSecret("ALLEGRO_CLIENT_ID");
const allegroClientSecret = defineSecret("ALLEGRO_CLIENT_SECRET");

// ============================================
// FETCH OFFERS
// ============================================

export const fetchAllegroOffers = onCall(
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

    const { companyId, integrationId, limit = 1000 } = request.data;

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

    // Pobierz oferty z Allegro
    let allOffers: AllegroOffer[] = [];
    let offset = 0;
    const pageLimit = 100;
    let hasMore = true;

    while (hasMore && allOffers.length < limit) {
      const url = new URL(`${apiUrl}/sale/product-offers`);
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", String(pageLimit));
      url.searchParams.set("publication.status", "ACTIVE");

      const response = await allegroQueue.add(() =>
        allegroFetch(url.toString(), accessToken)
      );

      if (!response || !response.ok) {
        const errorText = response ? await response.text() : "No response";
        console.error("Allegro API error:", errorText);
        throw new HttpsError("internal", "Błąd pobierania ofert z Allegro");
      }

      const data: AllegroOffersResponse = await response.json();
      allOffers = allOffers.concat(data.offers);

      offset += pageLimit;
      hasMore = data.offers.length === pageLimit && allOffers.length < limit;
    }

    console.log(`Fetched ${allOffers.length} offers from Allegro`);

    // Przetwórz oferty i utwórz/zaktualizuj mapowania
    let imported = 0;
    let updated = 0;
    let autoMapped = 0;

    const batch = db.batch();
    const mappingsRef = db
      .collection("companies")
      .doc(companyId)
      .collection("productMappings");

    for (const offer of allOffers) {
      // Sprawdź czy mapowanie już istnieje
      const existingMapping = await mappingsRef
        .where("source", "==", "ALLEGRO")
        .where("externalOfferId", "==", offer.id)
        .limit(1)
        .get();

      const offerData = {
        externalOfferId: offer.id,
        externalOfferName: offer.name,
        externalSku: offer.external?.id || null,
        externalEan: offer.ean || null,
        externalImageUrl: offer.primaryImage?.url || null,
        externalPrice: parseFloat(offer.sellingMode.price.amount),
        externalStock: offer.stock.available,
        updatedAt: FieldValue.serverTimestamp() as any,
      };

      if (!existingMapping.empty) {
        // Aktualizuj istniejące mapowanie
        batch.update(existingMapping.docs[0].ref, offerData);
        updated++;
      } else {
        // Utwórz nowe mapowanie
        const newMappingRef = mappingsRef.doc();

        // Próba auto-mapowania po SKU lub EAN
        let crmProductId: string | null = null;
        let crmProductSku: string | null = null;
        let crmProductName: string | null = null;
        let mappingStatus: "mapped" | "unmapped" | "auto_mapped" = "unmapped";

        // Szukaj po SKU
        if (offer.external?.id) {
          const productBySku = await db
            .collection("companies")
            .doc(companyId)
            .collection("products")
            .where("sku", "==", offer.external.id)
            .limit(1)
            .get();

          if (!productBySku.empty) {
            const product = productBySku.docs[0];
            crmProductId = product.id;
            crmProductSku = product.data().sku;
            crmProductName = product.data().name;
            mappingStatus = "auto_mapped";
            autoMapped++;
          }
        }

        // Jeśli nie znaleziono po SKU, szukaj po EAN
        if (!crmProductId && offer.ean) {
          const productByEan = await db
            .collection("companies")
            .doc(companyId)
            .collection("products")
            .where("ean", "==", offer.ean)
            .limit(1)
            .get();

          if (!productByEan.empty) {
            const product = productByEan.docs[0];
            crmProductId = product.id;
            crmProductSku = product.data().sku;
            crmProductName = product.data().name;
            mappingStatus = "auto_mapped";
            autoMapped++;
          }
        }

        const newMapping: Omit<ProductMapping, "id"> = {
          source: "ALLEGRO",
          ...offerData,
          crmProductId,
          crmProductSku,
          crmProductName,
          status: mappingStatus,
          mappedAt: (crmProductId ? FieldValue.serverTimestamp() : null) as any,
          mappedBy: crmProductId ? "auto" : null,
          syncStockToAllegro: false,
          lastStockSyncAt: null,
          companyId,
          integrationId,
          createdAt: FieldValue.serverTimestamp() as any,
        };

        batch.set(newMappingRef, newMapping);
        imported++;
      }
    }

    await batch.commit();

    // Aktualizuj statystyki integracji
    await integrationRef.update({
      "stats.totalProductsMapped": autoMapped,
      updatedAt: FieldValue.serverTimestamp(),
      lastError: null,
    });

    console.log(
      `Allegro offers sync: imported=${imported}, updated=${updated}, autoMapped=${autoMapped}`
    );

    return {
      imported,
      updated,
      autoMapped,
      total: allOffers.length,
    };
  }
);

// ============================================
// GET MAPPINGS
// ============================================

export const getAllegroMappings = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Musisz być zalogowany");
    }

    const { companyId, integrationId, status, limit = 100, offset = 0 } = request.data;

    if (!companyId) {
      throw new HttpsError("invalid-argument", "Brak companyId");
    }

    const db = getFirestore();
    let query = db
      .collection("companies")
      .doc(companyId)
      .collection("productMappings")
      .where("source", "==", "ALLEGRO");

    if (integrationId) {
      query = query.where("integrationId", "==", integrationId);
    }

    if (status) {
      query = query.where("status", "==", status);
    }

    const snapshot = await query
      .orderBy("externalOfferName")
      .limit(limit)
      .offset(offset)
      .get();

    const mappings = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return { mappings, count: mappings.length };
  }
);

// ============================================
// UPDATE MAPPING (ręczne mapowanie)
// ============================================

export const updateAllegroMapping = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Musisz być zalogowany");
    }

    const { companyId, mappingId, crmProductId } = request.data;

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

    if (crmProductId) {
      // Pobierz dane produktu CRM
      const productRef = db
        .collection("companies")
        .doc(companyId)
        .collection("products")
        .doc(crmProductId);

      const productSnap = await productRef.get();
      if (!productSnap.exists) {
        throw new HttpsError("not-found", "Produkt CRM nie istnieje");
      }

      const productData = productSnap.data()!;

      await mappingRef.update({
        crmProductId,
        crmProductSku: productData.sku || null,
        crmProductName: productData.name || null,
        status: "mapped",
        mappedAt: FieldValue.serverTimestamp(),
        mappedBy: request.auth.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      // Usuń mapowanie
      await mappingRef.update({
        crmProductId: null,
        crmProductSku: null,
        crmProductName: null,
        status: "unmapped",
        mappedAt: null,
        mappedBy: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return { success: true };
  }
);

// ============================================
// DELETE MAPPING
// ============================================

export const deleteAllegroMapping = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Musisz być zalogowany");
    }

    const { companyId, mappingId } = request.data;

    if (!companyId || !mappingId) {
      throw new HttpsError("invalid-argument", "Brak companyId lub mappingId");
    }

    const db = getFirestore();
    await db
      .collection("companies")
      .doc(companyId)
      .collection("productMappings")
      .doc(mappingId)
      .delete();

    return { success: true };
  }
);

// ============================================
// SEARCH CRM PRODUCTS (dla UI mapowania)
// ============================================

export const searchCrmProducts = onCall(
  { cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Musisz być zalogowany");
    }

    const { companyId, query, limit = 20 } = request.data;

    if (!companyId || !query) {
      throw new HttpsError("invalid-argument", "Brak companyId lub query");
    }

    const db = getFirestore();

    // Szukaj po SKU (startsWith)
    const bySkuSnapshot = await db
      .collection("companies")
      .doc(companyId)
      .collection("products")
      .where("sku", ">=", query.toUpperCase())
      .where("sku", "<=", query.toUpperCase() + "\uf8ff")
      .limit(limit)
      .get();

    // Szukaj po nazwie (jeśli mało wyników po SKU)
    let products = bySkuSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    if (products.length < limit) {
      // Dodatkowe wyszukiwanie (można rozbudować o Algolia/Typesense)
      const byNameSnapshot = await db
        .collection("companies")
        .doc(companyId)
        .collection("products")
        .orderBy("name")
        .limit(limit)
        .get();

      const additionalProducts = byNameSnapshot.docs
        .filter((doc) => {
          const name = doc.data().name?.toLowerCase() || "";
          return name.includes(query.toLowerCase());
        })
        .map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

      // Deduplikacja
      const existingIds = new Set(products.map((p) => p.id));
      for (const product of additionalProducts) {
        if (!existingIds.has(product.id)) {
          products.push(product);
        }
      }
    }

    return { products: products.slice(0, limit) };
  }
);
