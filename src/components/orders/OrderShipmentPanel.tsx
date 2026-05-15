import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, where, documentId } from 'firebase/firestore';
import { db, functions } from '../../firebase/config';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';

const alpha2CountryMap: Record<string, string> = {
  'DE': 'DE', 'DEU': 'DE', 'Deutschland': 'DE', 'Germany': 'DE', 'Niemcy': 'DE', 'Niemiec': 'DE',
  'PL': 'PL', 'POL': 'PL', 'Polska': 'PL', 'Poland': 'PL',
  'AT': 'AT', 'AUT': 'AT', 'Austria': 'AT',
  'CH': 'CH', 'CHE': 'CH', 'Schweiz': 'CH', 'Switzerland': 'CH', 'Szwajcaria': 'CH',
  'FR': 'FR', 'FRA': 'FR', 'France': 'FR', 'Frankreich': 'FR', 'Francja': 'FR',
  'NL': 'NL', 'NLD': 'NL', 'Netherlands': 'NL', 'Holandia': 'NL',
  'BE': 'BE', 'BEL': 'BE', 'Belgium': 'BE', 'Belgia': 'BE',
  'CZ': 'CZ', 'CZE': 'CZ', 'Czech': 'CZ', 'Czechy': 'CZ',
  'GB': 'GB', 'GBR': 'GB', 'UK': 'GB', 'United Kingdom': 'GB', 'Wielka Brytania': 'GB',
  'IT': 'IT', 'ITA': 'IT', 'Italy': 'IT', 'Italien': 'IT', 'Włochy': 'IT',
  'ES': 'ES', 'ESP': 'ES', 'Spain': 'ES', 'Spanien': 'ES', 'Hiszpania': 'ES',
  'SE': 'SE', 'SWE': 'SE', 'Sweden': 'SE', 'Szwecja': 'SE',
  'DK': 'DK', 'DNK': 'DK', 'Denmark': 'DK', 'Dania': 'DK',
  'NO': 'NO', 'NOR': 'NO', 'Norway': 'NO', 'Norwegia': 'NO',
  'RO': 'RO', 'ROU': 'RO', 'Romania': 'RO', 'Rumunia': 'RO',
  'HU': 'HU', 'HUN': 'HU', 'Hungary': 'HU', 'Węgry': 'HU',
  'SK': 'SK', 'SVK': 'SK', 'Slovakia': 'SK', 'Słowacja': 'SK',
  'HR': 'HR', 'HRV': 'HR', 'Croatia': 'HR', 'Chorwacja': 'HR',
  'US': 'US', 'USA': 'US', 'United States': 'US', 'Stany Zjednoczone': 'US'
};

const toAlpha2 = (code: string): string => {
  if (!code) return 'DE';
  const upper = code.trim().toUpperCase();
  return alpha2CountryMap[upper] || alpha2CountryMap[code.trim()] || 
         (code.length === 2 ? upper : 'DE');
};

const parseGermanAddress = (fullAddress: string): { street: string; houseNumber: string } => {
  const match = fullAddress.match(/^(.+?)\s+(\d+[\w\-\/]*)\s*$/);
  if (match) {
    return { street: match[1].trim(), houseNumber: match[2].trim() };
  }
  return { street: fullAddress, houseNumber: '' };
};

