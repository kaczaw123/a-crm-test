import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db, functions } from '../../firebase/config';
import { useTranslation } from 'react-i18next';
import { X, Plus, Trash2, Loader2, Truck } from 'lucide-react';
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

export function DhlShipmentModal({ 
  order, 
  items, 
  companyId, 
  onClose, 
  onSuccess 
}: { 
  order: any; 
  items: any[]; 
  companyId: string; 
  onClose: () => void; 
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  
  // State
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState<string>('');
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

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
  
  const defaultLength = parseFloat(items[0]?.crmProductSnapshot?.logistics?.length || 10);
  const defaultWidth = parseFloat(items[0]?.crmProductSnapshot?.logistics?.width || 10);
  const defaultHeight = parseFloat(items[0]?.crmProductSnapshot?.logistics?.height || 10);

  const defaultContents = items.map(i => `${i.qtyOrdered}x ${i.sku} ${i.name} EAN:${i.ean || '-'}`).join(', ');

  const [parcels, setParcels] = useState([{
    id: Date.now().toString(),
    weight: totalWeight > 0 ? totalWeight : 1,
    length: defaultLength ? defaultLength : 10,
    width: defaultWidth ? defaultWidth : 10,
    height: defaultHeight ? defaultHeight : 10,
    contents: defaultContents
  }]);

  // Load Integrations
  useEffect(() => {
    const fetchIntegrations = async () => {
      try {
        const q = query(
          collection(db, `companies/${companyId}/integrations`),
          where('type', '==', 'dhl_de'),
          where('status', '==', 'active')
        );
        const snap = await getDocs(q);
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        setIntegrations(data);
        if (data.length > 0) {
          const defaultInt = data.find(d => d.isDefault) || data[0];
          setSelectedIntegrationId(defaultInt.id);
        }
      } catch (err) {
        console.error(err);
        setErrorMsg('Błąd pobierania integracji DHL.');
      } finally {
        setLoadingIntegrations(false);
      }
    };
    fetchIntegrations();
  }, [companyId]);

  const handleAddParcel = () => {
    setParcels([...parcels, {
      id: Date.now().toString(),
      weight: 1,
      length: defaultLength || 10,
      width: defaultWidth || 10,
      height: defaultHeight || 10,
      contents: ''
    }]);
  };

  const handleRemoveParcel = (id: string) => {
    if (parcels.length === 1) return;
    setParcels(parcels.filter(p => p.id !== id));
  };

  const updateParcel = (id: string, field: string, value: any) => {
    setParcels(parcels.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handleGenerate = async () => {
    console.log('Items count:', items.length, items.map(i => i.sku));
    if (!selectedIntegrationId) {
       setErrorMsg(t('dhlModal.errors.selectIntegration'));
       return;
    }
    if (!recipient.houseNumber || recipient.houseNumber.length === 0) {
      setErrorMsg(t('dhlModal.errors.houseNumberRequired'));
      return;
    }
    if (recipient.houseNumber.length > 10) {
      setErrorMsg(t('dhlModal.errors.houseNumberMax'));
      return;
    }
    setErrorMsg('');
    setIsGenerating(true);
    try {
      const isValidWarehouseId = (wId: string | null | undefined) => {
        return wId && 
               wId !== 'FALLBACK' && 
               wId !== '' &&
               !wId.includes('_'); // warehouseId to czysty hash bez podkreślników
      };

      let defaultWarehouseId = '';
      const itemsWithoutWarehouse = items.some(i => 
           !isValidWarehouseId(i.crmProductSnapshot?.logistics?.warehouseId)
      );
      
      if (itemsWithoutWarehouse) {
        // Pobierz warehouseId z inventoryStock dla pierwszego produktu
        const sku = items[0]?.sku;
        if (sku) {
          const stockSnap = await getDocs(
            query(
              collection(db, `companies/${companyId}/inventoryStock`),
              where('sku', '==', sku),
              limit(1)
            )
          );
          if (!stockSnap.empty) {
            const stockData = stockSnap.docs[0].data();
            defaultWarehouseId = stockData.locationId || 
                                 stockData.warehouseId || 
                                 stockSnap.docs[0].id.split('_').pop() || '';
          }
        }
      }

      const productsPayload = items.map(i => {
        let wId = i.crmProductSnapshot?.logistics?.warehouseId;
        if (!isValidWarehouseId(wId)) wId = defaultWarehouseId;

        return {
          id: i.id,
          productId: (i.productId && i.productId !== '') 
            ? i.productId 
            : (i.crmProductSnapshot?.id || i.sku),
          sku: i.sku || '',
          ean: i.ean || '',
          name: i.name || t('dhlModal.unknownProduct'),
          issuedQty: i.qtyOrdered,
          warehouseId: wId
        };
      });

      console.log('Final products payload:', JSON.stringify(productsPayload));

      const payload = {
        companyId,
        integrationId: selectedIntegrationId,
        orderId: order.id,
        reference: order.orderNumber,
        recipient: {
           name: recipient.name,
           company: recipient.company,
           street: recipient.street,
           streetNumber: recipient.houseNumber, // Backend functions/src/dhl.ts oczekuje "streetNumber"
           zip: recipient.zip,
           city: recipient.city,
           country: toAlpha2(recipient.country),
           phone: recipient.phone,
           email: recipient.email
        },
        // Wsparcie multi-parcel
        parcels: parcels.map(p => ({
           weight: parseFloat(String(p.weight)),
           length: parseFloat(String(p.length)),
           width: parseFloat(String(p.width)),
           height: parseFloat(String(p.height)),
           contents: p.contents
        })),
        // Zachowanie kompatybilności wstecznej jeśli Cloud Function tego oczekuje
        parcel: {
           weight: parseFloat(String(parcels[0].weight)),
           length: parseFloat(String(parcels[0].length)),
           width: parseFloat(String(parcels[0].width)),
           height: parseFloat(String(parcels[0].height)),
        },
        contents: parcels.map(p => p.contents).join(' | '),
        products: productsPayload
      };

      console.log('Products payload:', JSON.stringify(payload.products));

      const fn = httpsCallable(functions, 'createDhlLabel');
      const result = await fn(payload);

      alert(t('dhlModal.success', { tracking: (result.data as any).trackingNumber }));

      onSuccess();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || t('dhlModal.errors.generateError'));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl my-8 mx-auto flex flex-col max-h-screen border border-gray-200">
         <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0 bg-white rounded-t-xl">
           <div className="flex items-center gap-3">
             <div className="bg-[#FFCC00] p-2 rounded-lg">
               <Truck className="w-5 h-5 text-[#D40511]"/>
             </div>
             <div>
               <h2 className="text-lg font-bold text-gray-900">{t('dhlModal.title')}</h2>
               <p className="text-xs text-gray-500">{t('dhlModal.order')} {order.orderNumber}</p>
             </div>
           </div>
           <button onClick={onClose} disabled={isGenerating} className="p-2 text-gray-400 hover:text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors">
             <X className="w-5 h-5" />
           </button>
         </div>

         <div className="p-6 overflow-y-auto flex-1 bg-gray-50/50">
            {errorMsg && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center gap-2">
                   <div className="w-1.5 h-full absolute left-0 top-0 bg-red-500 rounded-l-lg"></div>
                   <span className="font-semibold text-red-800">Błąd:</span> {errorMsg}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* ODBIORCA */}
                <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-cyan-500"></div>
                   <h3 className="font-bold text-gray-800 text-sm mb-4 border-b pb-2">{t('dhlModal.recipientData')}</h3>
                   <div className="space-y-3">
                      <div>
                         <label className="block text-xs font-medium text-gray-500 mb-1">{t('dhlModal.firstNameLastName')}</label>
                         <input type="text" className="w-full text-sm border border-gray-300 px-3 py-2 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500" value={recipient.name} onChange={e => setRecipient({...recipient, name: e.target.value})} autoComplete="off" />
                      </div>
                      <div>
                         <label className="block text-xs font-medium text-gray-500 mb-1">{t('dhlModal.company')}</label>
                         <input type="text" className="w-full text-sm border border-gray-300 px-3 py-2 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500" value={recipient.company} onChange={e => setRecipient({...recipient, company: e.target.value})} autoComplete="off" />
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                          <div className="col-span-2">
                             <label className="block text-xs font-medium text-gray-500 mb-1">{t('dhlModal.street')}</label>
                             <input type="text" className="w-full text-sm border border-gray-300 px-3 py-2 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500" value={recipient.street} onChange={e => setRecipient({...recipient, street: e.target.value})} autoComplete="off" />
                          </div>
                          <div>
                             <label className="block text-xs font-medium text-gray-500 mb-1">{t('dhlModal.houseNumber')}</label>
                             <input type="text" className="w-full text-sm border border-gray-300 px-3 py-2 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500" value={recipient.houseNumber} onChange={e => setRecipient({...recipient, houseNumber: e.target.value})} autoComplete="off" />
                          </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                          <div>
                             <label className="block text-xs font-medium text-gray-500 mb-1">{t('dhlModal.zipCode')}</label>
                             <input type="text" className="w-full text-sm border border-gray-300 px-3 py-2 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500" value={recipient.zip} onChange={e => setRecipient({...recipient, zip: e.target.value})} autoComplete="off" />
                          </div>
                          <div className="col-span-2">
                             <label className="block text-xs font-medium text-gray-500 mb-1">{t('dhlModal.city')}</label>
                             <input type="text" className="w-full text-sm border border-gray-300 px-3 py-2 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500" value={recipient.city} onChange={e => setRecipient({...recipient, city: e.target.value})} autoComplete="off" />
                          </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                          <div>
                             <label className="block text-xs font-medium text-gray-500 mb-1">{t('dhlModal.country')}</label>
                             <input type="text" className="w-full text-sm border border-gray-300 px-3 py-2 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500" value={recipient.country} onChange={e => setRecipient({...recipient, country: e.target.value})} autoComplete="off" />
                          </div>
                          <div>
                             <label className="block text-xs font-medium text-gray-500 mb-1">{t('dhlModal.phone')}</label>
                             <input type="text" className="w-full text-sm border border-gray-300 px-3 py-2 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500" value={recipient.phone} onChange={e => setRecipient({...recipient, phone: e.target.value})} autoComplete="off" />
                          </div>
                      </div>
                      <div>
                         <label className="block text-xs font-medium text-gray-500 mb-1">{t('dhlModal.email')}</label>
                         <input type="email" className="w-full text-sm border border-gray-300 px-3 py-2 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500" value={recipient.email} onChange={e => setRecipient({...recipient, email: e.target.value})} autoComplete="off" />
                      </div>
                   </div>
                </div>

                {/* PACZKI & INTEGRACJA */}
                <div className="flex flex-col gap-6">
                    {/* INTEGRACJA */}
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-[#FFCC00]"></div>
                        <h3 className="font-bold text-gray-800 text-sm mb-4 border-b pb-2">{t('dhlModal.integrationGKP')}</h3>
                        {loadingIntegrations ? (
                            <div className="text-sm text-gray-500 flex items-center gap-2 px-2"><Loader2 className="w-4 h-4 animate-spin"/> {t('dhlModal.loadingIntegrations')}</div>
                        ) : integrations.length === 0 ? (
                            <div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-md border border-amber-200 font-medium">{t('dhlModal.noActiveIntegrations')}</div>
                        ) : (
                            <select 
                               className="w-full text-sm border border-gray-300 px-3 py-2 rounded-md bg-white focus:ring-1 focus:ring-[#FFCC00] focus:border-[#FFCC00] outline-none"
                               value={selectedIntegrationId}
                               onChange={e => setSelectedIntegrationId(e.target.value)}
                               autoComplete="off"
                            >
                                {integrations.map(int => (
                                    <option key={int.id} value={int.id}>{int.customName} {int.sandboxMode ? '(SANDBOX)' : ''}</option>
                                ))}
                            </select>
                        )}
                    </div>

                    {/* PACZKI */}
                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex-1 flex flex-col min-h-0 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500"></div>
                        <div className="flex items-center justify-between mb-4 border-b pb-2">
                           <h3 className="font-bold text-gray-800 text-sm">{t('dhlModal.parcels', { count: parcels.length })}</h3>
                           <button onClick={handleAddParcel} className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-md hover:bg-emerald-100 flex items-center gap-1 transition-colors border border-emerald-100">
                              <Plus className="w-3.5 h-3.5"/> {t('dhlModal.addParcel')}
                           </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                            {parcels.map((p, idx) => (
                               <div key={p.id} className="p-4 bg-gray-50/50 rounded-lg border border-gray-200 relative group transition-colors hover:border-gray-300 shadow-sm">
                                   {parcels.length > 1 && (
                                     <button onClick={() => handleRemoveParcel(p.id)} className="absolute top-3 right-3 text-gray-400 hover:text-red-600 p-1 bg-white rounded-md border border-gray-200 shadow-sm transition-all hover:bg-red-50 hover:border-red-200">
                                        <Trash2 className="w-3.5 h-3.5" />
                                     </button>
                                   )}
                                   <div className="font-bold text-[11px] text-gray-500 uppercase tracking-wider mb-3">{t('dhlModal.parcelNum', { num: idx + 1 })}</div>
                                   <div className="grid grid-cols-4 gap-3 mb-3">
                                       <div>
                                          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1 ml-0.5">{t('dhlModal.weightKg')}</label>
                                          <input type="number" step="0.1" className="w-full text-xs py-1.5 px-2 border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none rounded-md bg-white shadow-sm" value={p.weight} onChange={e => updateParcel(p.id, 'weight', e.target.value)} />
                                       </div>
                                       <div>
                                          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1 ml-0.5">{t('dhlModal.lengthCm')}</label>
                                          <input type="number" className="w-full text-xs py-1.5 px-2 border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none rounded-md bg-white shadow-sm" value={p.length} onChange={e => updateParcel(p.id, 'length', e.target.value)} />
                                       </div>
                                       <div>
                                          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1 ml-0.5">{t('dhlModal.widthCm')}</label>
                                          <input type="number" className="w-full text-xs py-1.5 px-2 border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none rounded-md bg-white shadow-sm" value={p.width} onChange={e => updateParcel(p.id, 'width', e.target.value)} />
                                       </div>
                                       <div>
                                          <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1 ml-0.5">{t('dhlModal.heightCm')}</label>
                                          <input type="number" className="w-full text-xs py-1.5 px-2 border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none rounded-md bg-white shadow-sm" value={p.height} onChange={e => updateParcel(p.id, 'height', e.target.value)} />
                                       </div>
                                   </div>
                                   <div>
                                      <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1 ml-0.5">{t('dhlModal.contents')}</label>
                                      <input type="text" className="w-full text-xs py-1.5 px-3 border border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none rounded-md bg-white shadow-sm" value={p.contents} onChange={e => updateParcel(p.id, 'contents', e.target.value)} autoComplete="off" />
                                   </div>
                               </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
         </div>

         <div className="p-4 border-t border-gray-100 bg-gray-50 rounded-b-xl flex justify-end gap-3 shrink-0">
             <button onClick={onClose} disabled={isGenerating} className="px-5 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors shadow-sm">
                {t('dhlModal.cancel')}
             </button>
             <button onClick={handleGenerate} disabled={isGenerating || integrations.length === 0} className="px-5 py-2 text-sm font-bold text-[#FFCC00] bg-[#D40511] rounded-lg border border-[#CC0000] hover:bg-[#B3000D] transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50">
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin text-white"/> : <Truck className="w-4 h-4"/>}
                {isGenerating ? t('dhlModal.generating') : t('dhlModal.generateBtn')}
             </button>
         </div>
      </div>
    </div>
  );
}
