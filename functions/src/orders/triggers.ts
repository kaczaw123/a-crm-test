import { onDocumentWritten, onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { internalAllocateReservations } from './actions';

const db = admin.firestore();

export const autoReserveStockOnOrderCreate = onDocumentCreated('companies/{companyId}/orders/{orderId}', async (event) => {
  const data = event.data?.data();
  if (!data) return;

  // Rezerwujemy tylko nowe lub przetwarzane zamówienia
  if (data.status !== 'new' && data.status !== 'processing') return;
  // Pomijamy jeśli już ma rezerwację
  if (data.hasReservation || data.reservationStatus === 'full' || data.reservationStatus === 'partial') return;

  const companyId = event.params.companyId;
  const orderId = event.params.orderId;

  try {
    // Opóźnienie 2 sekundy aby Firestore zdążył zbudować indeksy dla orderItems wstawionych w tym samym batchu
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Ponieważ importy korzystają z batch.commit(), orderItems są już w bazie danych (ale indeksy mogły potrzebować chwili)
    const res = await internalAllocateReservations(companyId, orderId, 'SYSTEM_AUTO_RESERVE');
    console.log(`Auto reserve order ${orderId} result: ${res.newStatus}`);
  } catch (err: any) {
    console.log(`Auto reserve order ${orderId} skipped/failed: ${err.message}`);
    const actRef = db.collection(`companies/${companyId}/orderActivityLogs`).doc();
    await actRef.set({
        orderId, orgId: companyId,
        userId: 'system',
        userName: 'Automatyzacja',
        action: 'ALLOCATION_FAILED',
        details: `Próba automatycznej rezerwacji anulowana: ${err.message}`,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  }
});

export const onOrderItemMappingComplete = onDocumentWritten('companies/{companyId}/orderItems/{itemId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();

  // Zignoruj usunięcia
  if (!after) return; 

  // Reaguj tylko na pozycje zmapowane
  if (after.mappingStatus !== 'mapped') return;

  // Odpalaj tylko przy przejściu na zmapowane lub utworzeniu od razu zmapowanego
  if (before && before.mappingStatus === 'mapped') return;

  const companyId = event.params.companyId;
  const orderId = after.orderId;

  if (!orderId) return;

  const orderRef = db.collection(`companies/${companyId}/orders`).doc(orderId);
  const orderDoc = await orderRef.get();
  
  if (!orderDoc.exists) return;
  const oData = orderDoc.data();
  if (oData?.status !== 'new' && oData?.status !== 'processing') return;

  try {
    // Opóźnienie 2 sekundy aby Firestore zdążył zbudować indeksy (zwłaszcza przy masowym mapowaniu/imporcie)
    await new Promise(resolve => setTimeout(resolve, 2000));
    const res = await internalAllocateReservations(companyId, orderId, 'SYSTEM_AUTO_RESERVE');
    console.log(`Auto reserve order ${orderId} (triggered by mapping) result: ${res.newStatus}`);
  } catch (err: any) {
    console.log(`Auto reserve order ${orderId} (triggered by mapping) skipped/failed: ${err.message}`);
  }
});