export function OrderShipmentPanel({ 
  order, 
  items, 
  companyId, 
  onSuccess 
}: { 
  order: any; 
  items: any[]; 
  companyId: string; 
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  
  // State
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);
  const [integrations, setIntegrations] = useState<any[]>([]);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [recipient, setRecipient] = useState(() => {
    const rawStreet = order.recipient?.address?.street || '';
    const parsed = parseGermanAddress(rawStreet);
    return {
      name: `${order.recipient?.firstName || ''} ${order.recipient?.lastName || ''}`.trim(),
      company: order.recipient?.companyName || '',
      street: parsed.street,
      houseNumber: parsed.houseNumber, 
      zip: order.recipient?.address?.zipCode || '',
      city: order.recipient?.address?.city || '',
      country: toAlpha2(order.recipient?.address?.country || 'DE'),
      phone: order.recipient?.phone || '',
      email: order.recipient?.email || ''
    };
  });

  // Calculate default weight and contents
  const totalWeight = items.reduce((acc, i) => {
    const w = parseFloat(i.crmProductSnapshot?.logistics?.weight || 0);
    return acc + (w * i.qtyOrdered);
  }, 0);
  
  const itemsWithLogistics = items.filter((i: any) => parseFloat(i.crmProductSnapshot?.logistics?.length || '0') > 0);
  const baseItem = itemsWithLogistics.length > 0 ? itemsWithLogistics[0] : items[0];

  const defaultLength = parseFloat(baseItem?.crmProductSnapshot?.logistics?.length || 10);
  const defaultWidth = parseFloat(baseItem?.crmProductSnapshot?.logistics?.width || 10);
  const defaultHeight = parseFloat(baseItem?.crmProductSnapshot?.logistics?.height || 10);

  const initialProducts = items
    .filter(i => i.mappingStatus === 'mapped' && i.productId)
    .map(i => {
       let wId = i.crmProductSnapshot?.warehouseLocationId;
       if (!wId && i.crmProductSnapshot?.id) {
           const parts = i.crmProductSnapshot.id.split('_');
           if (parts.length > 1) wId = parts[1];
       }
       return {
         id: i.productId,
         productId: i.productId,
         warehouseId: wId || 'DEFAULT',
         sku: i.sku,
         name: i.name,
         issuedQty: i.qtyOrdered,
         stock: 9999 // fallback for order items
       };
    });

  const [parcels, setParcels] = useState([{
    id: crypto.randomUUID(),
    weight: totalWeight > 0 ? totalWeight.toFixed(2) : '1',
    length: defaultLength.toString(),
    width: defaultWidth.toString(),
    height: defaultHeight.toString(),
    reference: order.orderNumber || order.id || '',
    selectedProducts: initialProducts
  }]);

  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [productResults, setProductResults] = useState<any[]>([]);
  const [showProductDropdown, setShowProductDropdown] = useState(false);

  useEffect(() => {
    const fetchProducts = async () => {
      if (!companyId) return;

      try {
        const stockQuery = query(
          collection(db, `companies/${companyId}/inventoryStock`),
          where('qtyOnHand', '>', 0)
        );
        const stockSnap = await getDocs(stockQuery);

        const stockMap = new Map();
        stockSnap.docs.forEach(doc => {
            const data = doc.data() as any;
            const avail = data.qtyAvailable || data.available || 0;
            const pid = data.productId;
            if (!pid) return;

            if (!stockMap.has(pid)) {
                stockMap.set(pid, { availableQty: 0, wId: data.warehouseLocationId || doc.id.split('_')[1] || 'DEFAULT', fallbackName: data.productName, fallbackSku: data.sku, fallbackEan: data.ean });
            }
            stockMap.get(pid).availableQty += avail;
        });

        for (const [key, value] of stockMap.entries()) {
            if (value.availableQty <= 0) stockMap.delete(key);
        }

        if (stockMap.size === 0) {
            setProducts([]);
            return;
        }

        const productIds = Array.from(stockMap.keys());
        const productsList: any[] = [];

        const chunks = [];
        for (let i = 0; i < productIds.length; i += 30) {
            chunks.push(productIds.slice(i, i + 30));
        }

        for (const chunk of chunks) {
            const pQuery = query(
                collection(db, `companies/${companyId}/products`),
                where(documentId(), 'in', chunk) 
            );
            const pSnap = await getDocs(pQuery);
            pSnap.docs.forEach(doc => {
                const v = doc.data() as any;
                const stockInfo = stockMap.get(doc.id);
                if (stockInfo) {
                    productsList.push({
                        ...v,
                        id: doc.id,
                        productId: doc.id,
                        name: v.name || stockInfo.fallbackName,
                        sku: v.sku || stockInfo.fallbackSku || '',
                        ean: v.ean || stockInfo.fallbackEan || '',
                        stock: stockInfo.availableQty,
                        warehouseId: stockInfo.wId
                    });
                    stockMap.delete(doc.id);
                }
            });
        }

        stockMap.forEach((info, pid) => {
            productsList.push({
                id: pid,
                productId: pid,
                name: info.fallbackName || 'Nieznany produkt',
                sku: info.fallbackSku || '',
                ean: info.fallbackEan || '',
                stock: info.availableQty,
                warehouseId: info.wId
            });
        });

        setProducts(productsList);
      } catch (err) {
        console.error('Błąd w pobieraniu produktów WZ:', err);
      }
    };

    fetchProducts();
  }, [companyId]);

  useEffect(() => {
    if (productSearch.length < 2) {
      setProductResults([]);
      return;
    }
    const s = productSearch.toLowerCase();
    const filtered = products.filter(p => 
      (p.sku && p.sku.toLowerCase().includes(s)) || 
      (p.name && p.name.toLowerCase().includes(s)) || 
      (p.ean && p.ean.toLowerCase().includes(s))
    );
    setProductResults(filtered);
  }, [productSearch, products]);

  useEffect(() => {
    const loadIntegrations = async () => {
      setLoadingIntegrations(true);
      try {
          // 1. Own integrations
          const myIntsQuery = query(
            collection(db, `companies/${companyId}/integrations`),
            where('type', 'in', ['dhl_de', 'gls_de']),
            where('status', '==', 'active')
          );
          const myIntsSnap = await getDocs(myIntsQuery);
          const loadedInts = myIntsSnap.docs.map(d => ({ id: d.id, ...d.data(), source: 'own' }));

          // 2. Global integrations
          const listGlobal = httpsCallable(functions, 'listGlobalIntegrations');
          const globalRes = await listGlobal();
          const globalInts = (globalRes.data as any[])?.filter(g => g.type === 'dhl_de' || g.type === 'gls_de').map(g => ({ ...g, source: 'global' })) || [];

          setIntegrations([...loadedInts, ...globalInts]);
      } catch(e) {
          console.error(e);
      } finally {
          setLoadingIntegrations(false);
      }
    };
    loadIntegrations();
  }, [companyId]);

  const handleGenerate = async (selectedInteg: any) => {
    if (!recipient.street || !recipient.houseNumber || !recipient.zip || !recipient.city) {
      setErrorMsg(t('dhlModal.errors.missingAddress', 'Proszę uzupełnić dane adresowe.'));
      return;
    }
    
    let errorFound = null;
    for (const p of parcels) {
      if (!p.weight || parseFloat(p.weight) <= 0) errorFound = t('dhlModal.errors.missingWeight', 'Brak wagi w jednej z paczek.');
      if (!p.length || parseFloat(p.length) <= 0) errorFound = t('dhlModal.errors.missingDimensions', 'Brak wymiarów w jednej z paczek.');
    }
    if (errorFound) {
      setErrorMsg(errorFound);
      return;
    }

    setIsGenerating(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const createLabelFn = selectedInteg.type === 'gls_de' 
        ? httpsCallable(functions, 'createGlsLabel') 
        : httpsCallable(functions, 'createDhlLabel');
      
      const trackingNumbers: string[] = [];
      let apiError = null;

      for (const p of parcels) {
          try {
              const res: any = await createLabelFn({
                  companyId,
                  integrationId: selectedInteg.id,
                  integrationSource: selectedInteg.source,
                  orderId: order.id,
                  sender: null,
                  recipient: {
                    ...recipient,
                    streetNumber: recipient.houseNumber
                  },
                  parcel: {
                    weight: parseFloat(p.weight || '0'),
                    length: parseFloat(p.length || '0'),
                    width: parseFloat(p.width || '0'),
                    height: parseFloat(p.height || '0')
                  },
                  reference: p.reference,
                  contents: p.selectedProducts.length > 0 
                    ? p.selectedProducts.map((sp: any) => `${sp.issuedQty}x ${sp.sku} ${sp.name}`).join(', ') 
                    : '',
                  products: p.selectedProducts.map((sp: any) => ({
                    productId: sp.productId || sp.id.split('_')[0] || sp.id,
                    warehouseId: sp.warehouseId || sp.id.split('_')[1] || 'DEFAULT',
                    sku: sp.sku,
                    ean: sp.ean || '',
                    name: sp.name,
                    issuedQty: sp.issuedQty
                  }))
              });

              if (res.data.success) {
                  trackingNumbers.push(res.data.trackingNumber);
              } else {
                  apiError = res.data.message || 'Błąd API';
                  break;
              }
          } catch (err: any) {
              apiError = err.message;
              break;
          }
      }

      if (trackingNumbers.length > 0) {
          setSuccessMsg(t('dhlModal.success', 'Wygenerowano etykiety: ') + trackingNumbers.join(', '));
          setTimeout(() => {
             onSuccess();
          }, 1500);
      }
      
      if (apiError) {
          setErrorMsg(apiError);
      }
    } catch(err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Błąd generowania etykiety');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <section className="bg-white rounded-xl shadow-sm border border-blue-200 overflow-hidden mb-6 relative">
       <div className="px-6 py-4 border-b border-blue-100 bg-blue-50/50">
          <h3 className="font-bold text-[#0A3D91] flex items-center gap-2">
             <span className="material-symbols-outlined text-[20px]">local_shipping</span>
             {t('orderShipment.title', 'Nadaj przesyłkę dla tego zamówienia')}
          </h3>
       </div>
       
       <div className="p-6">
          {errorMsg && <div className="mb-4 bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 font-medium text-sm">{errorMsg}</div>}
          {successMsg && <div className="mb-4 bg-green-50 text-green-700 p-4 rounded-xl border border-green-100 font-medium text-sm">{successMsg}</div>}

          <div className="mb-8">
              <p className="text-center text-sm font-medium text-gray-500 mb-4">{t('orderShipment.selectCourier', 'Wybierz kuriera, aby wygenerować etykietę dla tego zamówienia:')}</p>
              
              {loadingIntegrations ? (
                 <div className="flex justify-center p-4"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
              ) : integrations.length === 0 ? (
                 <div className="text-center p-4 bg-red-50 text-red-600 rounded-lg font-bold">{t('orderShipment.noCouriers', 'Brak dostępnych kurierów')}</div>
              ) : (
                 <div className="flex flex-wrap items-center justify-center gap-4">
                    {integrations.map(inte => (
                       <button 
                          key={inte.id}
                          onClick={() => handleGenerate(inte)}
                          disabled={isGenerating || !recipient.name || !recipient.zip || parcels.some(p => !p.weight)}
                          className={`p-3 px-6 shadow-md rounded-xl font-bold tracking-wide flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:shadow-none ${
                              inte.source === 'global' ? 
                                 (inte.type === 'gls_de' ? 'bg-[#001489] hover:bg-[#000e60] text-white shadow-blue-900/20' : 'bg-[#FFCC00] hover:bg-[#E6B800] text-[#D40511] shadow-yellow-500/20')
                                 : 'bg-[#0A3D91] hover:bg-[#082a63] text-white shadow-blue-500/20'
                          }`}
                       >
                          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin"/> : <span className="material-symbols-outlined text-[18px]">print</span>}
                          <div className="flex flex-col text-left">
                              <span className="uppercase text-sm leading-tight">{inte.source === 'global' && inte.type === 'gls_de' && inte.customName === 'GEPARD' ? 'GLS DE (GEPARD)' : inte.customName}</span>
                              {inte.sandboxMode && <span className="text-[9px] lowercase opacity-80 leading-none">sandbox</span>}
                          </div>
                       </button>
                    ))}
                 </div>
              )}
          </div>

                    <div className="flex flex-col xl:flex-row gap-6">
              {/* Odbiorca */}
              <div className="bg-gray-50/50 border border-gray-200 rounded-xl p-5 xl:w-1/3 shrink-0 h-fit">
                 <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">{t('orderShipment.recipientData', 'Dane Odbiorcy')}</h4>
                 <div className="space-y-3">
                    <div className="flex gap-3">
                       <input type="text" placeholder={t('orderShipment.fullName', 'Imię i nazwisko')} value={recipient.name} onChange={e=>setRecipient({...recipient, name: e.target.value})} className="w-1/2 bg-white rounded-lg px-3 py-2 text-sm border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" />
                       <input type="text" placeholder={t('orderShipment.company', 'Firma')} value={recipient.company} onChange={e=>setRecipient({...recipient, company: e.target.value})} className="w-1/2 bg-white rounded-lg px-3 py-2 text-sm border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div className="flex gap-3">
                       <input type="text" placeholder={t('orderShipment.street', 'Ulica')} value={recipient.street} onChange={e=>setRecipient({...recipient, street: e.target.value})} className="w-3/4 bg-white rounded-lg px-3 py-2 text-sm border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" />
                       <input type="text" placeholder={t('orderShipment.houseNumber', 'Nr domu')} value={recipient.houseNumber} onChange={e=>setRecipient({...recipient, houseNumber: e.target.value})} className="w-1/4 bg-white rounded-lg px-3 py-2 text-sm border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div className="flex gap-3">
                       <input type="text" placeholder={t('orderShipment.zip', 'Kod pocztowy')} value={recipient.zip} onChange={e=>setRecipient({...recipient, zip: e.target.value})} className="w-1/3 bg-white rounded-lg px-3 py-2 text-sm border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" />
                       <input type="text" placeholder={t('orderShipment.city', 'Miasto')} value={recipient.city} onChange={e=>setRecipient({...recipient, city: e.target.value})} className="w-2/3 bg-white rounded-lg px-3 py-2 text-sm border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div className="flex gap-3">
                       <input type="text" placeholder={t('orderShipment.country', 'Kraj (np. DEU)')} value={recipient.country} onChange={e=>setRecipient({...recipient, country: e.target.value})} className="w-1/3 bg-white rounded-lg px-3 py-2 text-sm border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" />
                       <input type="text" placeholder={t('orderShipment.phone', 'Telefon')} value={recipient.phone} onChange={e=>setRecipient({...recipient, phone: e.target.value})} className="w-2/3 bg-white rounded-lg px-3 py-2 text-sm border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                 </div>
              </div>

              {/* MULTIPACZKI */}
              <div className="bg-gray-50/50 border border-gray-200 rounded-xl p-5 flex-1">
                 <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">inventory_2</span> {t('dhlNewShipment.parcel.title', 'Parametry i Zawartość Paczek')}
                 </h2>
                 
                 <div className="flex flex-col gap-4">
                    {parcels.map((parcel, index) => (
                       <div key={parcel.id} className="flex flex-col lg:flex-row gap-4 items-start w-full border border-gray-200 rounded-xl p-4 bg-white shadow-sm relative">
                          {/* Wymiary */}
                          <div className="flex gap-2">
                             <div className="w-16">
                                <label className="text-[9px] font-bold text-gray-500 mb-1 block uppercase">{t('dhlNewShipment.parcel.weight', 'WAGA')}</label>
                                <input type="number" step="0.1" value={parcel.weight} onChange={e => setParcels(parcels.map(p => p.id === parcel.id ? {...p, weight: e.target.value} : p))} className="w-full rounded-lg px-2 py-2 text-xs font-bold text-gray-900 border border-gray-200 outline-none text-center focus:ring-2 focus:ring-blue-500" />
                             </div>
                             <div className="w-16">
                                <label className="text-[9px] font-bold text-gray-500 mb-1 block uppercase">{t('dhlNewShipment.parcel.length', 'DŁ')}</label>
                                <input type="number" value={parcel.length} onChange={e => setParcels(parcels.map(p => p.id === parcel.id ? {...p, length: e.target.value} : p))} className="w-full rounded-lg px-2 py-2 text-xs border border-gray-200 outline-none text-center focus:ring-2 focus:ring-blue-500" />
                             </div>
                             <div className="w-16">
                                <label className="text-[9px] font-bold text-gray-500 mb-1 block uppercase">{t('dhlNewShipment.parcel.width', 'SZER')}</label>
                                <input type="number" value={parcel.width} onChange={e => setParcels(parcels.map(p => p.id === parcel.id ? {...p, width: e.target.value} : p))} className="w-full rounded-lg px-2 py-2 text-xs border border-gray-200 outline-none text-center focus:ring-2 focus:ring-blue-500" />
                             </div>
                             <div className="w-16">
                                <label className="text-[9px] font-bold text-gray-500 mb-1 block uppercase">{t('dhlNewShipment.parcel.height', 'WYS')}</label>
                                <input type="number" value={parcel.height} onChange={e => setParcels(parcels.map(p => p.id === parcel.id ? {...p, height: e.target.value} : p))} className="w-full rounded-lg px-2 py-2 text-xs border border-gray-200 outline-none text-center focus:ring-2 focus:ring-blue-500" />
                             </div>
                          </div>

                          {/* Zawartość i Produkty */}
                          <div className="flex-1 min-w-[200px] relative">
                             <label className="text-[9px] font-bold text-gray-500 mb-1 block uppercase">{t('dhlNewShipment.contents.searchLabel', 'WYSZUKIWARKA PRODUKTÓW')}</label>
                             <input 
                                type="text"
                                placeholder={t('dhlNewShipment.contents.searchPlaceholder', 'Wyszukaj...')}
                                value={activeSearchId === parcel.id ? productSearch : ''}
                                onChange={e => setProductSearch(e.target.value)}
                                onFocus={() => {
                                   setActiveSearchId(parcel.id);
                                   setShowProductDropdown(true);
                                }}
                                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                             />
                             {showProductDropdown && activeSearchId === parcel.id && productResults.length > 0 && (
                                <div className="absolute top-[50px] left-0 z-20 w-[300px] bg-white border border-gray-100 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                                   {productResults.map(prod => (
                                      <button type="button" key={prod.id} className="w-full text-left px-4 py-2 hover:bg-blue-50 border-b border-gray-50" onClick={() => {
                                         if (!parcel.selectedProducts.find((p:any) => p.id === prod.id)) {
                                            const updatedParcels = parcels.map(p => {
                                               if (p.id === parcel.id) {
                                                  return { ...p, selectedProducts: [...p.selectedProducts, { ...prod, issuedQty: 1 }] };
                                               }
                                               return p;
                                            });
                                            setParcels(updatedParcels);
                                         }
                                         setProductSearch('');
                                         setShowProductDropdown(false);
                                      }}>
                                         <div className="font-bold text-xs">{prod.sku}</div>
                                         <div className="text-[10px] text-gray-500">{prod.name}</div>
                                      </button>
                                   ))}
                                </div>
                             )}

                             {parcel.selectedProducts.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                   {parcel.selectedProducts.map((sp: any, i) => (
                                      <div key={i} className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-md px-2 py-1 shadow-sm">
                                         <span className="text-[10px] font-bold">{sp.sku}</span>
                                         <input type="number" min="1" max={sp.stock} value={sp.issuedQty} onChange={e => {
                                            const val = Math.min(parseInt(e.target.value) || 1, sp.stock);
                                            const newParcels = [...parcels];
                                            newParcels[index].selectedProducts[i].issuedQty = val;
                                            setParcels(newParcels);
                                         }} className="w-10 text-[10px] bg-white border border-gray-200 rounded px-1 text-center font-bold" />
                                         <button type="button" onClick={() => {
                                            const newParcels = [...parcels];
                                            newParcels[index].selectedProducts = newParcels[index].selectedProducts.filter((_, idx) => idx !== i);
                                            setParcels(newParcels);
                                         }} className="text-red-500 hover:bg-red-50 rounded material-symbols-outlined text-[14px]">close</button>
                                      </div>
                                   ))}
                                </div>
                             )}
                          </div>

                          {/* Numer Ref */}
                          <div className="w-full lg:w-32 xl:w-48">
                             <label className="text-[9px] font-bold text-gray-500 mb-1 block uppercase">{t('dhlNewShipment.contents.referenceLabel', 'NR REF')}</label>
                             <input type="text" value={parcel.reference} onChange={e => setParcels(parcels.map(p => p.id === parcel.id ? {...p, reference: e.target.value} : p))} className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
                          </div>

                          {/* Akcja dodaj/usuń paczkę */}
                          <div className="flex items-center justify-end lg:mt-5 shrink-0">
                             {index === parcels.length - 1 ? (
                                <button type="button" onClick={() => {
                                   setParcels([...parcels, {
                                      id: crypto.randomUUID(),
                                      weight: '1', length: '10', width: '10', height: '10',
                                      reference: parcel.reference,
                                      selectedProducts: []
                                   }]);
                                }} className="bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg w-8 h-8 flex items-center justify-center transition-colors">
                                   <span className="material-symbols-outlined text-[20px] font-bold">add</span>
                                </button>
                             ) : (
                                <button type="button" onClick={() => {
                                   setParcels(parcels.filter(p => p.id !== parcel.id));
                                }} className="bg-red-50 hover:bg-red-100 text-red-500 rounded-lg w-8 h-8 flex items-center justify-center transition-colors">
                                   <span className="material-symbols-outlined text-[20px]">remove</span>
                                </button>
                             )}
                          </div>
                       </div>
                    ))}
                 </div>
              </div>
           </div>

       </div>
       
       {/* Block UI when generating */}
       {isGenerating && (
         <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] flex items-center justify-center z-10">
            <div className="bg-white px-6 py-4 rounded-2xl shadow-xl flex items-center gap-3 font-bold text-[#0A3D91]">
               <Loader2 className="w-5 h-5 animate-spin" /> {t('orderShipment.generating', 'Generowanie etykiety...')}
            </div>
         </div>
       )}
    </section>
  );
}
