import * as functions from "firebase-functions/v2";
import { getFirestore } from "firebase-admin/firestore";

const db = getFirestore();

export const backfillPreviewHelpersV2 = functions.https.onCall(async (request) => {
    try {
        if (!request.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'User not authenticated');
        }

        const companyId = request.data.companyId;
        if (!companyId) {
             throw new functions.https.HttpsError('invalid-argument', 'companyId is required');
        }

        // Zabezpieczenie batcha
        const BATCH_SIZE = 400;
        let processedCount = 0;
        let skippedCount = 0;
        let updatedCount = 0;
        let errorCount = 0;

        const ordersRef = db.collection(`companies/${companyId}/orders`);
        // Pobieramy całą kolekcję (jeśli baza jest ogromna - należy wdrożyć paginację limit/startAfter)
        const ordersSnapshot = await ordersRef.get();

        const chunks = [];
        for (let i = 0; i < ordersSnapshot.docs.length; i += BATCH_SIZE) {
             chunks.push(ordersSnapshot.docs.slice(i, i + BATCH_SIZE));
        }

        for (const chunk of chunks) {
            let currentBatch = db.batch();
            let opsInBatch = 0;

            for (const orderDoc of chunk) {
                processedCount++;
                const orderData = orderDoc.data();

                // Idempotentność - jeśli to już wersja 2 (albo nowsza, jeśli dojdą), pomiń.
                if (orderData.orderHelpersVersion >= 2) {
                    skippedCount++;
                    continue;
                }

                try {
                    // Pobierz Order Items dla tego zamówienia
                    const orderItemsSnap = await db.collection(`companies/${companyId}/orderItems`)
                         .where('orderId', '==', orderDoc.id)
                         .get();

                    const itemsCount = orderItemsSnap.docs.reduce((acc, doc) => acc + (doc.data().qtyOrdered || 1), 0);
                    const firstItemDoc = orderItemsSnap.docs[0];
                    let firstItemData = firstItemDoc ? firstItemDoc.data() : null;

                    let firstItemSource: 'crm_product' | 'order_fallback' = 'order_fallback';
                    let firstItemProductId = '';
                    let firstItemImageUrl = '';
                    let firstItemName = firstItemData?.name || '';
                    let firstItemSku = firstItemData?.sku || '';
                    let firstItemEan = firstItemData?.ean || '';

                    // Jeśli pozycja ma mapowanie - pobieramy docelowy Product CRM z bazy i pobieramy aktualne dane!
                    if (firstItemData && firstItemData.mappingStatus === 'mapped' && firstItemData.productId) {
                        const productSnap = await db.collection(`companies/${companyId}/products`).doc(firstItemData.productId).get();
                        if (productSnap.exists) {
                            const productData = productSnap.data();
                            firstItemSource = 'crm_product';
                            firstItemProductId = firstItemData.productId;
                            // Priorytet zdjęć
                            firstItemImageUrl = productData?.imageThumbUrl || productData?.imageMainUrl || (productData?.images ? productData.images[0] : '') || '';
                            firstItemName = productData?.name || firstItemData.name || '';
                            firstItemSku = productData?.sku || firstItemData.sku || '';
                            firstItemEan = productData?.ean || firstItemData.ean || '';
                        }
                    }

                    // Przygotowanie update'u
                    const updates: any = {
                        orderHelpersVersion: 2,
                        itemCount: itemsCount,
                        firstItemSource,
                        firstItemProductId,
                        firstItemImageUrl,
                        firstItemName,
                        firstItemSku,
                        firstItemEan
                    };

                    currentBatch.update(orderDoc.ref, updates);
                    opsInBatch++;
                    updatedCount++;
                } catch (e) {
                     console.error(`Błąd przy procesowaniu zamówienia ${orderDoc.id}:`, e);
                     errorCount++;
                }
            }

            if (opsInBatch > 0) {
               await currentBatch.commit();
            }
        }

        return {
            status: 'success',
            scanned: processedCount,
            skipped: skippedCount,
            updated: updatedCount,
            errors: errorCount
        };
        
    } catch (error) {
         console.error("Backfill failed:", error);
         throw new functions.https.HttpsError('internal', "Backfill V2 error", error);
    }
});
