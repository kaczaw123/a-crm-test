import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const createManualOrder = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');

  const { companyId, recipient, shippingMethod, courierCode, notes, items, requestId } = data;
  if (!companyId || !items || !Array.isArray(items) || items.length === 0) {
    throw new HttpsError('invalid-argument', 'Pusty koszyk lub brak danych klienta.');
  }
  if (!requestId || typeof requestId !== 'string') {
    throw new HttpsError('invalid-argument', 'Brak klucza idempotencji (requestId). Zaktualizuj klienta.');
  }

  // Weryfikacja Uprawnień
  const memberDoc = await db.collection(`companies/${companyId}/members`).doc(auth.uid).get();
  if (!memberDoc.exists) throw new HttpsError('permission-denied', 'Brak autoryzacji do operacji w tej firmie.');
  // Tu można dodać dodatkową listę dozwolonych ról, ale user zażyczył autoryzacji company members.

  // Przygotowanie identyfikatorów
  const orderId = db.collection(`companies/${companyId}/orders`).doc().id;
  const now = FieldValue.serverTimestamp();

  try {
    await db.runTransaction(async (t) => {
      // 0. IDEMPOTENTNOŚĆ
      const idempotencyRef = db.collection(`companies/${companyId}/idempotencyKeys`).doc(requestId);
      const idempotencyDoc = await t.get(idempotencyRef);
      if (idempotencyDoc.exists) {
        throw new Error('DUPLICATE_ORDER'); // Przechwytywane bezpiecznie poniżej
      }

      // 1. ODCZYTY TRANSAKCYJNE (Produkty + Stany)
      const stockReads = new Map<string, admin.firestore.QueryDocumentSnapshot[]>();
      const productDataMap = new Map<string, any>(); // cache CRM product data for Preview Helpers V2
      let reservationStatus: 'none' | 'partial' | 'full' = 'full';

      for (const item of items) {
        if (!item.productId || typeof item.qtyOrdered !== 'number' || item.qtyOrdered <= 0) {
          throw new HttpsError('invalid-argument', `Nieprawidłowe dane dla wiersza koszyka.`);
        }
        
        // WALIDACJA KARTOTEKI PRODUKTU
        const productRef = db.collection(`companies/${companyId}/products`).doc(item.productId);
        const productSnap = await t.get(productRef);
        
        if (!productSnap.exists) {
          throw new HttpsError('not-found', `Produkt o ID ${item.productId} nie istnieje w rejestrze (nie-autoryzowany koszyk).`);
        }
        
        const productData = productSnap.data();
        if (productData?.status === 'archived' || productData?.status === 'inactive') {
          throw new HttpsError('failed-precondition', `Produkt o ID ${item.productId} jest zarchiwizowany lub zablokowany.`);
        }
        productDataMap.set(item.productId, productData);

        // POBRANIE STANÓW MAGAZYNOWYCH (TYLKO DLA TEGO PRODUKTU)
        const stockQuery = db.collection(`companies/${companyId}/inventoryStock`)
          .where('productId', '==', item.productId);
        
        const snaps = await t.get(stockQuery);
        stockReads.set(item.productId, snaps.docs);
      }

      // Generator unikatowego numeru zamówienia
      // Do refaktoryzacji na twardy licznik w oddzielnym dokumencie Sequence
      const seqDocRef = db.collection(`companies/${companyId}/system`).doc('orderSequence');
      const seqDoc = await t.get(seqDocRef);
      const nextNum = seqDoc.exists ? (seqDoc.data()?.current || 0) + 1 : 1;
      const orderNumber = `ORD/MANUAL/${new Date().getFullYear()}/${String(nextNum).padStart(5, '0')}`;

      // 2. OBLICZENIA LOGIKI BIZNESOWEJ I ZAPISY (WRITES)
      let totalItemsOrdered = 0;
      let totalItemsReserved = 0;

      const orderItemsToSave: any[] = [];
      const reservationsToSave: any[] = [];
      const stockMutationsToSave: { ref: any, payload: any }[] = [];
      const ledgerMutationsToSave: any[] = [];

      // Główny silnik alokacji FIFO po lokacjach
      for (const item of items) {
        let remainingToReserve = item.qtyOrdered;
        let actualReserved = 0;
        totalItemsOrdered += item.qtyOrdered;

        const availableLocationsDocs = stockReads.get(item.productId) || [];
        
        // Sortujemy by najpierw czyścić lokacje z najmniejszym stanem (optymalizacja kubatury) - logiki WMS nie podano dokładnie, bierzemy pierwsze z brzegu
        const locStates = availableLocationsDocs.map(d => ({ ref: d.ref, data: d.data() as any }))
          .filter(loc => loc.data.qtyAvailable > 0);

        for (const loc of locStates) {
          if (remainingToReserve <= 0) break;

          const locAvailable = loc.data.qtyAvailable || 0;
          const locReserved = loc.data.qtyReserved || 0;
          const locOnHand = loc.data.qtyOnHand || 0;
          
          const takeQty = Math.min(locAvailable, remainingToReserve);

          remainingToReserve -= takeQty;
          actualReserved += takeQty;
          totalItemsReserved += takeQty;

          // Mutacja Stanu inventoryStock
          const newReserved = locReserved + takeQty;
          const newAvailable = Math.max(0, locOnHand - newReserved);

          stockMutationsToSave.push({
            ref: loc.ref,
            payload: {
              qtyReserved: newReserved,
              qtyAvailable: newAvailable,
              updatedAt: now
            }
          });

          // Block Rezerwacji stockReservations
          const resRef = db.collection(`companies/${companyId}/stockReservations`).doc();
          reservationsToSave.push({
            ref: resRef,
            payload: {
              orgId: companyId,
              orderId: orderId,
              productId: item.productId,
              locationId: loc.data.warehouseLocationId,
              qtyReserved: takeQty,
              status: 'active',
              createdAt: now
            }
          });

          // Ślad Audytowy Ledger inventoryMovements (z pełnym historycznym Before/After)
          const movRef = db.collection(`companies/${companyId}/inventoryMovements`).doc();
          ledgerMutationsToSave.push({
            ref: movRef,
            payload: {
              orgId: companyId,
              productId: item.productId,
              sku: item.sku || '',
              locationId: loc.data.warehouseLocationId,
              type: 'RESERVATION_CREATE',
              movementType: 'RESERVATION_CREATE',
              quantity: takeQty,
              quantityDelta: takeQty,
              referenceType: 'order',
              referenceId: orderId,
              operatorId: auth.uid,
              before: {
                qtyOnHand: locOnHand,
                qtyReserved: locReserved,
                qtyAvailable: locAvailable
              },
              after: {
                qtyOnHand: locOnHand,
                qtyReserved: newReserved,
                qtyAvailable: newAvailable
              },
              createdAt: now
            }
          });
        }

        // Status Mapowania Order Item
        const orderItemId = db.collection(`companies/${companyId}/orderItems`).doc().id;
        orderItemsToSave.push({
          id: orderItemId,
          orderId: orderId,
          orgId: companyId,
          productId: item.productId,
          sku: item.sku || '',
          ean: item.ean || '',
          name: item.name || '',
          qtyOrdered: item.qtyOrdered,
          qtyReserved: actualReserved,
          qtyPicked: 0,
          qtyShipped: 0,
          mappingStatus: 'mapped'
        });

        if (actualReserved === 0) {
          reservationStatus = 'none';
        } else if (actualReserved < item.qtyOrdered && reservationStatus !== 'none') {
          reservationStatus = 'partial';
        } else if (actualReserved < item.qtyOrdered && reservationStatus === 'none') {
           reservationStatus = 'none'; // fallback down
        }
      }

      // Jeżeli koszyk był ogromny, a towaru było za mało, ustaw status globalny zamówienia wg proporcji
      let finalStatus = 'new';
      
      if (totalItemsReserved === 0) {
         reservationStatus = 'none';
         finalStatus = 'awaiting_stock';
      } else if (totalItemsReserved < totalItemsOrdered) {
         reservationStatus = 'partial';
         finalStatus = 'processing';
      } else {
         reservationStatus = 'full';
         finalStatus = 'new';
      }

      // ZAPISY (Transactions Write Phase)

      // 1. Zapis Seqwencera
      t.set(seqDocRef, { current: nextNum }, { merge: true });

      // 2. Nagłówek Zlecenia
      const orderRef = db.collection(`companies/${companyId}/orders`).doc(orderId);
      
      const firstItem = items[0] || {};
      const firstProductData = firstItem.productId ? productDataMap.get(firstItem.productId) : null;
      
      const recipientDisplayName = recipient.companyName ? `${recipient.firstName} ${recipient.lastName} (${recipient.companyName})` : `${recipient.firstName} ${recipient.lastName}`;
      const recipientCity = recipient.address?.city || '';
      const shippingMethodLabel = shippingMethod || 'Brak wpisu';

      t.set(orderRef, {
        id: orderId,
        orgId: companyId,
        source: 'manual',
        orderNumber: orderNumber,
        recipient: { ...recipient }, // spread explicitly dla anty-mutacji
        shippingMethod: shippingMethod || '',
        courierCode: courierCode || '',
        status: finalStatus,
        reservationStatus: reservationStatus,
        shipmentStatus: 'not_ready',
        notes: notes || '',
        internalNotes: '',
        createdBy: auth.uid,
        createdAt: now,
        updatedAt: now,
        itemCount: totalItemsOrdered,
        recipientDisplayName: recipientDisplayName.trim(),
        recipientCity,
        shippingMethodLabel,
        // The Preview Helpers V2
        orderHelpersVersion: 2,
        firstItemSource: 'crm_product',
        firstItemProductId: firstItem.productId || '',
        firstItemImageUrl: firstProductData?.imageThumbUrl || firstProductData?.imageMainUrl || (firstProductData?.images ? firstProductData.images[0] : '') || '',
        firstItemName: firstProductData?.name || firstItem.name || '',
        firstItemSku: firstProductData?.sku || firstItem.sku || '',
        firstItemEan: firstProductData?.ean || firstItem.ean || ''
      });

      // 3. Zapis Pozycji Zamówienia
      orderItemsToSave.forEach(i => {
        t.set(db.collection(`companies/${companyId}/orderItems`).doc(i.id), i);
      });

      // 4. Modyfikacje Stanów Magazynu
      stockMutationsToSave.forEach(m => {
        t.update(m.ref, m.payload);
      });

      // 5. Bloki Rezerwacyjne
      reservationsToSave.forEach(r => {
        t.set(r.ref, r.payload);
      });

      // 6. Raporty Ruchu
      ledgerMutationsToSave.forEach(l => {
        t.set(l.ref, l.payload);
      });

      // 7. Audyt Aktywności Zamówienia (orderActivityLogs)
      const activityRef = db.collection(`companies/${companyId}/orderActivityLogs`).doc();
      t.set(activityRef, {
        orgId: companyId,
        orderId: orderId,
        action: 'ORDER_CREATED_AND_RESERVED',
        operatorId: auth.uid,
        dataBefore: null,
        dataAfter: { orderNumber, finalStatus, reservationStatus, totalItemsOrdered, totalItemsReserved },
        timestamp: now
      });

      // 8. Oznaczenie Idempotency Key jako zużyte
      t.set(idempotencyRef, {
        orderId: orderId,
        createdAt: now
      });

    }); // KONIEC TRANSAKCJI

    console.log(`[createManualOrder] Pomyślnie wygenerowano zlecenie ${orderId}`);
    return { success: true, orderId: orderId };

  } catch (err: any) {
    if (err.message === 'DUPLICATE_ORDER') {
      console.warn(`[createManualOrder] Przechwycono próbę double-click dla requestId: ${requestId}`);
      throw new HttpsError('already-exists', 'DUPLICATE_ORDER');
    }
    
    // Przekaż HttpsError z wnętrza prosto do klienta (np. invalid-argument)
    if (err instanceof HttpsError) {
       throw err;
    }
    
    console.error('[createManualOrder] ERROR:', err);
    throw new HttpsError('internal', `Nie udało się utworzyć zamówienia: ${err.message}`);
  }
});
