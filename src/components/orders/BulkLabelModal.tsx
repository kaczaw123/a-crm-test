import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, where } from 'firebase/firestore';
import { db, functions } from '../../firebase/config';
import { useTranslation } from 'react-i18next';
import { Loader2, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import type { Order } from '../../data/orders';

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

export function BulkLabelModal({ 
  orders, 
  companyId, 
  onClose,
  onComplete
}: { 
  orders: Order[]; 
  companyId: string; 
  onClose: () => void;
  onComplete: () => void;
}) {
  const { t } = useTranslation();
  
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);
  const [integrations, setIntegrations] = useState<any[]>([]);
  
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Statusy i progres
  const [progress, setProgress] = useState({ total: orders.length, current: 0, success: 0, error: 0 });
  const [results, setResults] = useState<{orderId: string, status: 'success' | 'error', message?: string, shipmentId?: string}[]>([]);
  const [isPrinting, setIsPrinting] = useState(false);
  

  useEffect(() => {
    const loadIntegrations = async () => {
      setLoadingIntegrations(true);
      try {
          const myIntsQuery = query(
            collection(db, `companies/${companyId}/integrations`),
            where('type', 'in', ['dhl_de', 'gls_de']),
            where('status', '==', 'active')
          );
          const myIntsSnap = await getDocs(myIntsQuery);
          const loadedInts = myIntsSnap.docs.map(d => ({ id: d.id, ...d.data(), source: 'own' }));

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
    setIsGenerating(true);
    setProgress({ total: orders.length, current: 0, success: 0, error: 0 });
    setResults([]);

    const createLabelFn = selectedInteg.type === 'gls_de' 
        ? httpsCallable(functions, 'createGlsLabel') 
        : httpsCallable(functions, 'createDhlLabel');

    const BATCH_SIZE = 5;
    const allResults = [];
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE);
        
        const batchPromises = batch.map(async (order) => {
            try {
                // Parsing address
                const rawStreet = order.recipient?.address?.street || '';
                const parsed = parseGermanAddress(rawStreet);
                const recipient = {
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

                if (!recipient.street || !recipient.zip || !recipient.city) {
                    throw new Error('Brak wymaganych danych adresowych (ulica, kod, miasto)');
                }

                const getOrderDetailsFn = httpsCallable(functions, 'getOrderDetails');
                const detailsRes: any = await getOrderDetailsFn({ companyId, orderId: order.id });
                const items = detailsRes?.data?.items || [];

                const totalWeight = items.reduce((acc: number, item: any) => {
                    const w = parseFloat(item.crmProductSnapshot?.logistics?.weight || item.weight || 0);
                    return acc + (w * (item.qtyOrdered || 1));
                }, 0);
                
                const orderWeight = totalWeight > 0 ? parseFloat(totalWeight.toFixed(2)) : 1;
                const itemsWithLogistics = items.filter((i: any) => parseFloat(i.crmProductSnapshot?.logistics?.length || '0') > 0);
                const baseItem = itemsWithLogistics.length > 0 ? itemsWithLogistics[0] : items[0];

                const orderLength = parseFloat(baseItem?.crmProductSnapshot?.logistics?.length || '10');
                const orderWidth = parseFloat(baseItem?.crmProductSnapshot?.logistics?.width || '10');
                const orderHeight = parseFloat(baseItem?.crmProductSnapshot?.logistics?.height || '10');

                const payloadProducts = items.filter((it: any) => it.mappingStatus === 'mapped' && it.productId).map((it: any) => ({
                    productId: it.productId,
                    warehouseId: it.crmProductSnapshot?.warehouseLocationId || 'DEFAULT',
                    sku: it.sku,
                    name: it.name,
                    issuedQty: it.qtyOrdered
                }));

                const res: any = await createLabelFn({
                    companyId,
                    orderId: order.id,
                    integrationId: selectedInteg.id,
                    integrationSource: selectedInteg.source,
                    recipient: {
                        company: recipient.company,
                        name: recipient.name,
                        street: recipient.street,
                        streetNumber: recipient.houseNumber,
                        zip: recipient.zip,
                        city: recipient.city,
                        country: recipient.country,
                        phone: recipient.phone,
                        email: recipient.email
                    },
                    parcel: {
                        weight: orderWeight,
                        length: orderLength,
                        width: orderWidth,
                        height: orderHeight
                    },
                    reference: order.orderNumber || order.id || '',
                    products: payloadProducts
                });

                if (res.data.success) {
                    return { orderId: order.orderNumber || order.id, status: 'success' as const, message: res.data.trackingNumber, shipmentId: res.data.shipmentId };
                } else {
                    return { orderId: order.orderNumber || order.id, status: 'error' as const, message: 'API Error' };
                }
            } catch (err: any) {
                return { orderId: order.orderNumber || order.id, status: 'error' as const, message: err.message || 'Błąd lokalny' };
            }
        });

        const batchResults = await Promise.all(batchPromises);
        
        for (const res of batchResults) {
            allResults.push(res);
            if (res.status === 'success') successCount++;
            else errorCount++;
        }

        setProgress({
            total: orders.length,
            current: Math.min(i + BATCH_SIZE, orders.length),
            success: successCount,
            error: errorCount
        });
    }

    setResults(allResults);
    setIsGenerating(false);
  };

  const handlePrint = async () => {
    const successIds = results.filter(r => r.status === 'success' && r.shipmentId).map(r => r.shipmentId!);
    if (successIds.length === 0) return;
    setIsPrinting(true);
    try {
        const mergeLabels = httpsCallable(functions, 'mergeDhlLabels');
        const res: any = await mergeLabels({
           companyId,
           shipmentIds: successIds
        });
        const url = res.data.signedUrl || res.data.url;
        if (res.data.success && url) {
           window.open(url, '_blank');
        } else {
           alert(res.data.message || 'Błąd generowania pliku PDF');
        }
    } catch (e: any) {
        alert(e.message || 'Błąd scalania PDF');
    } finally {
        setIsPrinting(false);
    }
  };

  const isFinished = results.length > 0 && !isGenerating;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <span className="material-symbols-outlined text-blue-600">local_shipping</span>
            Zbiorcze generowanie etykiet ({orders.length})
          </h2>
          {!isGenerating && (
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto">
            {!isGenerating && !isFinished && (
                <>
                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 text-sm text-blue-800">
                        Wybrano <strong>{orders.length}</strong> zamówień. Zostaną użyte parametry zapisane dla każdego zamówienia z osobna (waga, długość, szerokość, wysokość).
                    </div>

                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-4">Wybierz Kuriera i Rozpocznij</h4>
                    
                    {loadingIntegrations ? (
                        <div className="flex justify-center p-4"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
                    ) : integrations.length === 0 ? (
                        <div className="text-center p-4 bg-red-50 text-red-600 rounded-lg font-bold">Brak dostępnych kurierów</div>
                    ) : (
                        <div className="flex flex-wrap gap-4">
                            {integrations.map(inte => (
                                <button 
                                    key={inte.id}
                                    onClick={() => handleGenerate(inte)}
                                    disabled={isGenerating}
                                    className={`p-4 px-6 shadow-md rounded-xl font-bold tracking-wide flex items-center justify-center gap-3 transition-all disabled:opacity-50 disabled:shadow-none hover:scale-105 ${
                                        inte.source === 'global' ? 
                                            (inte.type === 'gls_de' ? 'bg-[#001489] hover:bg-[#000e60] text-white shadow-blue-900/20' : 'bg-[#FFCC00] hover:bg-[#E6B800] text-[#D40511] shadow-yellow-500/20')
                                            : 'bg-[#0A3D91] hover:bg-[#082a63] text-white shadow-blue-500/20'
                                    }`}
                                >
                                    <span className="material-symbols-outlined text-[24px]">print</span>
                                    <div className="flex flex-col text-left">
                                        <span className="uppercase text-sm leading-tight">{inte.source === 'global' && inte.type === 'gls_de' && inte.customName === 'GEPARD' ? 'GLS DE (GEPARD)' : inte.customName}</span>
                                        {inte.sandboxMode && <span className="text-[10px] lowercase opacity-80 leading-none mt-0.5">sandbox mode</span>}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </>
            )}

            {(isGenerating || isFinished) && (
                <div className="flex flex-col gap-6">
                    {/* Progress Overview */}
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center">
                        <div className="text-4xl font-black text-gray-900 mb-2">
                            {progress.current} <span className="text-gray-400 text-2xl">/ {progress.total}</span>
                        </div>
                        <div className="flex justify-center gap-8 mt-4 text-sm font-bold">
                            <div className="text-green-600 flex items-center gap-1"><CheckCircle2 className="w-4 h-4"/> Sukces: {progress.success}</div>
                            <div className="text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4"/> Błędy: {progress.error}</div>
                        </div>
                        
                        {/* Progress Bar */}
                        <div className="w-full bg-gray-200 rounded-full h-2.5 mt-6 overflow-hidden">
                            <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${(progress.current / progress.total) * 100}%` }}></div>
                        </div>
                    </div>

                    {/* Log list */}
                    {results.length > 0 && (
                        <div className="border border-gray-200 rounded-xl overflow-hidden flex flex-col max-h-[300px]">
                            <div className="bg-gray-100 px-4 py-2 text-xs font-bold text-gray-500 uppercase">Log Operacji</div>
                            <div className="overflow-y-auto p-2 bg-gray-50">
                                {results.map((r, i) => (
                                    <div key={i} className={`text-sm py-1.5 px-3 rounded mb-1 flex justify-between ${r.status === 'success' ? 'bg-green-100/50 text-green-800' : 'bg-red-100/50 text-red-800'}`}>
                                        <span className="font-mono">{r.orderId}</span>
                                        <span className="font-medium">{r.message}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-between items-center">
            {isFinished ? (
                <>
                    <button onClick={handlePrint} disabled={isPrinting || results.filter(r => r.status === 'success').length === 0} className="bg-white border border-blue-200 hover:bg-blue-50 text-blue-800 px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 transition-colors disabled:opacity-50">
                        {isPrinting ? <Loader2 className="w-5 h-5 animate-spin"/> : <span className="material-symbols-outlined text-[20px]">print</span>}
                        {isPrinting ? 'Łączenie PDF...' : `Drukuj Etykiety (${results.filter(r => r.status === 'success').length})`}
                    </button>
                    <button onClick={() => { onComplete(); onClose(); }} className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-2.5 rounded-xl font-bold">
                        Zakończ i Odśwież
                    </button>
                </>
            ) : (
                <div className="w-full flex justify-end">
                    <button onClick={onClose} disabled={isGenerating} className="bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 px-6 py-2.5 rounded-xl font-bold disabled:opacity-50">
                        Anuluj
                    </button>
                </div>
            )}
        </div>
      </div>
    </div>
  );
}
