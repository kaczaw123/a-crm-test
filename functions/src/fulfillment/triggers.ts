import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { calculateCutOffDeadline, determinePriority } from './sla';
import { suggestCarton, STANDARD_CARTONS, DimensionProduct } from './cartonization';

const db = admin.firestore();

// Trigger wrzucający zamówienie do fulfillmentQueue jeśli spełnione są warunki (np. status 'ready_for_shipping')
export const onOrderFulfillmentSync = onDocumentWritten('companies/{companyId}/orders/{orderId}', async (event) => {
  const companyId = event.params.companyId;
  const orderId = event.params.orderId;

  if (!event.data) return; // doc deleted

  const newValue = event.data.after.data();
  const oldValue = event.data.before?.data();

  // Sprawdzamy czy zmiana statusu na ready_for_shipping (lub czy nowo utworzony jako gotowy)
  const isNowReady = newValue?.status === 'ready_for_shipping';
  const wasReady = oldValue?.status === 'ready_for_shipping';

  if (!isNowReady && wasReady) {
    // Jeżeli zamówienie zostało anulowane lub wycofane z ready_for_shipping, usuwamy z kolejki (jeśli nie jest obrabiane)
    const taskRef = db.doc(`companies/${companyId}/fulfillmentQueue/${orderId}`);
    const taskDoc = await taskRef.get();
    
    if (taskDoc.exists) {
      const taskStatus = taskDoc.data()?.status;
      // usuwamy jeśli jeszcze z tym nic nie zrobiono (lub po prostu anulujemy)
      if (taskStatus === 'awaiting' || taskStatus === 'routing') {
        await taskRef.delete();
      }
    }
    return;
  }

  if (isNowReady && !wasReady) {
    // 1. Opcja A: Pobierz subkolekcje orderItems
    const orderItemsSnap = await db.collection(`companies/${companyId}/orderItems`).where('orderId', '==', orderId).get();
    
    // 2. Pobierz dodatkowe detale przedmiotu (zdjęcia, lokalizacje) i przygotuj wymiary
    const taskItems = [];
    const productsToPack: DimensionProduct[] = [];
    
    for (const itemDoc of orderItemsSnap.docs) {
      const itemData = itemDoc.data();
      let imageUrl = itemData.imageUrl || null;
      let location = null;
      
      if (itemData.productId) {
        // Zawsze pobieramy produkt, aby mieć pewność co do jego wymiarów logistycznych
        const productDoc = await db.doc(`companies/${companyId}/products/${itemData.productId}`).get();
        const pData = productDoc.data();
        
        if (productDoc.exists && pData) {
           imageUrl = imageUrl || pData.imageUrl || null;
           // Załadowanie fizycznych wymiarów do ewaluatora kartonu
           productsToPack.push({
               id: pData.sku || pData.id,
               length: pData.logistics?.length || 0,
               width: pData.logistics?.width || 0,
               height: pData.logistics?.height || 0,
               weightKg: pData.logistics?.weight || 0,
               quantity: itemData.qtyReserved || itemData.qtyOrdered || 1
           });
        }
        
        // Pobierz lokalizacje z inwentory (najprostszy fallback)
        const stockQuery = await db.collection(`companies/${companyId}/inventoryStock`)
          .where('productId', '==', itemData.productId)
          .limit(1).get();
        if (!stockQuery.empty) {
           location = stockQuery.docs[0].data().warehouseLocationId || null;
           // Konwersja location ID na location Name poprawi zadowolenie frontu
           if (location) {
              const locDoc = await db.doc(`companies/${companyId}/locations/${location}`).get();
              if (locDoc.exists) {
                 location = locDoc.data()?.name || location;
              }
           }
        }
      }
      
      taskItems.push({
        productId: itemData.productId || itemDoc.id,
        productName: itemData.name || 'Brak nazwy',
        ean: itemData.ean || '',
        sku: itemData.sku || '',
        imageUrl,
        location,
        quantity: itemData.qtyReserved || itemData.qtyOrdered || 1,
        scannedQuantity: 0
      });
    }

    // Wylicz i wybierz odpowiedni Box ze zdefiniowanych opcji
    const suggestedBox = productsToPack.length > 0 
          ? suggestCarton(productsToPack) 
          : STANDARD_CARTONS[3]; // Fallback do foliopaka
          
    // Pobierz nazwę firmy by wyświetlała się w UI 3PL
    const companyDoc = await db.doc(`companies/${companyId}`).get();
    const companyName = companyDoc.exists ? (companyDoc.data()?.name || 'Nieznana firma') : 'Nieznana firma';

    // Dodaj zamówienie do kolejki Fulfillment
    const taskRef = db.doc(`companies/${companyId}/fulfillmentQueue/${orderId}`);
    // Wyciągnij metodę dostawy jeśli jest (np. z obiektu shippingDetails)
    const shippingMethod = newValue?.shipping?.method || '';
    const cutOffDeadlineMs = calculateCutOffDeadline(shippingMethod);
    const calculatedPriority = determinePriority(cutOffDeadlineMs);

    const payload = {
      id: orderId,
      companyId: companyId,
      orderId: orderId,
      referenceNumber: newValue?.orderNumber || orderId,
      customerName: newValue?.recipient?.firstName ? `${newValue.recipient.firstName} ${newValue.recipient.lastName}` : (newValue?.buyer?.login || 'Brak danych'),
      customerCity: newValue?.recipient?.address?.city || '',
      trackingNumber: newValue?.trackingNumber || '', 
      carrier: newValue?.courierCode || shippingMethod || 'Kurier',
      status: 'awaiting',
      priority: calculatedPriority,
      cutOffDeadline: cutOffDeadlineMs,
      items: taskItems,
      suggestedBox: suggestedBox,
      companyName: companyName,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await taskRef.set(payload, { merge: true });
  } else if (isNowReady && wasReady) {
    // Aktualizacja istniejącego zadania (np. dodanie etykiety DHL wygenerowanej po czasie)
    const newTracking = newValue?.trackingNumber || '';
    const oldTracking = oldValue?.trackingNumber || '';
    const newCarrier = newValue?.courierCode || newValue?.shipping?.method || 'Kurier';
    const oldCarrier = oldValue?.courierCode || oldValue?.shipping?.method || 'Kurier';

    if (newTracking !== oldTracking || newCarrier !== oldCarrier) {
       const taskRef = db.doc(`companies/${companyId}/fulfillmentQueue/${orderId}`);
       await taskRef.set({
           trackingNumber: newTracking,
           carrier: newCarrier,
           updatedAt: admin.firestore.FieldValue.serverTimestamp()
       }, { merge: true });
    }
  }
});
