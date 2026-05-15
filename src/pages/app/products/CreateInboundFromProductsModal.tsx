import React, { useState, useEffect } from 'react';
import { db, functions } from '../../../firebase/config';
import { httpsCallable } from 'firebase/functions';
import type { ProductV2 } from '../../../data/products';
import { getGlobalWarehouses, getCompanyWarehouseAccess } from '../../../data/warehouses';
import type { GlobalWarehouse, CompanyWarehouseAccess } from '../../../data/warehouses';
import { useTranslation } from 'react-i18next';

interface Props {
  companyId: string;
  selectedProducts: ProductV2[];
  onClose: (clearSelection?: boolean) => void;
}

interface ItemRow {
  productId: string;
  sku: string;
  ean: string;
  name: string;
  qty: number;
  weight: number;
  length: number;
  width: number;
  height: number;
  volume: number;
}

export default function CreateInboundFromProductsModal({ companyId, selectedProducts, onClose }: Props) {
  const { t } = useTranslation();
  const [deliveryMethod, setDeliveryMethod] = useState(t('createInboundModal.methods.dhl', 'Kurier DHL'));
  const [trackingNumber, setTrackingNumber] = useState('');
  const [plannedDeliveryDate, setPlannedDeliveryDate] = useState('');
  const [etaDate, setEtaDate] = useState('');
  
  const [availableWarehouses, setAvailableWarehouses] = useState<GlobalWarehouse[]>([]);
  const [destinationLocationId, setDestinationLocationId] = useState('');
  
  const [items, setItems] = useState<ItemRow[]>(() => {
    return selectedProducts.map(p => {
      const l = p.logistics?.length || 0;
      const w = p.logistics?.width || 0;
      const h = p.logistics?.height || 0;
      const calculatedVolume = (l > 0 && w > 0 && h > 0) ? (l * w * h) / 1000000 : 0;
      
      return {
        productId: p.productId,
        sku: p.sku || '-',
        ean: p.ean || '-',
        name: p.name || 'Brak nazwy',
        qty: 1, // Domyślnie 1
        weight: p.logistics?.weight || 0,
        length: l,
        width:  w,
        height: h,
        volume: p.logistics?.volume || calculatedVolume
      };
    });
  });

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

  const removeItem = (productId: string) => {
    setItems(prev => prev.filter(i => i.productId !== productId));
  };

  const updateQty = (productId: string, val: number) => {
    setItems(prev => prev.map(i => i.productId === productId ? { ...i, qty: val < 1 ? 1 : val } : i));
  };

  const submit = async (status: 'draft' | 'submitted') => {
    if (items.length === 0) return setError(t('createInboundModal.errors.addOneItem', 'Dodaj przynajmniej jeden produkt do awizacji'));
    if (!plannedDeliveryDate) return setError(t('createInboundModal.errors.plannedDateReq', 'Podaj planowaną datę wysyłki'));
    if (!destinationLocationId) return setError(t('createInboundModal.errors.destinationReq', 'Wybierz logistyczny magazyn docelowy'));
    
    setLoading(true);
    setError('');

    try {
      const createInboundShipmentCallable = httpsCallable(functions, 'createInboundShipment');
      
      const payload = {
        companyId,
        destinationLocationId,
        carrier: deliveryMethod, // Mapowanie: backend oczekuje carrier
        trackingNumber,
        plannedDeliveryDate: new Date(plannedDeliveryDate).toISOString(),
        etaDate: etaDate ? new Date(etaDate).toISOString() : null,
        status,
        items: items.map(i => ({
          productId: i.productId,
          sourceType: 'catalog_product',
          name: i.name,
          sku: i.sku,
          ean: i.ean,
          expectedQty: i.qty,
          unit: 'szt.',
          length: i.length,
          width: i.width,
          height: i.height,
          weight: i.weight
        }))
      };

      await createInboundShipmentCallable(payload);
      
      onClose(true); // Zamknij modal i wyczyść zaznaczenie w tabeli po udanym zapisie
    } catch (err: any) {
      console.error('Błąd podczas zapisu awizacji:', err);
      // Obsługa błędu HttpsError
      const backendMessage = err?.details?.message || err.message;
      if (backendMessage.includes('Brak autoryzacji')) setError(t('createInboundModal.errors.noAuth', 'Brak autoryzacji do wybranego magazynu dla tej firmy.'));
      else setError(backendMessage || t('createInboundModal.errors.defaultError', 'Wystąpił błąd podczas tworzenia awizacji. Spróbuj ponownie.'));
      setLoading(false);
    }
  };

  const totalExpectedM3 = items.reduce((sum, item) => sum + (item.volume * item.qty), 0);
  const totalExpectedKg = items.reduce((sum, item) => sum + (item.weight * item.qty), 0);
  const totalItemsCount = items.reduce((sum, item) => sum + item.qty, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-[1200px] my-auto flex flex-col overflow-hidden animate-fade-in-up">
        
        {/* Tytuł modala */}
        <div className="px-8 py-6 border-b border-gray-100 flex justify-between items-start">
          <div>
            <h2 className="text-[20px] font-black italic tracking-wide text-[#1A202C] uppercase flex items-center gap-2">
              {t('createInboundModal.title', 'FORMULARZ ZGŁOSZENIA AWIZACJI')}
            </h2>
            <p className="text-[12px] text-gray-500 font-bold uppercase mt-1 flex items-center gap-2">
              {t('createInboundModal.destinationAddress', 'ADRES DOCELOWY:')}
              <select 
                value={destinationLocationId}
                onChange={e => setDestinationLocationId(e.target.value)}
                className="bg-gray-100 text-[#0A3D91] p-1.5 px-2 rounded-lg font-bold border-none outline-none cursor-pointer hover:bg-gray-200 transition-colors"
                disabled={availableWarehouses.length === 0}
              >
                {availableWarehouses.length === 0 && <option value="">{t('createInboundModal.noWarehouses', 'Brak magazynów / Brak autoryzacji')}</option>}
                {availableWarehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name} ({w.code}) • {w.address.city}</option>
                ))}
              </select>
            </p>
          </div>
          <button onClick={() => onClose(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
            <span className="material-symbols-outlined text-[24px]">close</span>
          </button>
        </div>

        {/* Ciało */}
        <div className="p-8 space-y-8 bg-gray-50/30 overflow-y-auto max-h-[calc(100vh-[200px])]">
          
          {error && (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm font-medium flex items-center gap-2">
              <span className="material-symbols-outlined">error</span>
              {error}
            </div>
          )}

          {/* Sekcja Metody Dostawy */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div>
              <label className="block text-[11px] font-bold text-gray-500 tracking-wider uppercase mb-2">{t('createInboundModal.deliveryMethod', 'METODA DOSTAWY *')}</label>
              <select 
                value={deliveryMethod}
                onChange={e => setDeliveryMethod(e.target.value)}
                className="w-full bg-white border border-gray-200 text-[#0A3D91] text-[14px] font-bold rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block p-3 shadow-sm outline-none transition-shadow h-[46px]"
              >
                <option value={t('createInboundModal.methods.dhl', 'Kurier DHL')}>{t('createInboundModal.methods.dhl', 'Kurier DHL')}</option>
                <option value={t('createInboundModal.methods.dpd', 'Kurier DPD')}>{t('createInboundModal.methods.dpd', 'Kurier DPD')}</option>
                <option value={t('createInboundModal.methods.inpost', 'Kurier InPost')}>{t('createInboundModal.methods.inpost', 'Kurier InPost')}</option>
                <option value={t('createInboundModal.methods.own', 'Własny transport')}>{t('createInboundModal.methods.own', 'Własny transport')}</option>
                <option value={t('createInboundModal.methods.supplier', 'Dostawa od dostawcy')}>{t('createInboundModal.methods.supplier', 'Dostawa od dostawcy')}</option>
                <option value={t('createInboundModal.methods.palette', 'Paleta / spedycja')}>{t('createInboundModal.methods.palette', 'Paleta / spedycja')}</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-500 tracking-wider uppercase mb-2">{t('createInboundModal.tracking', 'NR LISTU PRZEWOZOWEGO / TRACKING')}</label>
              <input 
                type="text" 
                placeholder={t('createInboundModal.trackingPlaceholder', 'Wpisz numer')}
                value={trackingNumber}
                onChange={e => setTrackingNumber(e.target.value)}
                className="w-full bg-white border border-gray-200 text-gray-900 text-[14px] font-medium rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block p-3 shadow-sm outline-none transition-shadow h-[46px]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-500 tracking-wider uppercase mb-2">{t('createInboundModal.plannedDate', 'PLANOWANA DATA WYSYŁKI *')}</label>
              <input 
                type="date"
                value={plannedDeliveryDate}
                onChange={e => setPlannedDeliveryDate(e.target.value)}
                className="w-full bg-white border border-gray-200 text-gray-900 text-[14px] font-medium rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block p-3 shadow-sm outline-none transition-shadow h-[46px]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-500 tracking-wider uppercase mb-2">{t('createInboundModal.etaDate', 'SZACOWANA DATA DOSTAWY (ETA)')}</label>
              <input 
                type="date"
                value={etaDate}
                onChange={e => setEtaDate(e.target.value)}
                className="w-full bg-white border border-gray-200 text-gray-900 text-[14px] font-medium rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 block p-3 shadow-sm outline-none transition-shadow h-[46px]"
              />
            </div>
          </div>

          {/* Sekcja Tabeli Produktów */}
          <div>
            <div className="flex justify-between items-end mb-4">
              <h3 className="text-[14px] font-black text-[#1A202C] uppercase tracking-widest">
                {t('createInboundModal.table.title', 'LISTA PRODUKTÓW (ZAWARTOŚĆ)')}
              </h3>
              <button disabled className="text-[#0A3D91] font-bold text-[13px] flex items-center leading-none hover:underline opacity-50 cursor-not-allowed border border-[#0A3D91]/20 px-3 py-1.5 rounded-full">
                <span className="material-symbols-outlined text-[18px] mr-1">add</span>
                {t('createInboundModal.table.addItem', 'Dodaj Pozycję')}
              </button>
            </div>
            
            <div className="w-full bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden border-b-0">
               <div className="max-h-[350px] overflow-y-auto w-full">
                 <table className="w-full text-left border-collapse min-w-[900px]">
                   <thead className="bg-[#F8FAFC] sticky top-0 z-10 border-b border-gray-200 shadow-sm">
                     <tr>
                       <th className="py-3 px-6 text-[10px] items-center font-bold text-gray-500 uppercase tracking-wider border-r border-gray-200/50">{t('createInboundModal.table.productName', 'NAZWA PRODUKTU *')}</th>
                       <th className="py-3 px-4 text-[10px] items-center font-bold text-gray-500 uppercase tracking-wider w-[140px] border-r border-gray-200/50">{t('createInboundModal.table.sku', 'SKU')}</th>
                       <th className="py-3 px-4 text-[10px] items-center font-bold text-gray-500 uppercase tracking-wider w-[120px] border-r border-gray-200/50">{t('createInboundModal.table.ean', 'EAN')}</th>
                       <th className="py-3 px-4 text-[10px] items-center font-bold text-gray-500 uppercase tracking-wider w-[100px] text-center border-r border-gray-200/50">{t('createInboundModal.table.qty', 'ILOŚĆ *')}</th>
                       <th className="py-3 px-2 text-[10px] items-center font-bold text-gray-500 uppercase tracking-wider text-center w-[50px] border-r border-gray-200/50">{t('createInboundModal.table.unit', 'J.M.')}</th>
                       <th className="py-3 px-2 text-[10px] items-center font-bold text-gray-500 uppercase tracking-wider text-center w-[60px] border-r border-gray-200/50">{t('createInboundModal.table.length', 'DŁ.')}<br/><span className="text-[8px]">{t('createInboundModal.table.cm', '(CM)')}</span></th>
                       <th className="py-3 px-2 text-[10px] items-center font-bold text-gray-500 uppercase tracking-wider text-center w-[60px] border-r border-gray-200/50">{t('createInboundModal.table.width', 'SZER.')}<br/><span className="text-[8px]">{t('createInboundModal.table.cm', '(CM)')}</span></th>
                       <th className="py-3 px-2 text-[10px] items-center font-bold text-gray-500 uppercase tracking-wider text-center w-[60px] border-r border-gray-200/50">{t('createInboundModal.table.height', 'WYS.')}<br/><span className="text-[8px]">{t('createInboundModal.table.cm', '(CM)')}</span></th>
                       <th className="py-3 px-2 text-[10px] items-center font-bold text-gray-500 uppercase tracking-wider text-center w-[70px] border-r border-gray-200/50">{t('createInboundModal.table.weight', 'WAGA')}<br/><span className="text-[8px]">{t('createInboundModal.table.kg', '(KG)')}</span></th>
                       <th className="py-3 px-6 text-[10px] items-center font-bold text-gray-500 uppercase tracking-wider text-center w-[60px]">{t('createInboundModal.table.delete', 'USUŃ')}</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-gray-100/50">
                     {items.length === 0 ? (
                       <tr>
                         <td colSpan={10} className="py-8 text-center text-gray-400 text-sm font-medium">
                           {t('createInboundModal.table.empty', 'Brak produktów (Wszystkie pozycje usunięto)')}
                         </td>
                       </tr>
                     ) : (
                       items.map(item => (
                         <tr key={item.productId} className="hover:bg-blue-50/20 transition-colors border-b border-gray-100">
                           <td className="py-4 px-6 text-[13px] font-medium text-gray-900 border-r border-gray-100 max-w-[250px] truncate" title={item.name}>{item.name}</td>
                           <td className="py-4 px-4 text-[12px] font-bold text-gray-600 border-r border-gray-100 truncate font-mono tracking-tight">{item.sku}</td>
                           <td className="py-4 px-4 text-[12px] font-bold text-blue-400 border-r border-gray-100 truncate tracking-tighter mix-blend-multiply">{item.ean}</td>
                           <td className="py-2.5 px-4 border-r border-gray-100 text-center">
                             <input 
                               type="number" 
                               min={1}
                               value={item.qty}
                               onChange={(e) => updateQty(item.productId, parseInt(e.target.value) || 1)}
                               className="w-[60px] mx-auto text-center bg-white border border-gray-300 rounded-lg text-sm font-bold text-[#0A3D91] py-1.5 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm"
                             />
                           </td>
                           <td className="py-4 px-2 text-[12px] font-bold text-gray-400 text-center border-r border-gray-100">szt.</td>
                           <td className="py-4 px-2 text-[12px] font-bold text-[#0A3D91] bg-gray-50/50 text-center border-r border-gray-100">{item.length}</td>
                           <td className="py-4 px-2 text-[12px] font-bold text-[#0A3D91] bg-gray-50/50 text-center border-r border-gray-100">{item.width}</td>
                           <td className="py-4 px-2 text-[12px] font-bold text-[#0A3D91] bg-gray-50/50 text-center border-r border-gray-100">{item.height}</td>
                           <td className="py-4 px-2 text-[12px] font-bold text-[#E85D04] bg-orange-50/30 text-center border-r border-gray-100">{item.weight}</td>
                           <td className="py-4 px-6 text-center">
                             <button onClick={() => removeItem(item.productId)} className="text-red-300 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors flex items-center justify-center w-full">
                               <span className="material-symbols-outlined text-[18px]">delete</span>
                             </button>
                           </td>
                         </tr>
                       ))
                     )}
                   </tbody>
                 </table>
               </div>
            </div>
            

          </div>
          
        </div>

        {/* Pasek Przycisków */}
        <div className="px-8 py-5 border-t border-gray-100 bg-gray-50 flex justify-between items-center rounded-b-[24px]">
          <div className="flex items-center gap-6">
            <button 
              onClick={() => onClose(false)}
              className="px-6 py-2.5 text-[14px] font-bold text-gray-600 bg-white border border-gray-300 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
              disabled={loading}
            >
              {t('createInboundModal.buttons.cancel', 'Anuluj')}
            </button>
            <div className="hidden sm:flex items-center gap-4 border-l border-gray-300 pl-6">
               <div className="flex flex-col">
                 <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('createInboundModal.summary.volume', 'Suma objętości')}</span>
                 <span className="text-[15px] font-black text-[#0A3D91]">{totalExpectedM3.toFixed(4)} <span className="text-[12px] text-gray-500 font-bold">m³</span></span>
               </div>
               <div className="flex flex-col">
                 <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('createInboundModal.summary.weight', 'Suma wagi')}</span>
                 <span className="text-[15px] font-black text-[#E85D04]">{totalExpectedKg.toFixed(2)} <span className="text-[12px] text-gray-500 font-bold">kg</span></span>
               </div>
               <div className="flex flex-col">
                 <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('createInboundModal.summary.items', 'Sztuki')}</span>
                 <span className="text-[15px] font-black text-gray-800">{totalItemsCount} <span className="text-[12px] text-gray-500 font-bold">szt.</span></span>
               </div>
            </div>
          </div>
          <div className="flex gap-4">

            <button 
              onClick={() => submit('submitted')}
              className="px-6 py-2.5 text-[14px] font-bold text-white bg-[#0A3D91] hover:bg-[#083075] rounded-xl transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center min-w-[160px]"
              disabled={loading || items.length === 0}
            >
              {loading ? (
                <span className="material-symbols-outlined animate-spin text-[18px] mr-2">sync</span>
              ) : (
                <span className="material-symbols-outlined text-[18px] mr-2">send</span>
              )}
              {loading ? t('createInboundModal.buttons.processing', 'Przetwarzanie...') : t('createInboundModal.buttons.submit', 'Zgłoś Dostawę')}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
