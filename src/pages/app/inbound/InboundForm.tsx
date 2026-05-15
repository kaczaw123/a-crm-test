import React, { useState, useEffect, useRef, useMemo } from 'react';
import { collection, query, getDocs, limit, where } from 'firebase/firestore';
import { db, functions } from '../../../firebase/config';
import { httpsCallable } from 'firebase/functions';
import { useTranslation } from 'react-i18next';
import { getGlobalWarehouses, getCompanyWarehouseAccess } from '../../../data/warehouses';
import type { GlobalWarehouse } from '../../../data/warehouses';
import type { ProductV2 } from '../../../data/products';
import { type InboundShipment, type InboundShipmentItem } from '../../../data/inbound';

interface Props {
  companyId: string;
  draftId?: string;
  onClose: () => void;
}

interface FormItem {
  id: string; // internal unique key
  productId: string | null;
  sourceType: 'catalog_product' | 'manual_product';
  name: string;
  sku: string;
  ean: string;
  expectedQty: number;
  unit: string;
  length: number;
  width: number;
  height: number;
  weight: number;
}

export default function InboundForm({ companyId, draftId, onClose }: Props) {
  const { t } = useTranslation();
  
  // Header state
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [plannedDeliveryDate, setPlannedDeliveryDate] = useState('');
  const [etaDate, setEtaDate] = useState('');
  
  const [availableWarehouses, setAvailableWarehouses] = useState<GlobalWarehouse[]>([]);
  const [destinationLocationId, setDestinationLocationId] = useState('');
  
  // Items state
  const [items, setItems] = useState<FormItem[]>([]);
  
  // Autocomplete state
  const [activeSearchRow, setActiveSearchRow] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<ProductV2[]>([]);
  const searchDropdownRef = useRef<HTMLDivElement>(null);

  // Form states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 1. Initial Load (Fulfillment Warehouses)
  useEffect(() => {
    Promise.all([
      getGlobalWarehouses(),
      getCompanyWarehouseAccess(companyId)
    ]).then(([allWarehouses, accesses]) => {
      const allowed = allWarehouses.filter(w => w.isActive && accesses.some(a => a.warehouseId === w.id));
      setAvailableWarehouses(allowed);
      if (allowed.length > 0) {
        const defAccess = accesses.find(a => a.isDefaultForCompany);
        if (defAccess && allowed.some(a => a.id === defAccess.warehouseId)) {
           setDestinationLocationId(defAccess.warehouseId);
        } else {
           setDestinationLocationId(allowed[0].id);
        }
      }
    }).catch(console.error);
  }, [companyId]);

  // Pobranie danych Draftu jeśli otwarty do edycji
  useEffect(() => {
    if (!draftId) return;
    setLoading(true);
    const loadDraft = async () => {
      try {
         const { getDoc, doc, collection, getDocs } = await import('firebase/firestore');
         const sDoc = await getDoc(doc(db, `companies/${companyId}/inboundShipments`, draftId));
         if (sDoc.exists()) {
           const sData = sDoc.data() as InboundShipment;
           setCarrier(sData.carrier || '');
           setTrackingNumber(sData.trackingNumber || '');
           
           if (sData.plannedDeliveryDate) {
              const d = (sData.plannedDeliveryDate as any).toDate ? (sData.plannedDeliveryDate as any).toDate() : new Date((sData.plannedDeliveryDate as any).seconds * 1000);
              setPlannedDeliveryDate(d.toISOString().slice(0,10));
           }
           if ((sData as any).etaDate) {
              const d2 = ((sData as any).etaDate as any).toDate ? ((sData as any).etaDate as any).toDate() : new Date(((sData as any).etaDate as any).seconds * 1000);
              setEtaDate(d2.toISOString().substring(0,16));
           }
           
           const itemsSnap = await getDocs(collection(db, `companies/${companyId}/inboundShipments/${draftId}/items`));
           const loadedItems: FormItem[] = itemsSnap.docs.map(iDoc => {
             const i = iDoc.data() as InboundShipmentItem;
             return {
               id: iDoc.id,
               productId: i.productId,
               sourceType: i.productId ? 'catalog_product' : 'manual_product',
               name: i.name || '',
               sku: i.sku || '',
               ean: i.ean || '',
               expectedQty: i.expectedQty || 1,
               unit: 'szt.',
               length: i.lengthPerUnit || 0,
               width: i.widthPerUnit || 0,
               height: i.heightPerUnit || 0,
               weight: i.weightPerUnit || 0
             };
           });
           setItems(loadedItems);
         }
      } catch (e) {
         console.error('Błąd ładowania draftu', e);
         setError(t('inboundFormModal.errDraftLoad', 'Nie udało się załadować wersji roboczej.'));
      } finally {
         setLoading(false);
      }
    };
    loadDraft();
  }, [draftId, companyId]);

  // 2. Click outside logic for dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(e.target as Node)) {
        setActiveSearchRow(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 3. Debounced Search Effect
  useEffect(() => {
    if (!activeSearchRow || searchTerm.length < 2) {
      setSearchResults([]);
      return;
    }
    
    const timer = setTimeout(async () => {
      try {
        const term = searchTerm.toLowerCase();
        // Since we can't easily multi-field search in Firestore without vector/extra indexes, 
        // we fallback to prefix sku search or fetch recent. For a broad UX, we fetch 50 and filter locally by name/sku.
        const q = query(
          collection(db, `companies/${companyId}/products`),
          where('isActive', '==', true),
          limit(50)
        );
        const res = await getDocs(q);
        const products = res.docs.map(d => ({ ...d.data(), id: d.id, productId: d.id } as ProductV2));
        
        const filtered = products.filter(p => 
          (p.sku && p.sku.toLowerCase().includes(term)) || 
          (p.name && p.name.toLowerCase().includes(term)) ||
          (p.ean && p.ean.includes(term))
        );
        setSearchResults(filtered.slice(0, 10)); // max 10 results
      } catch (err) {
        console.error(err);
      }
    }, 400); // 400ms debounce
    
    return () => clearTimeout(timer);
  }, [searchTerm, activeSearchRow, companyId]);

  // --- Handlers ---
  const handleAddRow = () => {
    setItems(prev => [...prev, {
      id: crypto.randomUUID(),
      productId: null,
      sourceType: 'manual_product',
      name: '',
      sku: '',
      ean: '',
      expectedQty: 1,
      unit: 'szt.',
      length: 0,
      width: 0,
      height: 0,
      weight: 0
    }]);
  };

  const handleRemoveRow = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const handleRowChange = (id: string, field: keyof FormItem, value: any) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      
      const updatedItem = { ...item, [field]: value };
      
      // If user manually types a name, decouple from DB (it becomes a manual entry)
      if (field === 'name') {
        updatedItem.productId = null;
        updatedItem.sourceType = 'manual_product';
      }
      return updatedItem;
    }));

    if (field === 'name') {
      setSearchTerm(value);
      setActiveSearchRow(id);
    }
  };

  const selectProductForRow = (rowId: string, p: ProductV2) => {
    setItems(prev => prev.map(item => item.id === rowId ? {
      ...item,
      productId: p.productId,
      sourceType: 'catalog_product',
      name: p.name,
      sku: p.sku || '',
      ean: p.ean || '',
      weight: p.logistics?.weight || 0,
      length: p.logistics?.length || 0,
      width: p.logistics?.width || 0,
      height: p.logistics?.height || 0
    } : item));
    setActiveSearchRow(null);
  };

  const validateForm = () => {
    if (!destinationLocationId) return t('inboundFormModal.valDest', 'Wybierz adres docelowy (Magazyn).');
    if (!carrier) return t('inboundFormModal.valMethod', 'Wprowadź metodę dostawy / przewoźnika.');
    if (!plannedDeliveryDate) return t('inboundFormModal.valPlannedDate', 'Podaj planowaną datę wysyłki.');

    const todayStr = new Date().toISOString().split('T')[0];
    if (plannedDeliveryDate < todayStr) return t('inboundFormModal.valPastPlanned', 'Planowana data wysyłki nie może dotyczyć przeszłości i musi rozpoczynać się od dzisiaj.');
    if (etaDate && etaDate < todayStr) return t('inboundFormModal.valPastEta', 'Szacowana data dostawy (ETA) nie może dotyczyć przeszłości i musi rozpoczynać się od dzisiaj.');

    if (items.length === 0) return t('inboundFormModal.valNoItems', 'Dodaj przynajmniej jeden produkt do awizacji.');

    for (let i = 0; i < items.length; i++) {
       const row = items[i];
       if (!row.name || row.name.trim() === '') return t('inboundFormModal.valRowName', { num: i + 1, defaultValue: `Pozycja #${i+1}: Nazwa produktu jest wymagana.` });
       if (row.expectedQty <= 0) return t('inboundFormModal.valRowQty', { num: i + 1, defaultValue: `Pozycja #${i+1}: Ilość musi być większa niż zero.` });
       
       if (row.sourceType === 'manual_product') {
          if (row.weight <= 0 || row.length <= 0 || row.width <= 0 || row.height <= 0) {
            return t('inboundFormModal.valRowManualParams', { num: i + 1, defaultValue: `Pozycja #${i+1} (Ręczna): Wymiary i waga nie mogą być zerowe ani ujemne dla towarów spoza katalogu. Zmierz i wpisz prawidłowe dane.` });
          }
       } else {
          // It's catalog product. It's allowed to have zeros here (backend will fallback to DB),
          // but if they typed negative, block it.
          if (row.weight < 0 || row.length < 0 || row.width < 0 || row.height < 0) {
            return t('inboundFormModal.valRowParamsNeg', { num: i + 1, defaultValue: `Pozycja #${i+1}: Parametry logistyczne nie mogą być ujemne.` });
          }
       }
    }
    return "";
  };

  const submit = async (status: 'draft' | 'submitted') => {
    const errorMsg = validateForm();
    if (errorMsg) {
       setError(errorMsg);
       return;
    }
    
    setLoading(true);
    setError('');

    try {
      const createInboundShipmentCallable = httpsCallable(functions, 'createInboundShipment');
      const updateInboundShipmentCallable = httpsCallable(functions, 'updateInboundShipment');
      
      const payload: any = {
        companyId,
        destinationLocationId,
        carrier,
        trackingNumber,
        plannedDeliveryDate: new Date(plannedDeliveryDate).toISOString(),
        etaDate: etaDate ? new Date(etaDate).toISOString() : null,
        status,
        items: items.map(i => ({
          productId: i.productId,
          sourceType: i.sourceType,
          name: i.name,
          sku: i.sku,
          ean: i.ean,
          expectedQty: Number(i.expectedQty),
          unit: i.unit,
          length: Number(i.length),
          width: Number(i.width),
          height: Number(i.height),
          weight: Number(i.weight)
        }))
      };

      if (draftId) {
        payload.shipmentId = draftId;
        await updateInboundShipmentCallable(payload);
      } else {
        await createInboundShipmentCallable(payload);
      }
      onClose();
    } catch (err: any) {
      console.error('Błąd zapisu awizacji:', err);
      setError(err.message || t('inboundFormModal.errUnexpected', 'Wystąpił nieoczekiwany błąd serwera.'));
      setLoading(false);
    }
  };

  // --- Aggregates ---
  const { totalQty, totalWeight, totalVolume } = useMemo(() => {
     let qty = 0, weight = 0, vol = 0;
     items.forEach(i => {
       const q = Number(i.expectedQty) || 0;
       qty += q;
       weight += (Number(i.weight) || 0) * q;
       
       const l = Number(i.length) || 0;
       const w = Number(i.width) || 0;
       const h = Number(i.height) || 0;
       vol += ((l * w * h) / 1000000) * q;
     });
     return { totalQty: qty, totalWeight: weight, totalVolume: vol };
  }, [items]);

  const activeLoc = availableWarehouses.find(l => l.id === destinationLocationId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-md">
      <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-7xl max-h-[92vh] flex flex-col overflow-hidden animate-fade-in-up">
        
        {/* Header Ribbon */}
        <div className="flex items-start justify-between p-6 pb-2">
          <div>
            <h2 className="text-2xl font-black italic tracking-wide text-gray-900 uppercase">
              {t('inboundFormModal.title', 'Formularz Zgłoszenia Awizacji')}
            </h2>
            <p className="text-xs text-gray-500 font-bold tracking-widest uppercase mt-1 flex items-center gap-2">
              {t('inboundFormModal.destination', 'ADRES DOCELOWY:')}
              <select 
                value={destinationLocationId}
                onChange={e => setDestinationLocationId(e.target.value)}
                className="bg-gray-100 text-[#0A3D91] p-1.5 px-2 rounded-lg font-bold border-none outline-none cursor-pointer hover:bg-gray-200 transition-colors"
                disabled={availableWarehouses.length === 0}
              >
                {availableWarehouses.length === 0 && <option value="">{t('inboundFormModal.noWarehouses', 'Brak magazynów / Brak autoryzacji')}</option>}
                {availableWarehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name} – {w.address.postalCode} {w.address.city}, {w.address.country}</option>
                ))}
              </select>
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors">
            <span className="material-symbols-outlined hover:rotate-90 transition-transform">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6 scrollbar-hide">
           {error && (
             <div className="mb-4 bg-red-50 text-red-700 border-l-4 border-red-500 p-4 rounded-r-xl text-sm font-bold flex items-center gap-2">
               <span className="material-symbols-outlined text-xl">error</span>
               {error}
             </div>
           )}

           {/* Top Grid Info */}
           <div className="grid grid-cols-1 md:grid-cols-4 gap-6 my-6">
              <div>
                 <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{t('inboundFormModal.deliveryMethod', 'Metoda Dostawy *')}</label>
                 <select 
                   value={carrier} 
                   onChange={e => setCarrier(e.target.value)}
                   className="w-full bg-white border border-gray-300 text-gray-900 text-sm font-bold rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-3 min-h-[46px] shadow-sm appearance-none outline-none"
                 >
                   <option value="" disabled>{t('inboundFormModal.selectCarrier', 'Wybierz przewoźnika')}</option>
                   <option value="Kurier DPD">{t('inboundFormModal.carrierDPD', 'Kurier DPD')}</option>
                   <option value="Kurier DHL">{t('inboundFormModal.carrierDHL', 'Kurier DHL')}</option>
                   <option value="Kurier InPost">{t('inboundFormModal.carrierInPost', 'Kurier InPost')}</option>
                   <option value="Dostawa Własna">{t('inboundFormModal.carrierOwn', 'Dostawa Własna / Spedycja')}</option>
                   <option value="Inny">{t('inboundFormModal.carrierOther', 'Inna')}</option>
                 </select>
              </div>
              <div>
                 <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{t('inboundFormModal.trackingNumber', 'Nr listu przewozowego / Tracking')}</label>
                 <input 
                   type="text" 
                   value={trackingNumber} 
                   onChange={e => setTrackingNumber(e.target.value)}
                   placeholder={t('inboundFormModal.enterNumber', 'Wpisz numer')}
                   className="w-full bg-white border border-gray-300 text-gray-900 text-sm font-bold rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-3 min-h-[46px] shadow-sm outline-none"
                 />
              </div>
              <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{t('inboundFormModal.plannedDate', 'Planowana Data Wysyłki *')}</label>
                 <input 
                   type="date" 
                   value={plannedDeliveryDate} 
                   onChange={e => setPlannedDeliveryDate(e.target.value)}
                   min={new Date().toISOString().split('T')[0]}
                   className="w-full bg-white border border-gray-300 text-gray-900 text-sm font-bold rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-3 min-h-[46px] shadow-sm outline-none"
                 />
              </div>
              <div>
                 <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{t('inboundFormModal.etaDate', 'Szacowana Data Dostawy (ETA)')}</label>
                 <input 
                   type="date" 
                   value={etaDate} 
                   onChange={e => setEtaDate(e.target.value)}
                   min={new Date().toISOString().split('T')[0]}
                   className="w-full bg-white border border-gray-300 text-gray-900 text-sm font-bold rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-3 min-h-[46px] shadow-sm outline-none"
                 />
              </div>
           </div>

           {/* Items Table Section */}
           <div className="mt-8">
              <div className="flex justify-between items-end mb-4 relative">
                 <h3 className="text-sm font-black italic tracking-wider text-gray-900 uppercase flex items-center gap-2">
                    {t('inboundFormModal.productList', 'Lista Produktów (Zawartość)')}
                 </h3>
                 <button 
                   onClick={handleAddRow}
                   className="text-[12px] font-bold uppercase tracking-widest text-[#0A3D91] hover:text-[#083075] flex items-center gap-1.5 border border-[#0A3D91]/20 hover:border-[#0A3D91]/40 px-4 py-2 rounded-full transition-all"
                 >
                   <span className="material-symbols-outlined text-[16px]">add</span>
                   {t('inboundFormModal.addItem', 'Dodaj Pozycję')}
                 </button>
              </div>

              <div className="border border-gray-200 rounded-xl shadow-sm relative z-20">
                <div className="w-full">
                   <table className="w-full text-left bg-white whitespace-nowrap rounded-xl">
                     <thead className="bg-[#F8FAFC]">
                       <tr>
                         <th className="py-4 px-4 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b min-w-[250px]">{t('inboundFormModal.colProductName', 'Nazwa Produktu *')}</th>
                         <th className="py-4 px-3 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b w-[120px]">{t('inboundFormModal.colSku', 'SKU')}</th>
                         <th className="py-4 px-3 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b w-[120px]">{t('inboundFormModal.colEan', 'EAN')}</th>
                         <th className="py-4 px-3 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b w-[80px]">{t('inboundFormModal.colQty', 'Ilość *')}</th>
                         <th className="py-4 px-3 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b w-[60px]">{t('inboundFormModal.colUnit', 'J.M.')}</th>
                         <th className="py-4 px-3 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b w-[70px]">{t('inboundFormModal.colLength', 'Dł. (cm)')}</th>
                         <th className="py-4 px-3 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b w-[70px]">{t('inboundFormModal.colWidth', 'Szer. (cm)')}</th>
                         <th className="py-4 px-3 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b w-[70px]">{t('inboundFormModal.colHeight', 'Wys. (cm)')}</th>
                         <th className="py-4 px-3 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b w-[70px]">{t('inboundFormModal.colWeight', 'Waga (kg)')}</th>
                         <th className="py-4 px-4 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b w-12 text-center">{t('inboundFormModal.colDelete', 'Usuń')}</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-100 relative">
                        {items.length === 0 ? (
                           <tr>
                              <td colSpan={10} className="p-12 text-center text-gray-400">
                                 <span className="material-symbols-outlined text-4xl mb-2 opacity-50">shopping_cart_checkout</span>
                                 <p className="text-sm font-bold uppercase tracking-widest mt-2 text-gray-500">{t('inboundFormModal.emptyListTitle', 'Brak pozycji w awizacji')}</p>
                                 <p className="text-xs text-gray-400 mt-1">{t('inboundFormModal.emptyListDesc', 'Kliknij "Dodaj Pozycję", aby rozpocząć rejestrację asortymentu.')}</p>
                              </td>
                           </tr>
                        ) : items.map((item, idx) => (
                          <tr key={item.id} className="hover:bg-blue-50/30 transition-colors group relative">
                             {/* NAZWA PRODUKTU (Z AUTOCOMPLETE) */}
                             <td className="p-3 relative">
                                <div className="relative">
                                  <input 
                                    type="text"
                                    value={item.name}
                                    onChange={e => handleRowChange(item.id, 'name', e.target.value)}
                                    placeholder={t('inboundFormModal.searchPlaceholder', 'Wyszukaj lub wpisz nazwę...')}
                                    className={`w-full bg-gray-50/50 border ${item.sourceType === 'catalog_product' ? 'border-blue-200 text-blue-900' : 'border-gray-200 text-gray-900'} text-xs font-bold rounded-md px-3 py-2 outline-none focus:ring-1 focus:ring-blue-500`}
                                  />
                                  {item.sourceType === 'catalog_product' && (
                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 material-symbols-outlined text-blue-500 text-[14px]">verified</span>
                                  )}
                                </div>

                                {/* DROPDOWN AUTOSUGGEST (Wyświetlany tylko dla aktywnego wiersza) */}
                                {activeSearchRow === item.id && searchResults.length > 0 && (
                                  <div ref={searchDropdownRef} className="absolute left-3 top-[44px] w-[400px] bg-white border border-blue-100 shadow-2xl rounded-xl z-50 overflow-hidden divide-y divide-gray-50 max-h-60 overflow-y-auto">
                                     <div className="bg-blue-50 px-3 py-2 text-[10px] font-bold text-blue-800 uppercase tracking-widest">
                                       {t('inboundFormModal.systemSuggestions', 'Podpowiedzi z systemu')}
                                     </div>
                                     {searchResults.map(p => (
                                        <div 
                                          key={p.productId} 
                                          onClick={() => selectProductForRow(item.id, p)}
                                          className="p-3 hover:bg-[#F8FAFC] cursor-pointer flex justify-between items-center group/item"
                                        >
                                           <div className="truncate pr-4">
                                              <p className="text-xs font-bold text-gray-900 group-hover/item:text-blue-600 truncate">{p.name}</p>
                                              <p className="text-[10px] font-mono text-gray-500 mt-0.5">SKU: {p.sku || '-'} | EAN: {p.ean || '-'}</p>
                                           </div>
                                           <div className="text-right shrink-0">
                                              <p className="text-[10px] font-bold text-gray-400 bg-white border px-1.5 py-0.5 rounded">{p.logistics?.weight || 0} kg</p>
                                           </div>
                                        </div>
                                     ))}
                                  </div>
                                )}
                             </td>

                             {/* SKU */}
                             <td className="p-3">
                               <input type="text" value={item.sku} onChange={e => handleRowChange(item.id, 'sku', e.target.value)} className="w-full bg-white border border-gray-200 text-gray-800 font-mono text-xs rounded-md px-2 py-2 outline-none focus:border-blue-500" placeholder="-" />
                             </td>
                             
                             {/* EAN */}
                             <td className="p-3">
                               <input type="text" value={item.ean} onChange={e => handleRowChange(item.id, 'ean', e.target.value)} className="w-full bg-white border border-gray-200 text-gray-800 font-mono text-xs rounded-md px-2 py-2 outline-none focus:border-blue-500 text-blue-600" placeholder="-" />
                             </td>

                             {/* ILOŚĆ */}
                             <td className="p-3">
                               <input type="number" min="1" value={item.expectedQty || ''} onChange={e => handleRowChange(item.id, 'expectedQty', parseInt(e.target.value) || 0)} className="w-full bg-white border border-gray-300 text-gray-900 text-xs font-black text-center rounded-md px-2 py-2 outline-none focus:ring-1 focus:ring-blue-500" />
                             </td>

                             {/* J.M. */}
                             <td className="p-3">
                               <input type="text" value={item.unit} readOnly className="w-full bg-transparent border-transparent text-gray-500 text-xs font-bold text-center outline-none cursor-default" />
                             </td>

                             {/* DL, SZER, WYS, WAGA */}
                             <td className="p-3">
                               <input type="number" min="0" step="any" value={item.length || ''} onChange={e => handleRowChange(item.id, 'length', e.target.value)} className={`w-full bg-white border border-gray-200 text-gray-900 text-xs font-bold text-center rounded-md px-1 py-2 outline-none focus:ring-1 focus:ring-amber-500 ${item.sourceType === 'manual_product' && !item.length ? 'ring-1 ring-red-400 bg-red-50' : ''}`} placeholder="0" />
                             </td>
                             <td className="p-3">
                               <input type="number" min="0" step="any" value={item.width || ''} onChange={e => handleRowChange(item.id, 'width', e.target.value)} className={`w-full bg-white border border-gray-200 text-gray-900 text-xs font-bold text-center rounded-md px-1 py-2 outline-none focus:ring-1 focus:ring-amber-500 ${item.sourceType === 'manual_product' && !item.width ? 'ring-1 ring-red-400 bg-red-50' : ''}`} placeholder="0" />
                             </td>
                             <td className="p-3">
                               <input type="number" min="0" step="any" value={item.height || ''} onChange={e => handleRowChange(item.id, 'height', e.target.value)} className={`w-full bg-white border border-gray-200 text-gray-900 text-xs font-bold text-center rounded-md px-1 py-2 outline-none focus:ring-1 focus:ring-amber-500 ${item.sourceType === 'manual_product' && !item.height ? 'ring-1 ring-red-400 bg-red-50' : ''}`} placeholder="0" />
                             </td>
                             <td className="p-3">
                               <input type="number" min="0" step="any" value={item.weight || ''} onChange={e => handleRowChange(item.id, 'weight', e.target.value)} className={`w-full bg-amber-50 border border-amber-200 text-amber-900 text-xs font-black text-center rounded-md px-1 py-2 outline-none focus:ring-1 focus:ring-amber-500 ${item.sourceType === 'manual_product' && !item.weight ? 'ring-2 ring-red-400 bg-red-100' : ''}`} placeholder="0" />
                             </td>

                             {/* USUN */}
                             <td className="p-3 text-center">
                               <button onClick={() => handleRemoveRow(item.id)} className="text-red-300 hover:text-red-600 bg-red-50 hover:bg-red-100 p-1.5 rounded-md transition-colors">
                                 <span className="material-symbols-outlined text-[16px] block">delete</span>
                               </button>
                             </td>
                          </tr>
                        ))}
                     </tbody>
                   </table>
                </div>
              </div>
           </div>

           {/* Information Banner */}
           <div className="mt-6 bg-orange-50 border border-orange-200 rounded-xl p-4 flex gap-4 items-start shadow-sm">
              <span className="material-symbols-outlined text-orange-500 mt-0.5">info</span>
              <div>
                 <h4 className="text-sm font-bold text-orange-900">{t('inboundFormModal.importantInfo', 'Ważna Informacja')}</h4>
                 <p className="text-xs text-orange-800 mt-1 leading-relaxed">
                   {t('inboundFormModal.infoText1', 'Wybierz ')}<strong>{t('inboundFormModal.infoText2', 'Wersja robocza')}</strong>{t('inboundFormModal.infoText3', ', aby móc uzupełniać tę listę w wolniejszej chwili. ')}<span className="font-bold text-red-600">{t('inboundFormModal.infoText4', "Uwaga: Jeśli klikniesz 'Zgłoś Dostawę', awizacja zostanie nieodwracalnie przesłana na Magazyn - zablokuje to możliwość jej powrotnej edycji po stronie Klienta!")}</span>
                 </p>
              </div>
           </div>

        </div>

        {/* Footer Area */}
        <div className="border-t border-gray-200 bg-white p-5 shrink-0 flex items-center justify-between">
            <button 
              type="button" 
              onClick={onClose}
              disabled={loading}
              className="px-6 py-3 bg-white border border-gray-300 rounded-xl font-bold text-gray-700 hover:bg-gray-50 text-sm shadow-sm transition-colors disabled:opacity-50"
            >
              {t('inboundFormModal.cancel', 'Anuluj')}
            </button>
            
            <div className="flex items-center gap-6 px-8 flex-1 justify-center divide-x divide-gray-200">
               <div className="px-6 text-center">
                  <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-1">{t('inboundFormModal.totalVolume', 'Suma Objętości')}</p>
                  <p className="text-lg font-black text-blue-700">{totalVolume.toFixed(4)} <span className="text-xs text-gray-500">m³</span></p>
               </div>
               <div className="px-6 text-center">
                  <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-1">{t('inboundFormModal.totalWeight', 'Suma Wagi')}</p>
                  <p className="text-lg font-black text-amber-600">{totalWeight.toFixed(2)} <span className="text-xs text-amber-600/60">kg</span></p>
               </div>
               <div className="px-6 text-center">
                  <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-1">{t('inboundFormModal.totalQty', 'Sztuki')}</p>
                  <p className="text-lg font-black text-gray-900">{totalQty} <span className="text-xs text-gray-500">{t('inboundFormModal.unitPieces', 'szt.')}</span></p>
               </div>
            </div>

            <div className="flex items-center gap-3">
              <button 
                onClick={() => submit('draft')}
                disabled={loading || items.length === 0}
                className="px-6 py-3 bg-amber-400 text-amber-950 rounded-xl font-black uppercase tracking-widest hover:bg-amber-500 transition-colors shadow-[0_2px_10px_rgba(251,191,36,0.2)] disabled:opacity-50 text-[12px] flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">draft</span>
                {t('inboundFormModal.btnDraft', 'Wersja Robocza')}
              </button>
              <button 
                onClick={() => submit('submitted')}
                disabled={loading || items.length === 0}
                className="px-8 py-3 bg-[#0A3D91] border border-transparent text-white rounded-xl font-black uppercase tracking-widest hover:bg-[#083075] transition-colors disabled:opacity-50 flex items-center gap-2 text-[12px] shadow-[0_2px_15px_rgba(10,61,145,0.4)]"
              >
                {loading ? <span className="material-symbols-outlined animate-spin text-[20px]">refresh</span> : <span className="material-symbols-outlined text-[20px]">send</span>}
                {t('inboundFormModal.btnSubmit', 'Zgłoś Dostawę')}
              </button>
            </div>
        </div>

      </div>
    </div>
  );
}
