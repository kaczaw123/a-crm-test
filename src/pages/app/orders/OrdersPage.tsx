import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, orderBy, limit, startAfter, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { useAuth } from '../../../auth/useAuth';
import type { Order } from '../../../data/orders';
import { Eye, Plus, Loader2, Trash2, CheckCircle2, Truck, Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDateTime } from '../../../utils/dateUtils';
import { AppTour } from '../../../components/common/AppTour';
import { BulkLabelModal } from '../../../components/orders/BulkLabelModal';

const PAGE_SIZE = 200;


export default function OrdersPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();
  const navigate = useNavigate();
  
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [importStatusMsg, setImportStatusMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);

  const [filterShipped, setFilterShipped] = useState<'all' | 'shipped' | 'not_shipped'>('all');
  const [filterFulfillment, setFilterFulfillment] = useState<'all' | 'in_fulfillment' | 'not_in_fulfillment'>('all');
  const [filterMapped, setFilterMapped] = useState<'all' | 'mapped' | 'not_mapped'>('all');
  const [sortBy, setSortBy] = useState<'date_desc' | 'mapped' | 'not_mapped' | 'shipped' | 'not_shipped' | 'fulfillment' | 'not_fulfillment'>('date_desc');

  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [isBulkLabelModalOpen, setIsBulkLabelModalOpen] = useState(false);

  const handleSelectOrder = (orderId: string) => {
    setSelectedOrders(prev => 
      prev.includes(orderId) 
        ? prev.filter(id => id !== orderId)
        : [...prev, orderId]
    );
  };

  const displayOrders = [...orders]
    .filter(o => {
      const isMapped = (o as any).firstItemSource === 'crm_product' || (o as any).hasManualMapping === true || (o as any).allItemsMapped === true;
      const trackingNumber = (o as any).shipping?.trackingNumber || (o as any).trackingNumber || '';
      const inFulfillment = ['ready_for_shipping', 'in_fulfillment', 'label_created', 'shipped'].includes((o as any).status);

      if (filterShipped === 'shipped' && !trackingNumber) return false;
      if (filterShipped === 'not_shipped' && trackingNumber) return false;

      if (filterFulfillment === 'in_fulfillment' && !inFulfillment) return false;
      if (filterFulfillment === 'not_in_fulfillment' && inFulfillment) return false;

      if (filterMapped === 'mapped' && !isMapped) return false;
      if (filterMapped === 'not_mapped' && isMapped) return false;

      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'date_desc') return 0;
      
      const isMappedA = (a as any).firstItemSource === 'crm_product' || (a as any).hasManualMapping === true || (a as any).allItemsMapped === true;
      const isMappedB = (b as any).firstItemSource === 'crm_product' || (b as any).hasManualMapping === true || (b as any).allItemsMapped === true;
      
      const trackingA = (a as any).shipping?.trackingNumber || (a as any).trackingNumber || '';
      const trackingB = (b as any).shipping?.trackingNumber || (b as any).trackingNumber || '';

      const inFulfillmentA = ['ready_for_shipping', 'in_fulfillment', 'label_created', 'shipped'].includes((a as any).status);
      const inFulfillmentB = ['ready_for_shipping', 'in_fulfillment', 'label_created', 'shipped'].includes((b as any).status);

      if (sortBy === 'mapped') return (isMappedA === isMappedB) ? 0 : isMappedA ? -1 : 1;
      if (sortBy === 'not_mapped') return (isMappedA === isMappedB) ? 0 : isMappedA ? 1 : -1;
      if (sortBy === 'shipped') return (!!trackingA === !!trackingB) ? 0 : trackingA ? -1 : 1;
      if (sortBy === 'not_shipped') return (!!trackingA === !!trackingB) ? 0 : trackingA ? 1 : -1;
      if (sortBy === 'fulfillment') return (inFulfillmentA === inFulfillmentB) ? 0 : inFulfillmentA ? -1 : 1;
      if (sortBy === 'not_fulfillment') return (inFulfillmentA === inFulfillmentB) ? 0 : inFulfillmentA ? 1 : -1;

      return 0;
    });

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedOrders(displayOrders.map(o => o.id));
    } else {
      setSelectedOrders([]);
    }
  };

  const allSelected = displayOrders.length > 0 && selectedOrders.length === displayOrders.length;

  const loadOrders = async (isNextPage = false) => {
    const currentCompanyId = (profile as any)?.activeCompanyId || (profile as any)?.companyId;
    if (!currentCompanyId) return;
    
    try {
      setLoading(true);
      const ordersRef = collection(db, `companies/${currentCompanyId}/orders`);
      
      let q = query(
        ordersRef,
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE)
      );

      if (isNextPage && lastDoc) {
        q = query(
          ordersRef,
          orderBy('createdAt', 'desc'),
          startAfter(lastDoc),
          limit(PAGE_SIZE)
        );
      }

      const snapshot = await getDocs(q);
      
      const newOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
      
      if (isNextPage) {
        setOrders(prev => [...prev, ...newOrders]);
      } else {
        setOrders(newOrders);
      }

      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      if (snapshot.docs.length < PAGE_SIZE) {
        setHasMore(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };


  const handleDeleteSelected = async () => {
    if (!window.confirm(t('orders.confirmDelete', 'Czy na pewno chcesz usunąć zaznaczone zamówienia? Zostaną one nieodwracalnie skasowane.'))) return;
    
    const currentCompanyId = (profile as any)?.activeCompanyId || (profile as any)?.companyId;
    if (!currentCompanyId || selectedOrders.length === 0) return;

    setIsDeleting(true);
    try {
      const batch = writeBatch(db);
      for (const orderId of selectedOrders) {
        batch.delete(doc(db, `companies/${currentCompanyId}/orders`, orderId));
      }
      await batch.commit();
      
      setSelectedOrders([]);
      loadOrders(false);
      setImportStatusMsg({ type: 'success', text: t('orders.deleteSuccess', 'Pomyślnie usunięto wybrane zamówienia.') });
    } catch (error) {
      console.error('Error deleting orders:', error);
      setImportStatusMsg({ type: 'error', text: t('orders.deleteError', 'Wystąpił błąd podczas usuwania zamówień.') });
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    setOrders([]);
    setLastDoc(null);
    setHasMore(true);
    loadOrders(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(profile as any)?.activeCompanyId, (profile as any)?.companyId]);

  const [runTour, setRunTour] = useState(false);

  useEffect(() => {
    // Sprawdzanie czy użytkownik ma ukończoną tę wycieczkę w swoim globalnym profilu
    const completed = (profile as any)?.completedTours || [];
    if (!completed.includes('orders_v1')) {
      setTimeout(() => setRunTour(true), 500);
    }
  }, [profile]);

  const handleTourFinish = () => {
    setRunTour(false);
  };

  const tourSteps = [
    {
      target: '#tour-orders-header',
      content: t('tour.orders.welcome', 'Witaj w module Zamówień! Tutaj znajduje się centrum zarządzania realizacją (Fulfillment Engine).'),
      disableBeacon: true,
    },
    {
      target: '#tour-orders-new',
      content: t('tour.orders.newButton', 'Jeśli potrzebujesz dodać zamówienie ręcznie, po prostu kliknij ten przycisk.'),
    },
    {
      target: '#tour-orders-filters',
      content: t('tour.orders.filters', 'Nowość! Zaawansowana filtracja. Od teraz możesz szybko wyszukiwać zamówienia niezmapowane, wysłane czy przekazane do fulfillmentu.'),
    },
    {
      target: '#tour-orders-table-status',
      content: t('tour.orders.tableStatus', 'Tutaj znajdziesz nowe ikony w pigułce: ptaszek (zmapowano produkt), ciężarówka (dodano list przewozowy) oraz paczka (zlecono do realizacji na magazynie).'),
    }
  ];

  return (
    <div className="h-[calc(100vh-64px)] overflow-hidden flex flex-col bg-gray-50 relative">
      <AppTour run={runTour} steps={tourSteps} tourId="orders_v1" eurReward={50} onFinish={handleTourFinish} />
      
      {importStatusMsg && (
        <div className={`m-4 rounded-xl p-3 border shadow-sm ${importStatusMsg.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'} text-sm font-medium flex items-center justify-between shrink-0`}>
           <span>{importStatusMsg.text}</span>
           <button onClick={() => setImportStatusMsg(null)} className="opacity-70 hover:opacity-100 p-1 text-lg leading-none">×</button>
        </div>
      )}

      {/* Filters, Sorting & Actions */}
      <div id="tour-orders-filters" className="bg-white border-b border-gray-200 p-4 flex flex-col xl:flex-row gap-4 items-start xl:items-center justify-between shrink-0">
         <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-gray-600">{t('orders.filters.label', 'Filtry:')}</span>
            <select className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none" value={filterMapped} onChange={e => setFilterMapped(e.target.value as any)}>
               <option value="all">{t('orders.filters.mappedAll', 'Wszystkie mapowania')}</option>
               <option value="mapped">{t('orders.filters.mappedYes', 'Zmapowane')}</option>
               <option value="not_mapped">{t('orders.filters.mappedNo', 'Niezmapowane')}</option>
            </select>
            <select className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none" value={filterFulfillment} onChange={e => setFilterFulfillment(e.target.value as any)}>
               <option value="all">{t('orders.filters.fulfillmentAll', 'Wszystkie statusy fulfillment')}</option>
               <option value="in_fulfillment">{t('orders.filters.fulfillmentYes', 'Przekazane do fulfillmentu')}</option>
               <option value="not_in_fulfillment">{t('orders.filters.fulfillmentNo', 'Nieprzekazane')}</option>
            </select>
            <select className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none" value={filterShipped} onChange={e => setFilterShipped(e.target.value as any)}>
               <option value="all">{t('orders.filters.shippedAll', 'Wszystkie wysyłki')}</option>
               <option value="shipped">{t('orders.filters.shippedYes', 'Wysłane')}</option>
               <option value="not_shipped">{t('orders.filters.shippedNo', 'Niewysłane')}</option>
            </select>
         </div>
         <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
            <span className="text-sm font-semibold text-gray-600">{t('orders.sort.label', 'Sortuj:')}</span>
            <select className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50 focus:ring-2 focus:ring-blue-500 outline-none" value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
               <option value="date_desc">{t('orders.sort.dateDesc', 'Data dodania (najnowsze)')}</option>
               <option value="mapped">{t('orders.sort.mappedYes', 'Zmapowane na górze')}</option>
               <option value="not_mapped">{t('orders.sort.mappedNo', 'Niezmapowane na górze')}</option>
               <option value="shipped">{t('orders.sort.shippedYes', 'Wysłane na górze')}</option>
               <option value="not_shipped">{t('orders.sort.shippedNo', 'Niewysłane na górze')}</option>
               <option value="fulfillment">{t('orders.sort.fulfillmentYes', 'W fulfillment na górze')}</option>
               <option value="not_fulfillment">{t('orders.sort.fulfillmentNo', 'Nie w fulfillment na górze')}</option>
            </select>

            <div className="h-6 w-px bg-gray-200 mx-1 hidden sm:block"></div>

            {selectedOrders.length > 0 && (
              <>
                <button
                  onClick={() => setIsBulkLabelModalOpen(true)}
                  className="flex items-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-4 py-1.5 rounded-lg font-bold text-[13px] transition-all whitespace-nowrap"
                >
                  <Truck className="w-4 h-4" />
                  Zbiorcze Etykiety ({selectedOrders.length})
                </button>
                <button
                  onClick={handleDeleteSelected}
                  disabled={isDeleting}
                  className="flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-4 py-1.5 rounded-lg font-bold text-[13px] transition-all disabled:opacity-50 whitespace-nowrap"
                >
                  {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  {t('orders.deleteSelected', 'Usuń wybrane')} ({selectedOrders.length})
                </button>
              </>
            )}
            <button
              id="tour-orders-new"
              onClick={() => navigate('/app/orders/new')}
              className="flex items-center gap-2 bg-[#0A3D91] hover:bg-[#0A3D91]/90 text-white px-4 py-1.5 rounded-lg font-bold text-[13px] transition-colors whitespace-nowrap shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              {t('orders.newButton', 'Nowe Zamówienie')}
            </button>
         </div>
      </div>

      {/* Table */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden relative">
        <div className="overflow-x-auto overflow-y-auto flex-1 w-full relative">
          <table className="w-full text-left whitespace-nowrap">
            <thead className="bg-[#F8FAFC] border-b border-gray-200 sticky top-0 z-10 hidden md:table-header-group shadow-sm">
              <tr>
                <th className="w-10 px-3 py-2 text-center bg-[#F8FAFC]">
                  <input 
                    type="checkbox" 
                    onChange={handleSelectAll}
                    checked={allSelected}
                    className="rounded border-gray-300 w-4 h-4 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </th>
                <th className="py-2 px-3 text-[10px] font-black text-gray-500 uppercase tracking-widest w-[10%] bg-[#F8FAFC]">
                  {t('orders.table.date', 'Data')}
                </th>
                <th className="py-2 px-3 text-[10px] font-black text-gray-500 uppercase tracking-widest w-[12%] bg-[#F8FAFC]">
                  {t('orders.table.orderAndSource')}
                </th>
                <th className="py-2 px-3 text-[10px] font-black text-gray-500 uppercase tracking-widest w-[18%] bg-[#F8FAFC]">
                  {t('orders.table.recipient')}
                </th>
                <th className="py-2 px-3 text-[10px] font-black text-gray-500 uppercase tracking-widest w-[5%] text-center bg-[#F8FAFC]">
                  {t('orders.table.country', 'Kraj')}
                </th>
                <th className="py-2 px-3 text-[10px] font-black text-gray-500 uppercase tracking-widest w-[25%] bg-[#F8FAFC]">
                  {t('orders.table.items')}
                </th>
                <th id="tour-orders-table-status" className="py-2 px-3 text-[10px] font-black text-gray-500 uppercase tracking-widest w-[12%] bg-[#F8FAFC]">
                  {t('orders.table.shippingAndStatus')}
                </th>
                <th className="py-2 px-3 text-[10px] font-black text-gray-500 uppercase tracking-widest text-center w-[12%] bg-[#F8FAFC]">
                  {t('orders.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayOrders.map((o) => (
                <tr key={o.id} className="hover:bg-blue-50/30 transition-colors group bg-white h-12">
                  <td className="px-3 py-2 text-center align-middle">
                    <input 
                      type="checkbox" 
                      checked={selectedOrders.includes(o.id)}
                      onChange={() => handleSelectOrder(o.id)}
                      className="rounded border-gray-300 w-4 h-4 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </td>
                  
                  {/* DATA */}
                  <td className="py-2 px-3 align-middle text-[12px] font-medium text-gray-500 whitespace-normal">
                     {formatDateTime(o.orderedAt || o.createdAt, i18n.language)}
                  </td>

                  {/* KOLUMNA 1: NUMER I ZRODLO */}
                  <td className="py-2 px-3 align-middle">
                    <div className="font-bold text-[13px] text-[#0A3D91]">
                      {o.orderNumber || o.id.substring(0,8)}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                       <span className="px-1.5 py-[1px] rounded text-[9px] font-bold tracking-widest text-gray-600 bg-gray-100 uppercase">
                         {o.source}
                       </span>
                    </div>
                  </td>

                  {/* KOLUMNA 2: ODBIORCA */}
                  <td className="py-2 px-3 align-middle whitespace-normal min-w-[160px]">
                    <div className="font-semibold text-[13px] text-gray-900 leading-snug">
                       {o.recipientDisplayName || `${o.recipient?.firstName || ''} ${o.recipient?.lastName || ''}`}
                    </div>
                    <div className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5 font-mono">
                      <span className="material-symbols-outlined text-[13px]">location_on</span>
                      {o.recipientCity || o.recipient?.address?.city || t('orders.noCity')}
                    </div>
                  </td>

                  {/* KOLUMNA KRAJ */}
                  <td className="py-2 px-3 align-middle text-center">
                    {(() => {
                      let code = (o as any).countryCode || (o.recipient?.address as any)?.countryCode || o.recipient?.address?.country?.trim();
                      if (code && code.length > 2) {
                        const lower = code.toLowerCase();
                        if (lower.includes('deutschland') || lower.includes('germany') || lower.includes('niemcy')) code = 'DE';
                        else if (lower.includes('poland') || lower.includes('polska')) code = 'PL';
                        else if (lower.includes('österreich') || lower.includes('austria')) code = 'AT';
                        else if (lower.includes('schweiz') || lower.includes('switzerland')) code = 'CH';
                        else code = ''; // Nierozpoznany długi ciąg
                      }

                      return code && code.length === 2 ? (
                        <div className="flex flex-col items-center gap-1">
                          <img
                            src={`https://flagcdn.com/w20/${code.toLowerCase()}.png`}
                            srcSet={`https://flagcdn.com/w40/${code.toLowerCase()}.png 2x`}
                            width="20"
                            alt={code}
                            className="rounded-[2px] shadow-sm block"
                          />
                        </div>
                      ) : (
                        <span className="text-gray-300 text-[18px]">—</span>
                      );
                    })()}
                  </td>

                  {/* KOLUMNA 3: PRZEDMIOTY (Główny szybki pogląd) */}
                  <td className="py-2 px-3 align-middle">
                    {(() => {
                      const itemsList = (o as any).items || (o as any).orderItems || [];
                      const firstItemName = o.firstItemName || itemsList[0]?.name;
                      const firstItemSku = o.firstItemSku || itemsList[0]?.sku;
                      const firstItemEan = o.firstItemEan || itemsList[0]?.ean;
                      const firstItemImageUrl = o.firstItemImageUrl || itemsList[0]?.imageUrl || itemsList[0]?.crmProductSnapshot?.imageThumbUrl || '';
                      const itemCount = o.itemCount || itemsList.length;

                      return (
                    <div className="flex items-start gap-3">
                       {firstItemImageUrl ? (
                          <div className="w-10 h-10 shrink-0 border border-gray-100 rounded-lg overflow-hidden flex items-center justify-center bg-gray-50 group-hover:border-blue-200 transition-colors">
                            <img src={firstItemImageUrl} alt="Product" className="w-full h-full object-cover" />
                          </div>
                       ) : (
                          <div className="w-10 h-10 shrink-0 bg-gray-50 border border-gray-100 rounded-lg flex items-center justify-center text-gray-300 group-hover:bg-white group-hover:border-gray-200 transition-colors">
                             <span className="material-symbols-outlined text-[20px]">package_2</span>
                          </div>
                       )}

                       <div className="flex-1 min-w-0">
                           {firstItemName ? (
                             <>
                               <div className="text-[13px] font-medium text-gray-900 truncate flex items-center gap-1" title={firstItemName}>
                                  {firstItemName}
                               </div>
                               <div className="flex flex-wrap items-center gap-2 mt-1">
                                  {firstItemSku && (
                                     <span className="text-[11px] font-mono text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
                                        SKU: {firstItemSku}
                                     </span>
                                  )}
                                  {firstItemEan && (
                                     <span className="text-[11px] font-mono text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
                                        EAN: {firstItemEan}
                                     </span>
                                  )}
                                  {(itemCount && itemCount > 1) ? (
                                     <span className="text-[11px] font-bold text-[#0A3D91] bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                                        +{itemCount - 1} {t('orders.pcs', 'szt')}
                                     </span>
                                  ) : null}
                               </div>
                             </>
                          ) : (
                             <div className="text-[13px] text-gray-400 italic mt-2">{t('orders.noPreview')}</div>
                          )}
                       </div>
                    </div>
                      );
                    })()}
                  </td>

                  {/* KOLUMNA 4: WYSYŁKA & STATUS */}
                  <td className="py-2 px-3 align-middle">
                    <div className="flex flex-col gap-2 items-start">
                       {/* Ikony statusu: zmapowano | tracking | fulfillment */}
                       {(() => {
                          const isMapped = (o as any).firstItemSource === 'crm_product' 
                            || (o as any).hasManualMapping === true 
                            || (o as any).allItemsMapped === true;
                          const trackingNumber = (o as any).shipping?.trackingNumber || (o as any).trackingNumber || '';
                          const carrier = (o as any).shipping?.carrier || (o as any).courierCode || '';
                          const inFulfillment = ['ready_for_shipping', 'in_fulfillment', 'label_created', 'shipped'].includes((o as any).status);
                          
                          return (
                             <div className="flex items-center gap-1.5 mb-1">
                                {/* Ikona: zmapowano */}
                                <span 
                                   className={`inline-flex items-center justify-center w-6 h-6 rounded-md ${isMapped ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-300'}`}
                                   title={isMapped ? t('orders.icon.mapped', 'Zmapowano z katalogiem') : t('orders.icon.notMapped', 'Niezmapowano')}
                                >
                                   <CheckCircle2 className="w-4 h-4" />
                                </span>
                                
                                {/* Ikona: tracking (furgonetka) */}
                                <span 
                                   className={`inline-flex items-center justify-center w-6 h-6 rounded-md ${trackingNumber ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-300'}`}
                                   title={trackingNumber ? `${t('orders.icon.tracking', 'Numer listu')}: ${trackingNumber}${carrier ? ' (' + carrier + ')' : ''}` : t('orders.icon.noTracking', 'Brak numeru listu')}
                                >
                                   <Truck className="w-4 h-4" />
                                </span>
                                
                                {/* Ikona: przekazano do fulfillmentu (paczka) */}
                                <span 
                                   className={`inline-flex items-center justify-center w-6 h-6 rounded-md ${inFulfillment ? 'bg-orange-100 text-orange-600' : 'bg-gray-100 text-gray-300'}`}
                                   title={inFulfillment ? t('orders.icon.inFulfillment', 'Przekazano do fulfillmentu') : t('orders.icon.notInFulfillment', 'Nie przekazano do fulfillmentu')}
                                >
                                   <Package className="w-4 h-4" />
                                </span>
                             </div>
                          );
                       })()}
                    </div>
                  </td>

                  {/* KOLUMNA 5: AKCJE */}
                  <td className="py-2 px-3 align-middle text-center">
                    <button 
                      onClick={() => navigate(`/app/orders/${o.id}`)}
                      className="text-gray-400 hover:text-[#0A3D91] hover:bg-blue-50 transition-colors p-2 rounded-lg inline-flex items-center gap-2"
                      title={t('orders.previewButton')}
                    >
                      <Eye className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
              
              {displayOrders.length === 0 && orders.length > 0 && !loading && (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                     <div className="flex flex-col items-center justify-center text-gray-400">
                        <p className="text-[15px] font-medium text-gray-500">{t('orders.emptyFiltered.title', 'Brak wyników w bieżącym widoku')}</p>
                        <p className="text-[13px] mt-1">{t('orders.emptyFiltered.subtitle', 'Żadne z wczytanych zamówień nie spełnia kryteriów filtrowania. Spróbuj wczytać kolejne zamówienia lub zmień filtry.')}</p>
                        {hasMore && (
                          <button onClick={() => loadOrders(true)} className="mt-4 px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors rounded-lg text-sm font-bold">
                            {t('orders.emptyFiltered.loadMore', 'Wczytaj kolejne z bazy')}
                          </button>
                        )}
                     </div>
                  </td>
                </tr>
              )}
              {orders.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                     <div className="flex flex-col items-center justify-center text-gray-400">
                        <span className="material-symbols-outlined text-5xl mb-3 opacity-50">shopping_cart_checkout</span>
                        <p className="text-[15px] font-medium text-gray-500">{t('orders.emptyState.title')}</p>
                        <p className="text-[13px] mt-1">{t('orders.emptyState.subtitle')}</p>
                     </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {hasMore && orders.length > 0 && (
           <div className="px-4 py-2 bg-white border-t border-gray-100 flex justify-center shrink-0">
             <button
               onClick={() => loadOrders(true)}
               disabled={loading}
               className="inline-flex items-center gap-2 px-6 py-1.5 border border-gray-200 text-[12px] uppercase font-bold rounded-full text-[#0A3D91] bg-white hover:bg-blue-50 disabled:opacity-50 transition-colors shadow-sm"
             >
               {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span className="material-symbols-outlined text-[16px]">expand_more</span>}
               {loading ? t('orders.loading') : t('orders.loadMore')}
             </button>
           </div>
        )}
      </div>
      
      {isBulkLabelModalOpen && (
        <BulkLabelModal
          orders={orders.filter(o => selectedOrders.includes(o.id))}
          companyId={(profile as any)?.activeCompanyId || (profile as any)?.companyId}
          onClose={() => setIsBulkLabelModalOpen(false)}
          onComplete={() => {
            setSelectedOrders([]);
            loadOrders(false);
          }}
        />
      )}
    </div>
  );
}
