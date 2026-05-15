import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions, db } from '../../../firebase/config';
import { doc, getDoc, collection, query, where, getDocs, orderBy, documentId } from 'firebase/firestore';
import { useAuth } from '../../../auth/useAuth';
import type { Order } from '../../../data/orders';
import { Loader2, ArrowLeft, Package, Trash2, CheckCircle2, Truck, Save, RefreshCcw, Calendar, CreditCard, AlertTriangle, AlertCircle, Copy, Edit2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { OrderShipmentPanel } from '../../../components/orders/OrderShipmentPanel';
import { ManualMappingModal } from '../../../components/orders/ManualMappingModal';
import { safeFormatDate } from '../../../utils/dateHelpers';
import { formatDateTime, formatDate as secureFormatDate } from '../../../utils/dateUtils';
const getPaymentMethodName = (type?: string, provider?: string): string => {
  const typeMap: Record<string, string> = {
    'CASH_ON_DELIVERY': 'Płatność przy odbiorze',
    'ONLINE': 'Płatność online',
    'SPLIT_PAYMENT': 'Płatność ratalna',
    'EXTENDED_TERM': 'Płatność odroczona',
  };
  const providerMap: Record<string, string> = {
    'PAYU': 'PayU',
    'P24': 'Przelewy24',
    'AF': 'Allegro Finance',
    'WALLET': 'Allegro Pay',
  };
  const tStr = type || '';
  const pStr = provider || '';
  const typeName = typeMap[tStr] || tStr;
  const providerName = providerMap[pStr] || pStr;
  
  if (typeName && providerName) {
    return `${typeName} (${providerName})`;
  }
  return typeName || providerName || '-';
};

export default function OrderDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { t, i18n } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const [data, setData] = useState<{
    order: Order | null;
    items: any[];
    activityLogs: any[];
    inventoryMovements: any[];
    stockReservations: any[];
    shipments: any[];
  }>({
    order: null, items: [], activityLogs: [], inventoryMovements: [], stockReservations: [], shipments: []
  });

  const [editMode, setEditMode] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [editRecipient, setEditRecipient] = useState<any>(null);
  const [mappingModalItem, setMappingModalItem] = useState<any>(null);
  
  const [labelUrl, setLabelUrl] = useState<string | null>(null);

  useEffect(() => {
    if ((data.order as any)?.labelStoragePath) {
      import('firebase/storage').then(({ getDownloadURL, ref }) => {
         import('../../../firebase/config').then(({ storage }) => {
            getDownloadURL(ref(storage, (data.order as any).labelStoragePath)).then(setLabelUrl).catch(() => {});
         });
      });
    }
  }, [(data.order as any)?.labelStoragePath]);

  const loadDetails = async () => {
    const currentCompanyId = (profile as any)?.activeCompanyId || (profile as any)?.companyId;
    if (!currentCompanyId || !id) return;
    setLoading(true);
    setErrorMsg('');
    try {
      // Zlecenie (Order)
      let orderDoc;
      const orderPath = `companies/${currentCompanyId}/orders/${id}`;
      try {
          console.log(`[OrderDetails] Fetching: ${orderPath}`);
          const orderRef = doc(db, 'companies', currentCompanyId, 'orders', id);
          orderDoc = await getDoc(orderRef);
          if (!orderDoc.exists()) throw new Error(t('orderDetails.errors.notFound'));
      } catch (err) {
          console.error(`Error fetching order (${orderPath}):`, err);
          throw err;
      }

      // Pozycje Zlecenia (Order Items)
      let itemsData: any[] = [];
      const itemsPath = `companies/${currentCompanyId}/orderItems`;
      try {
          console.log(`[OrderDetails] Fetching: ${itemsPath} where orderId == ${id}`);
          const itemsQuery = query(collection(db, itemsPath), where('orderId', '==', id));
          const itemsSnap = await getDocs(itemsQuery);
          itemsData = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (err) {
          console.error(`Error fetching orderItems (${itemsPath}):`, err);
          throw err;
      }

      // KOMPATYBILNOŚĆ Z ALLEGRO: dodaj items zagnieżdżone w dokumencie zamówienia
      const nestedItems = orderDoc.data()?.items || orderDoc.data()?.orderItems || [];
      if (nestedItems.length > 0) {
        itemsData = [...itemsData, ...nestedItems.map((item: any, idx: number) => ({
          id: item.allegroLineItemId || item.id || `nested-${idx}`,
          orderId: id,
          qtyOrdered: item.quantity || item.qtyOrdered || 1,
          qtyReserved: item.qtyReserved || 0,
          ...item
        }))];
      }

      // Logi (Activity Logs)
      let logsData: any[] = [];
      const logsPath = `companies/${currentCompanyId}/orderActivityLogs`;
      try {
          console.log(`[OrderDetails] Fetching: ${logsPath} where orderId == ${id}`);
          const logsQuery = query(collection(db, logsPath), where('orderId', '==', id), orderBy('timestamp', 'desc'));
          const logsSnap = await getDocs(logsQuery);
          logsData = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (err) {
          console.error(`[OrderDetails] Graceful fail orderActivityLogs:`, err);
      }

      // Ruchy Magazynowe (Inventory Movements)
      let movesData: any[] = [];
      const movesPath = `companies/${currentCompanyId}/inventoryMovements`;
      try {
          console.log(`[OrderDetails] Fetching: ${movesPath} where referenceId == ${id}`);
          const movesQuery = query(collection(db, movesPath), where('referenceId', '==', id), where('referenceType', '==', 'order'), orderBy('createdAt', 'desc'));
          const movesSnap = await getDocs(movesQuery);
          movesData = movesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (err) {
          console.error(`[OrderDetails] Graceful fail inventoryMovements:`, err);
      }

      // Rezerwacje (Stock Reservations)
      let resData: any[] = [];
      const resPath = `companies/${currentCompanyId}/stockReservations`;
      try {
          console.log(`[OrderDetails] Fetching: ${resPath} where orderId == ${id}`);
          const resQuery = query(collection(db, resPath), where('orderId', '==', id));
          const resSnap = await getDocs(resQuery);
          resData = resSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (err) {
          console.error(`[OrderDetails] Graceful fail stockReservations:`, err);
      }

      // Etykiety Kurierskie (Shipments)
      let shipData: any[] = [];
      const shipPath = `companies/${currentCompanyId}/shipments`;
      try {
          console.log(`[OrderDetails] Fetching: ${shipPath} where orderId == ${id}`);
          const shipQuery = query(collection(db, shipPath), where('orderId', '==', id));
          const shipSnap = await getDocs(shipQuery);
          shipData = shipSnap.docs.map(d => ({ id: d.id, ...d.data() }));

          let oData = orderDoc.data() || {};
          let importedTracking = oData.trackingNumber || oData.shipping?.trackingNumber;
          if (importedTracking && !shipData.some(s => s.trackingNumber === importedTracking)) {
              shipData.push({
                 id: 'imported_tracking',
                 createdAt: oData.createdAt || new Date(),
                 trackingNumber: importedTracking,
                 status: 'CREATED',
                 carrier: oData.source === 'google_sheets' ? 'DHL_DE' : 'EXTERNAL'
              });
          }

          shipData.sort((a, b) => {
             const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
             const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
             return tB - tA;
          });
      } catch (err) {
          console.error(`[OrderDetails] Graceful fail shipments:`, err);
      }

      // Fetch CRM Products for mapped items
      const mappedProductIds = itemsData
          .filter((i: any) => i.mappingStatus === 'mapped' && i.productId)
          .map((i: any) => i.productId);
      
      const uniqueMappedProductIds = [...new Set(mappedProductIds)];
      const productsMap = new Map<string, any>();
      const productsPath = `companies/${currentCompanyId}/products`;
      
      if (uniqueMappedProductIds.length > 0) {
          try {
              console.log(`[OrderDetails] Fetching CRM Products on: ${productsPath} for ${uniqueMappedProductIds.length} IDs`);
              const chunks = [];
              for (let i = 0; i < uniqueMappedProductIds.length; i += 30) {
                  chunks.push(uniqueMappedProductIds.slice(i, i + 30));
              }
              
              for (const chunk of chunks) {
                  console.log('Fetching products with IDs:', chunk);
                  console.log('CompanyId:', currentCompanyId);
                  console.log('Path:', productsPath);
                  
                  const pQuery = query(collection(db, productsPath), where(documentId(), 'in', chunk));
                  const pSnap = await getDocs(pQuery);
                  pSnap.forEach(d => {
                      productsMap.set(d.id, d.data());
                  });
              }
          } catch(err) {
              console.error(`[OrderDetails] Graceful fail fetching CRM products (${productsPath}):`, err);
          }
      }

      const enrichedItems = itemsData.map((item: any) => {
          if (item.mappingStatus === 'mapped' && item.productId && productsMap.has(item.productId)) {
              return { ...item, crmProductSnapshot: productsMap.get(item.productId) };
          }
          return item;
      });

      setData({
         order: { id: orderDoc.id, ...orderDoc.data() } as Order,
         items: enrichedItems,
         activityLogs: logsData,
         inventoryMovements: movesData,
         stockReservations: resData,
         shipments: shipData
      });
      setEditNotes(orderDoc.data()?.notes || '');
      setEditRecipient(orderDoc.data()?.recipient || null);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || t('orderDetails.errors.notFound'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetails();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(profile as any)?.activeCompanyId, (profile as any)?.companyId, id]);

  const handleAction = async (actionFnName: string, successMsgKey: string) => {
     if (!window.confirm(t('orderDetails.alerts.confirmAction', 'Czy na pewno chcesz wykonać tę akcję?'))) return;
     
     const currentCompanyId = (profile as any)?.activeCompanyId || (profile as any)?.companyId;
     
     setActionLoading(actionFnName);
     setErrorMsg('');
     try {
       const fn = httpsCallable(functions, actionFnName);
       await fn({ companyId: currentCompanyId, orderId: id });
       await loadDetails();
       alert(t(successMsgKey));
     } catch(err: any) {
       setErrorMsg(err.message || t('orderDetails.errors.operationError'));
     } finally {
       setActionLoading(null);
     }
  };

  const handleSaveEdits = async () => {
     const currentCompanyId = (profile as any)?.activeCompanyId || (profile as any)?.companyId;
     
     setActionLoading('updateOrderBeforeShipment');
     setErrorMsg('');
     try {
       const fn = httpsCallable(functions, 'updateOrderBeforeShipment');
       await fn({ 
           companyId: currentCompanyId, 
           orderId: id,
           recipient: editRecipient,
           notes: editNotes
       });
       setEditMode(false);
       await loadDetails();
     } catch(err: any) {
       setErrorMsg(err.message || t('orderDetails.errors.operationError'));
     } finally {
       setActionLoading(null);
     }
  };

  if (loading) {
     return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>;
  }

  const o = data.order;
  if (!o) return <div className="p-6 text-red-600">{t('orderDetails.errors.notFound')}</div>;

  const isEditable = o.status !== 'shipped' && o.status !== 'cancelled';
  const mappedItemsCount = data.items.filter(i => i.mappingStatus === 'mapped').length;
  const mappingPercentage = data.items.length > 0 ? Math.round((mappedItemsCount / data.items.length) * 100) : 0;
  const isFulfillmentReady = mappingPercentage === 100 && o.status === 'ready_for_shipping';

  console.log('NEW BUTTONS LOADED - order data:', {
     orderId: o.id,
     status: o.status,
     reservationStatus: o.reservationStatus,
     hasReservation: o.hasReservation,
     mappedItemsCount,
     inFulfillment: o.inFulfillment,
     hasLabel: o.hasLabel,
     trackingNumber: o.trackingNumber,
     shippingTracking: (o as any).shipping?.trackingNumber
  });
  
  // FALLBACKS DLA WSTECZNEJ KOMPATYBILNOŚCI
  const isReserved = o.hasReservation === true || o.reservationStatus === 'full' || o.reservationStatus === 'partial';
  const isInFulfillment = o.inFulfillment === true || o.fulfillmentStatus === 'awaiting' || o.fulfillmentStatus === 'packing';
  const hasCourierLabel = o.hasLabel === true || !!o.trackingNumber || !!(o as any).shipping?.trackingNumber;

  return (
    <div className="flex flex-col gap-6 pb-12">
        
        {/* Header Options */}
        <div className="flex items-center justify-between">
           <button onClick={() => navigate('/app/orders')} className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
              <ArrowLeft className="h-4 w-4 mr-1" /> {t('orderDetails.backToOrders')}
           </button>
           <div className="flex items-center gap-2">
              <button onClick={() => loadDetails()} className="p-2 text-gray-500 hover:text-gray-900 bg-white rounded-lg shadow-sm border border-gray-200">
                 <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
           </div>
        </div>

        {errorMsg && (
          <div className="rounded-lg bg-red-50 p-4 border border-red-200">
            <h3 className="text-sm font-medium text-red-800">{t('orderDetails.errors.operationError')}</h3>
            <div className="mt-2 text-sm text-red-700">{errorMsg}</div>
          </div>
        )}

        {/* Global Toolbar */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col md:flex-row md:items-start justify-between gap-6">
           <div className="space-y-3 flex-1">
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-3">
                 <span className="material-symbols-outlined text-gray-400">receipt_long</span>
                 {o.orderNumber || o.id.substring(0,8)}
              </h1>
              
              <div className="flex flex-wrap items-center gap-2 mt-1">
                 {/* Source & External IDs */}
                 <span className="inline-flex items-center rounded-md bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 tracking-wider ring-1 ring-inset ring-blue-600/20 uppercase">
                    {t('orderDetails.source')}: {o.source}
                 </span>
                 {o.externalOrderId && (
                   <span className="inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-[11px] font-mono font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">
                      {t('orderDetails.ext')}: {o.externalOrderId}
                   </span>
                 )}
                 {o.integrationId && (
                   <span className="inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-[11px] font-mono font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">
                      {t('orderDetails.int')}: {o.integrationId.substring(0, 8)}...
                   </span>
                 )}
                 
                 {/* Status pill */}
                 {o.status === 'new' && <span className="inline-flex items-center rounded-md bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-700 ml-2 border border-blue-200 uppercase tracking-wide">{t('orderDetails.status.new')}</span>}
                 {o.status === 'processing' && <span className="inline-flex items-center rounded-md bg-yellow-100 px-2.5 py-1 text-xs font-bold text-yellow-800 ml-2 border border-yellow-200 uppercase tracking-wide">{t('orderDetails.status.processing')}</span>}
                 {o.status === 'in_fulfillment' && <span className="inline-flex items-center rounded-md bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-800 ml-2 border border-orange-200 uppercase tracking-wide">{t('orderDetails.status.in_fulfillment')}</span>}
                 {o.status === 'label_created' && <span className="inline-flex items-center rounded-md bg-yellow-100 px-2.5 py-1 text-xs font-bold text-yellow-800 ml-2 border border-yellow-200 uppercase tracking-wide">{t('orderDetails.status.label_created', 'GOTOWE DO WYSYŁKI')}</span>}
                 {o.status === 'awaiting_stock' && <span className="inline-flex items-center rounded-md bg-red-100 px-2.5 py-1 text-xs font-bold text-red-700 ml-2 border border-red-200 uppercase tracking-wide">{t('orderDetails.status.awaiting_stock')}</span>}
                 {o.status === 'ready_for_shipping' && <span className="inline-flex items-center rounded-md bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800 ml-2 border border-emerald-200 uppercase tracking-wide">{t('orderDetails.status.ready_for_shipping')}</span>}
                 {o.status === 'shipped' && <span className="inline-flex items-center rounded-md bg-green-100 px-2.5 py-1 text-xs font-bold text-green-800 ml-2 border border-green-200 uppercase tracking-wide">✅ WYSŁANE</span>}
                 {o.status === 'cancelled' && <span className="inline-flex items-center rounded-md bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 ml-2 border border-red-200 uppercase tracking-wide line-through">{t('orderDetails.status.cancelled')}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-4 mt-4 text-sm text-gray-600 font-medium pt-2">
                 <div className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-gray-400"/> {formatDateTime(o.createdAt, i18n.language)}</div>
                 <div className="flex items-center gap-1.5"><Truck className="w-4 h-4 text-gray-400"/> {o.shippingMethod} {o.delivery?.cost !== undefined ? `- ${o.delivery.cost.toFixed(2)} ${o.delivery.currency || 'PLN'}` : ''} {o.delivery?.smart && <span className="inline-flex items-center px-2 py-0.5 ml-1 rounded text-[10px] font-bold bg-green-100 text-green-700 uppercase tracking-widest">{t('orders.smart', 'SMART')}</span>}</div>
                 <div className="flex items-center gap-1.5"><CreditCard className="w-4 h-4 text-gray-400"/> {o.paymentMethod || o.payment?.type || t('orderDetails.paymentUnknown')}</div>
                 {o.source === 'ALLEGRO' && o.orderedAt && (
                    <div className="flex items-center gap-1.5 border-l border-gray-200 pl-4 text-gray-400">
                       Zakup: {formatDateTime(o.orderedAt, i18n.language)}
                    </div>
                 )}
              </div>
           </div>

           <div className="flex flex-wrap items-center gap-2">
               {o.status !== 'cancelled' && o.status !== 'shipped' && (
                  <>
                     {!isReserved && mappedItemsCount > 0 && (
                        <button onClick={() => handleAction('addReservationManually', 'Rezerwacja dodana bezpiecznie')} disabled={!!actionLoading || isInFulfillment} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors">
                           {actionLoading === 'addReservationManually' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Package className="w-4 h-4"/>}
                           {t('orderDetails.buttons.reserve', 'Zarezerwuj stany')}
                        </button>
                     )}
                     
                     {isReserved && !isInFulfillment && (
                        <button onClick={() => handleAction('retractReservation', 'Pomyślnie cofnięto rezerwację')} disabled={!!actionLoading} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                           {actionLoading === 'retractReservation' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Package className="w-4 h-4"/>}
                           {t('orderDetails.buttons.releaseStock', 'Cofnij Rezerwację')}
                        </button>
                     )}

                     <button onClick={() => handleAction('cancelOrder', 'orderDetails.alerts.cancelled')} disabled={!!actionLoading} className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 transition-colors">
                        {actionLoading === 'cancelOrder' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Trash2 className="w-4 h-4"/>}
                        {t('orderDetails.buttons.cancelAll')}
                     </button>
                     
                     {!isInFulfillment && isReserved && hasCourierLabel && (
                        <button onClick={() => handleAction('sendToFulfillment', 'Zlecenie przekazane na magazyn (do pakowania)')} disabled={!!actionLoading} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors ml-4">
                           {actionLoading === 'sendToFulfillment' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Truck className="w-4 h-4"/>}
                           Przekaż do pakowania
                        </button>
                     )}
                     
                     {isInFulfillment && o.fulfillmentStatus === 'awaiting' && (
                        <button onClick={() => handleAction('retractFromFulfillment', 'Zamówienie cofnięte z pakowania')} disabled={!!actionLoading} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors">
                           {actionLoading === 'retractFromFulfillment' ? <Loader2 className="w-4 h-4 animate-spin"/> : <ArrowLeft className="w-4 h-4"/>}
                           Wycofaj z pakowania
                        </button>
                     )}
                  </>
               )}
            </div>
         </div>

         {/* Tracking Error (Allegro Retry) */}
         {((o as any).shipping?.trackingNumber || (o as any).trackingNumber) && (o as any).source === 'ALLEGRO' && !(o as any).shipping?.trackingSentToAllegro && (
           <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
             <div>
               <p className="text-sm font-semibold text-yellow-800 flex items-center gap-1.5 border-b border-yellow-100 pb-1 mb-2">
                 <AlertCircle className="w-4 h-4" /> 
                 {t('orders.tracking.notSentToAllegro', 'Tracking nie został wysłany do Allegro')}
               </p>
               {(o as any).shipping?.trackingError && (
                 <span className="block text-xs font-mono text-yellow-700 bg-yellow-100/50 p-2 rounded">Błąd: {(o as any).shipping.trackingError}</span>
               )}
               <p className="text-xs text-yellow-700 mt-2">
                 Tracking znajduje się w systemie, ale nie został prawidłowo wysłany do platformy Allegro (np. z powodu odrzucenia przez API).
               </p>
             </div>
             <button
               onClick={async () => {
                 try {
                   setActionLoading('retryAllegroTracking');
                   const fn = httpsCallable(functions, "retryAllegroTracking");
                   await fn({
                     companyId: (profile as any)?.activeCompanyId || (profile as any)?.companyId,
                     orderId: o.id,
                   });
                   alert(t('orders.tracking.retrySuccess', 'Tracking wysłany pomyślnie do Allegro!'));
                 } catch (error: any) {
                   console.error(error);
                   alert(t('orders.tracking.retryFailed', 'Nie udało się ponowić wysyłki') + ': ' + error.message);
                 } finally {
                   setActionLoading(null);
                   loadDetails();
                 }
               }}
               disabled={actionLoading === 'retryAllegroTracking'}
               className="shrink-0 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm transition-colors disabled:opacity-50"
             >
               {actionLoading === 'retryAllegroTracking' ? <Loader2 className="w-4 h-4 animate-spin"/> : <RefreshCcw className="w-4 h-4"/>}
               {t('orders.tracking.retry', 'Ponów wysyłkę')}
             </button>
           </div>
         )}
         {((o as any).shipping?.trackingNumber || (o as any).trackingNumber) && (o as any).source === 'ALLEGRO' && (o as any).shipping?.trackingSentToAllegro && (
           <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3 mb-4 shadow-sm relative overflow-hidden">
             <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
             <div className="bg-white p-1.5 rounded-md shadow-sm border border-emerald-100"><CheckCircle2 className="w-5 h-5 text-emerald-600"/></div>
             <p className="text-sm font-semibold text-emerald-800">
               {t('orders.tracking.sentToAllegro', 'Tracking wysłany do Allegro')} 
               <span className="font-mono ml-2 text-emerald-700 bg-emerald-100/50 px-2 py-0.5 rounded border border-emerald-100 text-xs">TRK: {((o as any).shipping?.trackingNumber || (o as any).trackingNumber)}</span>
             </p>
           </div>
         )}

         {/* Sekcja Logistyczna */}
         <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
               <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${isFulfillmentReady ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'}`}>
                  {isFulfillmentReady ? <CheckCircle2 className="w-6 h-6"/> : <Package className="w-6 h-6"/>}
               </div>
               <div>
                  <div className="text-sm font-bold text-gray-900">{t('orderDetails.inventoryStatus')}</div>
                  <div className="text-[13px] text-gray-500 mt-0.5">
                     {t('orderDetails.mapped')}: <span className="font-semibold text-gray-700">{mappingPercentage}%</span> | {t('orderDetails.shipping')}: <span className="uppercase font-semibold text-gray-700 tracking-wider text-[11px]">{o.shipmentStatus}</span> | {t('orderDetails.reservation')}: <span className="uppercase font-semibold text-gray-700 tracking-wider text-[11px]">{o.reservationStatus}</span>
                  </div>
               </div>
            </div>
            <div className="text-left md:text-right border-t md:border-t-0 border-gray-100 pt-4 md:pt-0">
               <div className="text-sm font-bold text-gray-900">{t('orderDetails.fulfillmentReadiness')}</div>
               <div className="text-xs font-medium mt-1">
                  {isFulfillmentReady ? <span className="text-emerald-600 font-bold uppercase tracking-wider">{t('orderDetails.readyToPack')}</span> : <span className="text-gray-500 uppercase tracking-wider">{t('orderDetails.waitingForConditions')}</span>}
               </div>
            </div>
         </section>

              {/* Towary Allegro / BaseLinker View */}
              {o.source === 'ALLEGRO' && o.items && (
              <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                 <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                    <h3 className="font-semibold text-gray-900">{t('orderDetails.orderItems')} ({o.items.length})</h3>
                 </div>
                 <div className="overflow-x-auto p-0">
                    <table className="min-w-full divide-y divide-gray-200">
                       <thead className="bg-gray-50">
                          <tr>
                              <th className="px-6 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('orderDetails.table.productAndSku')}</th>
                              <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">Waga stat.</th>
                              <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">VAT</th>
                              <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cena brutto</th>
                              <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">Ilość</th>
                              <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">Suma</th>
                          </tr>
                       </thead>
                       <tbody className="bg-white divide-y divide-gray-200">
                          {o.items.map((item, index) => {
                             return (
                             <tr key={item.id || index} className="hover:bg-gray-50 border-b border-gray-100">
                                 <td className="px-6 py-4 max-w-xs">
                                    <div className="flex items-start gap-3">
                                       <div className="w-10 h-10 rounded-md border border-gray-200 bg-white flex items-center justify-center shrink-0 text-gray-400 overflow-hidden">
                                          {item.imageUrl ? <img src={item.imageUrl} alt={item.sku} className="w-full h-full object-contain"/> : <span className="material-symbols-outlined text-[20px]">package_2</span>}
                                       </div>
                                       <div className="min-w-0 flex-1 overflow-hidden">
                                          <div className="font-bold text-gray-900 text-[13px] mb-0.5 truncate">{item.sku} {item.ean ? `| ${item.ean}` : ''}</div>
                                          <div className="text-[12px] text-gray-500 truncate">{item.name}</div>
                                          {item.allegroOfferId && <div className="text-[10px] text-gray-400 font-mono mt-0.5">Offer ID: {item.allegroOfferId}</div>}
                                       </div>
                                    </div>
                                 </td>
                                 <td className="px-4 py-4 whitespace-nowrap text-center text-[13px] text-gray-500">{item.weight || 0} kg</td>
                                 <td className="px-4 py-4 whitespace-nowrap text-center text-[13px] text-gray-500">{item.vat || 23}%</td>
                                 <td className="px-4 py-4 whitespace-nowrap text-center text-[13px] text-gray-900 font-bold">{item.price} {item.currency || o.currency || 'PLN'}</td>
                                 <td className="px-4 py-4 whitespace-nowrap text-center text-[14px] font-bold text-blue-600">{item.quantity}</td>
                                 <td className="px-4 py-4 whitespace-nowrap text-center text-[13px] text-gray-900 font-bold">{(item.price || 0) * (item.quantity || 1)} {item.currency || o.currency || 'PLN'}</td>
                             </tr>
                             );
                          })}
                       </tbody>
                    </table>
                 </div>
              </section>
              )}

              {/* Towary CRM (tylko z Inventory) */}
              {o.source !== 'ALLEGRO' && (
              <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                 <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
                    <h3 className="font-semibold text-gray-900">{t('orderDetails.orderItems')} ({data.items.length})</h3>
                 </div>
                 <div className="overflow-x-auto p-0">
                    <table className="min-w-full divide-y divide-gray-200">
                       <thead className="bg-gray-50">
                          <tr>
                              <th className="px-6 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('orderDetails.table.productAndSku')}</th>
                              <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('orderDetails.table.mapping')}</th>
                              <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('orderDetails.table.qtyOrdered')}</th>
                              <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('orderDetails.table.qtyReserved')}</th>
                          </tr>
                       </thead>
                       <tbody className="bg-white divide-y divide-gray-200">
                          {data.items.map((item, index) => {
                             const snap = item.crmProductSnapshot;
                             const imgUrl = snap ? (snap.imageThumbUrl || snap.imageMainUrl || (snap.images && snap.images[0])) : null;
                             
                             const sourceName = snap?.name || item.name || t('orderDetails.unknownProduct');
                             const sourceSku = snap?.sku || item.sku || t('orderDetails.noSku');
                             const sourceEan = snap?.ean || item.ean || '';
                             
                             const crmName = snap ? snap.name : '';
                             const nameDiffers = snap && crmName && item.name && crmName !== item.name;

                             return (
                             <tr key={item.id || index} className="hover:bg-gray-50 border-b border-gray-100">
                                 <td className="px-6 py-4 max-w-xs">
                                    <div className="flex items-start gap-3">
                                       <div className="w-10 h-10 rounded-md border border-gray-200 bg-white flex items-center justify-center shrink-0 text-gray-400 overflow-hidden">
                                          {imgUrl ? <img src={imgUrl} alt={item.sku} className="w-full h-full object-cover"/> : <span className="material-symbols-outlined text-[20px]">package_2</span>}
                                       </div>
                                       <div className="min-w-0 flex-1 overflow-hidden">
                                          <div className="font-bold text-gray-900 text-[13px] mb-0.5 truncate">{sourceSku} {sourceEan ? `| ${sourceEan}` : ''}</div>
                                          {nameDiffers ? (
                                             <div className="flex flex-col gap-0.5 pr-4">
                                               <div className="text-[12px] font-medium text-emerald-700 truncate" title={`${t('orderDetails.crmProduct')}: ${crmName}`}>CRM: {crmName}</div>
                                               <div className="text-[11px] text-gray-400 truncate line-through" title={`${t('orderDetails.apiOriginal')}: ${item.name}`}>API: {item.name}</div>
                                             </div>
                                          ) : (
                                             <div className="text-[12px] text-gray-500 truncate pr-4" title={sourceName}>{sourceName}</div>
                                          )}
                                       </div>
                                    </div>
                                 </td>
                                 <td className="px-4 py-4 whitespace-nowrap text-center">
                                    {item.mappingStatus === 'mapped' ? (
                                       <div className="flex flex-col items-center">
                                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 uppercase tracking-wider">
                                             <span className="material-symbols-outlined text-[12px]">check_circle</span> {t('orderDetails.table.mapped')}
                                          </span>
                                          {item.productId && <span className="text-[10px] font-mono text-gray-400 mt-1 select-all" title={item.productId}>{item.productId}</span>}
                                       </div>
                                    ) : (
                                       <div className="flex flex-col items-center gap-1">
                                         <span className="inline-flex items-center text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-100 uppercase tracking-wider">
                                           {t('orderDetails.table.unmapped')}
                                         </span>
                                         <button
                                           onClick={() => setMappingModalItem(item)}
                                           className="text-[10px] font-bold text-blue-600 hover:text-blue-800 underline"
                                         >
                                           {t('orders.manualMapping.cta', 'Mapuj ręcznie')}
                                         </button>
                                       </div>
                                    )}
                                 </td>
                                 <td className="px-4 py-4 whitespace-nowrap text-center text-[14px] font-bold text-gray-900">{item.qtyOrdered}</td>
                                 <td className="px-4 py-4 whitespace-nowrap text-center">
                                    <div className="flex flex-col items-center">
                                       <span className={`text-[14px] font-bold ${item.qtyReserved === item.qtyOrdered ? 'text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md' : (item.qtyReserved > 0 ? 'text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md' : 'text-gray-400')}`}>
                                          {item.qtyReserved || 0} / {item.qtyOrdered}
                                       </span>
                                       {item.qtyReserved === item.qtyOrdered ? (
                                          <span className="text-[10px] text-emerald-600 mt-1 uppercase font-bold tracking-wider">{t('orderDetails.table.full')}</span>
                                       ) : item.qtyReserved > 0 ? (
                                          <span className="text-[10px] text-amber-600 mt-1 uppercase font-bold tracking-wider">{t('orderDetails.table.partial')}</span>
                                       ) : (
                                          <span className="text-[10px] text-gray-400 mt-1 uppercase font-bold tracking-wider">{t('orderDetails.table.none')}</span>
                                       )}
                                       {(item.qtyReserved || 0) < item.qtyOrdered && item.mappingStatus === 'mapped' && o.status !== 'shipped' && o.status !== 'cancelled' && !isInFulfillment && (
                                          <button
                                             onClick={() => handleAction('addReservationManually', 'Próba rezerwacji zakończona')}
                                             disabled={!!actionLoading}
                                             className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-1 rounded border border-blue-100 transition-colors disabled:opacity-50"
                                          >
                                             <RefreshCcw className={`w-3 h-3 ${actionLoading === 'addReservationManually' ? 'animate-spin' : ''}`} />
                                             {t('orderDetails.buttons.reserve', 'Zarezerwuj')}
                                          </button>
                                       )}
                                    </div>
                                 </td>
                             </tr>
                             );
                          })}
                       </tbody>
                     </table>
                 </div>
              </section>
              )}

              {/* Wygenerowane Etykiety (Shipments) */}
              {data.shipments && data.shipments.length > 0 && (
              <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                 <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                    <h3 className="font-semibold text-gray-900">{t('orderDetails.shipments', 'Przesyłki Kurierskie')} ({data.shipments.length})</h3>
                 </div>
                 <div className="overflow-x-auto p-0">
                    <table className="min-w-full divide-y divide-gray-200">
                       <thead className="bg-gray-50">
                          <tr>
                              <th className="px-6 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('orderDetails.table.date', 'Data')}</th>
                              <th className="px-4 py-3 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('orderDetails.table.tracking', 'Numer Nadania')}</th>
                              <th className="px-4 py-3 text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('orderDetails.table.status', 'Status')}</th>
                              <th className="px-6 py-3 text-right text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('orderDetails.table.actions', 'Akcje')}</th>
                          </tr>
                       </thead>
                       <tbody className="bg-white divide-y divide-gray-200">
                          {data.shipments.map((s, index) => {
                             return (
                             <tr key={s.id || index} className="hover:bg-gray-50 border-b border-gray-100">
                                 <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-[13px] font-bold text-gray-900">{s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString('pl-PL') : ''}</div>
                                    <div className="text-[11px] text-gray-500">{s.createdAt?.toDate ? s.createdAt.toDate().toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit'}) : ''}</div>
                                 </td>
                                 <td className="px-4 py-4 whitespace-nowrap">
                                    {s.trackingNumber ? (
                                       <a href={s.carrier?.toLowerCase() === 'gls_de' ? `https://gls-group.eu/track/${s.trackingNumber}` : `https://www.dhl.de/en/privatkunden/pakete-empfangen/verfolgen.html?piececode=${s.trackingNumber}`} target="_blank" rel="noreferrer" className="text-[13px] font-mono font-bold text-[#b10024] hover:underline">
                                          {s.trackingNumber}
                                       </a>
                                    ) : <span className="text-xs text-gray-400">Brak</span>}
                                    {s.carrier && <span className="text-[9px] bg-gray-100 text-gray-500 px-1 py-0.5 rounded ml-2 uppercase font-bold">{s.carrier}</span>}
                                 </td>
                                 <td className="px-4 py-4 whitespace-nowrap text-center">
                                     <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${s.status === 'created' ? 'bg-blue-100 text-blue-800' : s.status === 'cancelled' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                                       {s.status || 'unknown'}
                                     </span>
                                 </td>
                                 <td className="px-6 py-4 whitespace-nowrap text-right">
                                   <div className="flex justify-end gap-2">
                                       {s.status !== 'cancelled' && (
                                         <>
                                           <button onClick={() => {
                                              if (!s.labelStoragePath) return;
                                              import('firebase/storage').then(({ ref, getDownloadURL }) => {
                                                 import('../../../firebase/config').then(({ storage }) => {
                                                    getDownloadURL(ref(storage, s.labelStoragePath)).then(url => window.open(url, '_blank')).catch(err => alert('Błąd podczas pobierania etykiety: ' + err.message));
                                                 });
                                              });
                                           }} className="p-2 text-gray-400 hover:text-[#0A3D91] hover:bg-blue-50 rounded-lg transition-colors" title="Drukuj Etykietę">
                                              <span className="material-symbols-outlined text-[18px]">print</span>
                                           </button>
                                           <button onClick={async () => {
                                               if (!confirm(`Czy na pewno chcesz anulować i usunąć przesyłkę ${s.trackingNumber}?`)) return;
                                               const actionCompanyName = (profile as any)?.activeCompanyId || (profile as any)?.companyId;
                                               try {
                                                   const cancelDhlShipment = httpsCallable(functions, 'cancelDhlShipment');
                                                   await cancelDhlShipment({ companyId: actionCompanyName, shipmentId: s.id });
                                                   alert('Przesyłka została anulowana');
                                                   loadDetails();
                                               } catch(e: any) {
                                                   alert('Błąd podczas anulowania: ' + e.message);
                                               }
                                           }} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Anuluj Etykietę">
                                              <span className="material-symbols-outlined text-[18px]">cancel</span>
                                           </button>
                                         </>
                                       )}
                                   </div>
                                 </td>
                             </tr>
                             );
                          })}
                       </tbody>
                    </table>
                 </div>
              </section>
              )}

              {/* Notatki */}
              {(o.notes || editMode) && (
              <section className="bg-white rounded-xl shadow-sm border border-yellow-200 overflow-hidden text-sm bg-yellow-50/20">
                 <div className="px-6 py-4 border-b border-yellow-100 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-yellow-600"/>
                    <h3 className="font-semibold text-yellow-800">{t('orderDetails.orderNotes')}</h3>
                 </div>
                 <div className="p-6">
                    {editMode ? (
                       <textarea className="w-full text-sm border-gray-300 rounded-md focus:ring-yellow-500 focus:border-yellow-500" rows={4} value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder={t('orderDetails.changeNotes')} />
                    ) : (
                       <p className="text-yellow-900 whitespace-pre-wrap leading-relaxed">{o.notes}</p>
                    )}
                 </div>
              </section>
              )}

               {/* Informacje o zamówieniu (wszystkie źródła) */}
               <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col mt-6 mb-6">
                  <div className="flex items-center justify-between mb-4">
                     <h4 className="font-bold text-gray-800 text-[14px]">{t('orderDetails.orderInfo', 'Informacje o zamówieniu')}</h4>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 text-[13px]">
                     <div>
                        <div className="flex gap-2 py-1 border-b border-gray-50"><span className="text-gray-500 w-[140px] flex-shrink-0">{t('orderDetails.orderValue', 'Wartość zamówienia')}</span><span className="text-gray-900 font-bold">{o.payment?.totalAmount} {o.currency || o.payment?.currency || 'PLN'}</span></div>
                        <div className="flex gap-2 py-1 border-b border-gray-50 flex-col sm:flex-row sm:items-center">
                           <span className="text-gray-500 w-[140px] flex-shrink-0">{t('orders.paymentStatus')}</span>
                           <div className="flex items-center gap-2">
                              {(o.payment?.paidAmount && Number(o.payment.paidAmount) > 0) ? (
                                <span className="bg-green-100 text-green-800 px-2 py-0.5 rounded text-[11px] font-medium border border-green-200 uppercase tracking-widest">
                                  {o.payment?.paidAmount} {o.payment?.currency || o.currency || 'PLN'}
                                </span>
                              ) : (
                                <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded text-[11px] font-medium border border-red-200 uppercase tracking-widest">
                                  {t('orders.pending')}
                                </span>
                              )}
                              {t('orders.outOf', 'z')} {o.payment?.totalAmount} {o.payment?.currency || o.currency || 'PLN'}
                           </div>
                        </div>
                        <div className="flex gap-2 py-1 border-b border-gray-50">
                           <span className="text-gray-500 w-[140px] flex-shrink-0">{t('orders.purchaseDate')}</span>
                           <span className="text-gray-900 font-medium">
                             {formatDateTime(o.orderedAt || o.createdAt, i18n.language)}
                           </span>
                        </div>
                        <div className="flex gap-2 py-1 border-b border-gray-50">
                           <span className="text-gray-500 w-[140px] flex-shrink-0">{t('orders.importDate')}</span>
                           <span className="text-gray-500 font-medium">
                             {formatDateTime(o.createdAt, i18n.language)}
                           </span>
                        </div>
                        <div className="flex gap-2 py-1 border-b border-gray-50">
                           <span className="text-gray-500 w-[140px] flex-shrink-0">{t('orders.shippingMethod')}</span>
                           <div className="flex-1 text-right sm:text-left">
                             <span className="text-gray-900 font-medium">{o.delivery?.method || o.shippingMethod || '-'}</span>
                             {o.delivery?.smart && (
                               <span className="ml-2 px-1.5 py-0.5 bg-green-100 text-green-800 text-[10px] rounded uppercase tracking-widest font-bold">
                                 SMART
                               </span>
                             )}
                           </div>
                        </div>
                        <div className="flex gap-2 py-1 border-b border-gray-50">
                           <span className="text-gray-500 w-[140px] flex-shrink-0">{t('orders.shippingCost')}</span>
                           <span className="text-gray-900 font-medium">
                             {o.delivery?.cost != null 
                               ? `${Number(o.delivery.cost).toFixed(2)} ${o.delivery?.currency || 'PLN'}`
                               : '-'
                             }
                           </span>
                        </div>
                        <div className="flex gap-2 py-1 border-b border-gray-50">
                           <span className="text-gray-500 w-[140px] flex-shrink-0">{t('orders.paymentMethod')}</span>
                           <span className="text-gray-900 font-medium">
                             {getPaymentMethodName(o.payment?.type || o.paymentMethod, o.payment?.provider)}
                           </span>
                        </div>
                        {o.payment?.finishedAt && (
                           <div className="flex gap-2 py-1"><span className="text-gray-500 w-[140px] flex-shrink-0">Zaksięgowano</span><span className="text-gray-900">{formatDateTime(o.payment?.finishedAt, i18n.language)}</span></div>
                        )}
                     </div>
                     <div>
                        <div className="flex gap-2 py-1 border-b border-gray-50"><span className="text-gray-500 w-[140px] flex-shrink-0">{t('orders.buyerEmail', 'Email kupującego')}</span><span className="text-blue-600 font-medium break-all">{o.buyer?.email || o.recipient?.email || '---'}</span></div>
                        <div className="flex gap-2 py-1 border-b border-gray-50"><span className="text-gray-500 w-[140px] flex-shrink-0">{t('orders.phone', 'Telefon')}</span><span className="text-gray-900 font-medium">{o.buyer?.phone || o.recipient?.phone || '---'}</span></div>
                        <div className="flex gap-2 py-1 border-b border-gray-50"><span className="text-gray-500 w-[140px] flex-shrink-0">{t('orders.buyerLogin', 'Login Kupującego')}</span><span className="text-gray-900 font-mono">{o.buyer?.login || '---'}</span></div>
                        <div className="flex gap-2 py-1"><span className="text-gray-500 w-[140px] flex-shrink-0">{t('orders.deliveryCountry', 'Kraj dostawy')}</span><span className="text-gray-900 font-medium uppercase">{o.countryCode || o.recipient?.address?.country || 'PL'}</span></div>
                     </div>
                  </div>
               </section>

         {/* Adresy poniżej tabeli z pozycjami zamówienia */}
         <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Adres dostawy */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col">
               <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-gray-800 text-[14px]">{t('orderDetails.deliveryAddress')}</h4>
                  <div className="flex gap-1.5">
                     <button className="p-1 rounded border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50 flex-shrink-0 transition-colors"><Copy className="w-3.5 h-3.5"/></button>
                     {isEditable && !editMode && <button onClick={() => setEditMode(true)} className="p-1 rounded border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50 flex-shrink-0 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>}
                     {editMode && <button onClick={handleSaveEdits} className="p-1 rounded border border-emerald-200 text-emerald-600 bg-emerald-50 flex-shrink-0 transition-colors"><Save className="w-3.5 h-3.5"/></button>}
                  </div>
               </div>
               <div className="text-[12px] flex-1">
                  <div className="flex gap-2 py-1"><span className="text-gray-500 w-[110px] flex-shrink-0">{t('orderDetails.address.fullName')}</span><span className="text-gray-900 font-medium whitespace-pre-wrap">
                     {editMode ? (
                        <div className="flex gap-2"><input type="text" className="w-full text-xs py-1.5 px-2 border border-gray-300 rounded outline-none focus:border-blue-500" value={editRecipient?.firstName || ''} onChange={(e) => setEditRecipient({...editRecipient, firstName: e.target.value})} placeholder="Imię" /><input type="text" className="w-full text-xs py-1.5 px-2 border border-gray-300 rounded outline-none focus:border-blue-500" value={editRecipient?.lastName || ''} onChange={(e) => setEditRecipient({...editRecipient, lastName: e.target.value})} placeholder="Nazwisko" /></div>
                     ) : <>{o.recipient?.firstName} {o.recipient?.lastName}</>}
                  </span></div>
                  <div className="flex gap-2 py-1"><span className="text-gray-500 w-[110px] flex-shrink-0">{t('orderDetails.address.company')}</span><span className="text-gray-900">{o.recipient?.companyName || '...'}</span></div>
                  <div className="flex gap-2 py-1"><span className="text-gray-500 w-[110px] flex-shrink-0">{t('orderDetails.address.street')}</span><span className="text-gray-900 w-full">
                     {editMode ? (
                        <input type="text" className="w-full text-xs py-1.5 px-2 border border-gray-300 rounded outline-none focus:border-blue-500" value={editRecipient?.address?.street || ''} onChange={(e) => setEditRecipient({...editRecipient, address: {...editRecipient.address, street: e.target.value}})} placeholder="Ulica" />
                     ) : <>{o.recipient?.address?.street || '...'}</>}
                  </span></div>
                  <div className="flex gap-2 py-1"><span className="text-gray-500 w-[110px] flex-shrink-0">{t('orderDetails.address.zipAndCity')}</span><span className="text-gray-900 w-full">
                     {editMode ? (
                        <div className="flex gap-2"><input type="text" className="w-1/3 text-xs py-1.5 px-2 border border-gray-300 rounded outline-none focus:border-blue-500" value={editRecipient?.address?.zipCode || ''} onChange={(e) => setEditRecipient({...editRecipient, address: {...editRecipient.address, zipCode: e.target.value}})} placeholder="Kod" /><input type="text" className="w-2/3 text-xs py-1.5 px-2 border border-gray-300 rounded outline-none focus:border-blue-500" value={editRecipient?.address?.city || ''} onChange={(e) => setEditRecipient({...editRecipient, address: {...editRecipient.address, city: e.target.value}})} placeholder="Miasto" /></div>
                     ) : <>{o.recipient?.address?.zipCode} {o.recipient?.address?.city || '...'}</>}
                  </span></div>
                  <div className="flex gap-2 py-1"><span className="text-gray-500 w-[110px] flex-shrink-0">{t('orderDetails.address.province')}</span><span className="text-gray-900">{(o.recipient?.address as any)?.province || (o.recipient?.address as any)?.state || '...'}</span></div>
                  <div className="flex gap-2 py-1"><span className="text-gray-500 w-[110px] flex-shrink-0">{t('orderDetails.address.country')}</span><span className="text-gray-900">{o.recipient?.address?.country || (o.recipient?.address as any)?.countryName || (o.recipient?.address as any)?.countryCode || '--'}</span></div>
               </div>
            </div>

            {/* Dane do faktury */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col">
               <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-gray-800 text-[14px]">{t('orderDetails.billingDetails')}</h4>
                  <div className="flex gap-1.5">
                     <button className="p-1 rounded border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50 flex-shrink-0 transition-colors"><Copy className="w-3.5 h-3.5"/></button>
                     {isEditable && !editMode && <button onClick={() => setEditMode(true)} className="p-1 rounded border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50 flex-shrink-0 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>}
                  </div>
               </div>
               <div className="text-[12px] flex-1">
                  <div className="flex gap-2 py-1"><span className="text-gray-500 w-[110px] flex-shrink-0">{t('orderDetails.address.fullName')}</span><span className="text-gray-900">{o.invoice?.companyName || o.invoiceDetails?.name || o.recipient?.firstName + ' ' + o.recipient?.lastName}</span></div>
                  <div className="flex gap-2 py-1"><span className="text-gray-500 w-[110px] flex-shrink-0">{t('orderDetails.address.company')}</span><span className="text-gray-900">{o.invoice?.companyName || o.invoiceDetails?.companyName || '...'}</span></div>
                  <div className="flex gap-2 py-1"><span className="text-gray-500 w-[110px] flex-shrink-0">{t('orderDetails.address.street')}</span><span className="text-gray-900">{o.invoiceDetails?.address?.street || o.recipient?.address?.street || '...'}</span></div>
                  <div className="flex gap-2 py-1"><span className="text-gray-500 w-[110px] flex-shrink-0">{t('orderDetails.address.zipAndCity')}</span><span className="text-gray-900">{o.invoiceDetails?.address?.zipCode || o.recipient?.address?.zipCode} {o.invoiceDetails?.address?.city || o.recipient?.address?.city || '...'}</span></div>
                  <div className="flex gap-2 py-1"><span className="text-gray-500 w-[110px] flex-shrink-0">{t('orderDetails.address.vatNumber')}</span><span className="text-gray-900 font-medium">{o.invoice?.taxId || o.invoiceDetails?.vatNumber || '...'}</span></div>
                  <div className="flex gap-2 py-1"><span className="text-gray-500 w-[110px] flex-shrink-0">Faktura Wymagana?</span><span className="text-gray-900">{o.invoice?.required ? "TAK" : o.invoiceDetails ? "TAK" : "NIE"}</span></div>
               </div>
            </div>

            {/* Odbiór w punkcie */}
            {o.pickupPoint && (
            <div className="bg-indigo-50/50 rounded-xl shadow-sm border border-indigo-200 p-5 flex flex-col">
               <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-indigo-900 text-[14px] flex items-center gap-2">
                    <Truck className="w-5 h-5 text-indigo-600"/>
                    {t('orderDetails.pickupPoint')}
                  </h4>
               </div>
               <div className="text-[12px] flex-1">
                  <div className="flex gap-2 py-1 border-b border-indigo-100/50"><span className="text-indigo-600/70 w-[110px] flex-shrink-0">{t('orderDetails.address.name')}</span><span className="text-indigo-900 font-bold">{o.pickupPoint.name}</span></div>
                  <div className="flex gap-2 py-1 border-b border-indigo-100/50"><span className="text-indigo-600/70 w-[110px] flex-shrink-0">{t('orderDetails.address.id')}</span><span className="text-indigo-900 font-mono">{o.pickupPoint.id}</span></div>
                  <div className="flex gap-2 py-1 border-b border-indigo-100/50"><span className="text-indigo-600/70 w-[110px] flex-shrink-0">{t('orderDetails.address.street')}</span><span className="text-indigo-900">{o.pickupPoint.address}</span></div>
                  <div className="flex gap-2 py-1"><span className="text-indigo-600/70 w-[110px] flex-shrink-0">{t('orderDetails.address.zipAndCity')}</span><span className="text-indigo-900">{o.pickupPoint.zipCode} {o.pickupPoint.city}</span></div>
               </div>
            </div>
            )}
            
            {/* Odbiór w punkcie (jeśli to tylko placeholder w strukturze i brak w pickupPoint) */}
            {!o.pickupPoint && (o as any).pickupPoint?.name && (
            <div className="bg-indigo-50/50 rounded-xl shadow-sm border border-indigo-200 p-5 flex flex-col">
               <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-indigo-900 text-[14px] flex items-center gap-2">
                    <Truck className="w-5 h-5 text-indigo-600"/>
                    {t('orderDetails.pickupPoint')}
                  </h4>
               </div>
               <div className="text-[12px] flex-1">
                  <div className="flex gap-2 py-1 border-b border-indigo-100/50"><span className="text-indigo-600/70 w-[110px] flex-shrink-0">{t('orderDetails.address.name')}</span><span className="text-indigo-900 font-bold">{(o as any).pickupPoint.name}</span></div>
                  <div className="flex gap-2 py-1 border-b border-indigo-100/50"><span className="text-indigo-600/70 w-[110px] flex-shrink-0">{t('orderDetails.address.id')}</span><span className="text-indigo-900 font-mono">{(o as any).pickupPoint.id}</span></div>
                  <div className="flex gap-2 py-1 border-b border-indigo-100/50"><span className="text-indigo-600/70 w-[110px] flex-shrink-0">{t('orderDetails.address.street')}</span><span className="text-indigo-900">{(o as any).pickupPoint.address}</span></div>
                  <div className="flex gap-2 py-1"><span className="text-indigo-600/70 w-[110px] flex-shrink-0">{t('orderDetails.address.zipAndCity')}</span><span className="text-indigo-900">{(o as any).pickupPoint.zipCode} {(o as any).pickupPoint.city}</span></div>
               </div>
            </div>
            )}
         </div>

         {/* Dziennik Zdarzeń (System Logs) */}
         <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
               <h3 className="font-semibold text-gray-900 text-sm">{t('orderDetails.history.title')}</h3>
            </div>
            <div className="px-6 py-4 divide-y divide-gray-100 max-h-80 overflow-auto">
               {data.activityLogs.length === 0 && <p className="text-sm text-gray-500 -mt-2">{t('orderDetails.history.empty')}</p>}
               {data.activityLogs.map(log => {
                  let actionDisplay = log.action;
                  let details = null;
                  
                  if (log.action === 'LABEL_GENERATED') {
                     actionDisplay = t('orderDetails.history.labelGenerated', 'Wygenerowano etykietę kurierską');
                     details = <div className="text-[11px] font-mono text-gray-500 mt-1">{t('common.no', 'Nr:')} {log.trackingNumber} ({log.carrier})</div>;
                  } else if (log.action === 'packing_completed') {
                     actionDisplay = <><span className="mr-1">📦✅</span> {t('orderDetails.history.packingCompleted', 'Spakowano i przekazano do kuriera')}</>;
                     if (log.trackingNumber) {
                        details = <div className="text-[11px] font-mono text-gray-500 mt-1">{t('common.no', 'Nr:')} {log.trackingNumber}</div>;
                     }
                  } else if (log.action === 'sent_to_fulfillment') {
                     actionDisplay = <><span className="mr-1">📦</span> {t('orderDetails.history.sentToFulfillment', 'Przekazano do pakowania')}</>;
                  }

                  return (
                  <div key={log.id} className="py-2.5">
                     <div className="text-xs font-semibold text-gray-900 mb-0.5">{actionDisplay}</div>
                     {details}
                     <div className="text-[10px] text-gray-400 font-medium mt-1">{formatDateTime(log.timestamp, i18n.language)}</div>
                  </div>
                  );
               })}
            </div>
         </section>

         {/* Panel Nadawania Etykiet (Zastępuje DhlShipmentModal) */}
         {o.status !== 'cancelled' && data.items.length > 0 && (
            <OrderShipmentPanel
               order={o}
               items={data.items}
               companyId={(profile as any)?.activeCompanyId || (profile as any)?.companyId}
               onSuccess={() => {
                  loadDetails();
               }}
            />
         )}
         {mappingModalItem && (
           <ManualMappingModal
             isOpen={!!mappingModalItem}
             onClose={() => setMappingModalItem(null)}
             companyId={(profile as any)?.activeCompanyId || (profile as any)?.companyId}
             orderItem={{
               id: mappingModalItem.id,
               ean: mappingModalItem.ean,
               sku: mappingModalItem.sku,
               name: mappingModalItem.name,
               qtyOrdered: mappingModalItem.qtyOrdered
             }}
             onSuccess={() => { loadDetails(); }}
           />
         )}
      </div>
   );
}
