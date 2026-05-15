import React, { useState, useEffect } from 'react';
import { useAuth } from '../../../auth/useAuth';
import { db, functions, functionsEU } from '../../../firebase/config';
import { collection, query, where, getDocs, doc, getDoc, limit, documentId } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AppTour } from '../../../components/common/AppTour';
import type { Step } from '../../../components/common/AppTour';

const EU_COUNTRIES = [
  'DE', 'AT', 'PL', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'GR', 
  'ES', 'NL', 'IE', 'LT', 'LU', 'LV', 'MT', 'PT', 'RO', 'SK', 'SI', 'SE', 
  'HU', 'IT'
];

export default function NewShipmentPage() {
  const { profile } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const getCountryName = (code: string) => {
     try {
        const name = new Intl.DisplayNames([i18n.language || 'pl'], { type: 'region' }).of(code);
        return `${name} (${code})`;
     } catch(e) {
        return code;
     }
  };

  // 1. Odbiorca & Nadawca
  const [senderName, setSenderName] = useState('');
  const [isReturn, setIsReturn] = useState(false);
  const [senderCompany, setSenderCompany] = useState('');
  const [senderStreet, setSenderStreet] = useState('Johannes-R.-Becher-Straße');
  const [senderNumber, setSenderNumber] = useState('29');
  const [senderZip, setSenderZip] = useState('02827');
  const [senderCity, setSenderCity] = useState('Görlitz');
  const [senderCountry, setSenderCountry] = useState('DE');

  const [recipientType, setRecipientType] = useState<'address' | 'pickup'>('address');
  const [recipCompany, setRecipCompany] = useState('');
  const [recipName, setRecipName] = useState('');
  const [recipPhone, setRecipPhone] = useState('');
  const [recipEmail, setRecipEmail] = useState('');
  const [recipStreet, setRecipStreet] = useState('');
  const [recipNumber, setRecipNumber] = useState('');
  const [recipZip, setRecipZip] = useState('');
  const [recipCity, setRecipCity] = useState('');
  const [recipCountry, setRecipCountry] = useState('DE');

  // 3. Parametry i Zawartość Paczek
  const [parcels, setParcels] = useState([{
    id: crypto.randomUUID(),
    weight: '1', length: '10', width: '10', height: '10',
    reference: '',
    selectedProducts: [] as any[]
  }]);
  
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [productResults, setProductResults] = useState<any[]>([]);
  const [showProductDropdown, setShowProductDropdown] = useState(false);

  // 5. Integracja
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState('');
  const [estimates, setEstimates] = useState<Record<string, { price?: number, currency?: string, loading?: boolean, error?: string }>>({});

  // 6. Walidacja Kodu Pocztowego
  const [recipZipStatus, setRecipZipStatus] = useState<'idle' | 'loading' | 'valid' | 'invalid'>('idle');
  const [recipCitySuggestions, setRecipCitySuggestions] = useState<string[]>([]);
  const [showRecipSuggestions, setShowRecipSuggestions] = useState(false);

  // Statusy i Loadery
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [isVerifyingAddr, setIsVerifyingAddr] = useState(false);
  const [addrCheckResult, setAddrCheckResult] = useState<string | null>(null);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // APP TOUR
  const [runTour, setRunTour] = useState(false);
  
  useEffect(() => {
    if (profile && !profile.completedTours?.includes('new_shipment_v1')) {
      const timer = setTimeout(() => setRunTour(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [profile]);

  const handleTourFinish = () => setRunTour(false);

  const tourSteps: Step[] = [
    {
      target: '#tour-new-shipment-header',
      content: t('tour.newShipment.step1', 'Wypełnij dane Nadawcy i Odbiorcy. System podpowie automatycznie Twój adres z konfiguracji profilu.'),
    },
    {
      target: '#tour-new-shipment-dimensions',
      content: t('tour.newShipment.step2', 'Wymiary i waga paczki są konieczne. Dla Twojej wygody ustawiliśmy domyślnie 1 kg.'),
    },
    {
      target: '#tour-new-shipment-bottom',
      content: t('tour.newShipment.step3', 'Kiedy wypełnisz formularz, wybierz jednego z kurierów na dole, aby błyskawicznie wygenerować i wydrukować list przewozowy.'),
    }
  ];

  useEffect(() => {
    async function initData() {
      if (!profile?.activeCompanyId) return;
      try {
         // Fetch company details for Sender Autofill
         const compDoc = await getDoc(doc(db, 'companies', profile.activeCompanyId));
         if (compDoc.exists()) {
             const cData = compDoc.data();
             setSenderCompany(cData.name || '');
         }

         // Fetch active integrations (Company)
         const intsSnap = await getDocs(query(collection(db, `companies/${profile.activeCompanyId}/integrations`), where('type', 'in', ['dhl_de', 'gls_de']), where('status', '==', 'active')));
         const loadedInts = intsSnap.docs.map(d => ({ id: d.id, source: 'own', ...d.data() }));

         // Fetch active integrations (Global Broker)
         const listGlobal = httpsCallable(functions, 'listGlobalIntegrations');
         const globalRes = await listGlobal();
         const globalInts = (globalRes.data as any[])?.filter(g => g.type === 'dhl_de' || g.type === 'gls_de').map(g => ({ ...g, source: 'global' })) || [];

         const allIntegrations = [...loadedInts, ...globalInts];
         setIntegrations(allIntegrations);
      } catch(e) {
          console.error(e);
      } finally {
          setLoadingInitial(false);
      }
    }
    initData();
  }, [profile?.activeCompanyId]);

  useEffect(() => {
    const fetchProducts = async () => {
      if (!profile?.activeCompanyId) return;

      try {
        const stockQuery = query(
          collection(db, `companies/${profile.activeCompanyId}/inventoryStock`),
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
                collection(db, `companies/${profile.activeCompanyId}/products`),
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
                name: info.fallbackName || t('dhlNewShipment.contents.unknownProduct', 'Nieznany produkt'),
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
  }, [profile?.activeCompanyId]);

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

  const selectedInteg = integrations.find(i => i.id === selectedIntegrationId);

  useEffect(() => {
    const totalW = parcels.reduce((acc, p) => acc + parseFloat(p.weight || '0'), 0);
    if (!totalW || totalW <= 0 || !recipCountry || integrations.length === 0) {
      setEstimates({});
      return;
    }

    const timer = setTimeout(() => {
      integrations.forEach(async (inte) => {
        if (inte.source !== 'global') return;
        setEstimates(prev => ({ ...prev, [inte.id]: { loading: true } }));
        try {
          const carrierId = inte.type === 'dhl_de' ? 'dhl_at' : (inte.type === 'gls_de' ? 'gls_de' : inte.type);
          let serviceCode = 'STANDARD';
          if (carrierId === 'gls_de') {
              serviceCode = recipCountry === 'DE' ? 'BP' : 'EBP';
          }

          const estimateFn = httpsCallable(functionsEU, 'estimateShipmentCost');
          const res: any = await estimateFn({
            companyId: profile?.activeCompanyId,
            carrierId,
            destCountry: recipCountry,
            weight: totalW,
            serviceCode,
            optionalServices: []
          });

          const sourceMode = res.data.metadata?.pricingSource;
          if (sourceMode === 'no_markup' && !res.data.priceToClient.breakdown.some((b: any) => b.markup > 0)) {
            setEstimates(prev => ({
              ...prev,
              [inte.id]: { error: 'Cennik nie skonfigurowany. Skontaktuj się z administratorem.', loading: false }
            }));
            return;
          }

          setEstimates(prev => ({ 
            ...prev, 
            [inte.id]: { 
              price: res.data.priceToClient.total, 
              currency: res.data.priceToClient.currency,
              loading: false 
            } 
          }));
        } catch (err: any) {
          let userMsg = 'Wycena niedostępna';
          const code = err.code || '';
          const message = err.message || '';

          if (code === 'permission-denied' || message.includes('Brak przypisanej firmy')) {
            userMsg = 'Brak dostępu — skontaktuj się z administratorem';
          } else if (code === 'not-found' && message.includes('Brak aktywnego kontraktu')) {
            userMsg = 'Wycena niedostępna chwilowo (brak kontraktu kuriera)';
          } else if (code === 'not-found' && message.includes('destynacji')) {
            userMsg = 'Brak ceny dla tej destynacji';
          } else if (code === 'out-of-range' || message.includes('weight out of range')) {
            userMsg = 'Waga przekracza maksimum kuriera';
          } else if (code === 'unauthenticated') {
            userMsg = 'Wymagane ponowne logowanie';
          } else {
            userMsg = 'Błąd wyceny';
          }

          setEstimates(prev => ({
            ...prev,
            [inte.id]: { error: userMsg, loading: false }
          }));
        }
      });
    }, 500);

    return () => clearTimeout(timer);
  }, [parcels, recipCountry, integrations]);

  const handleZipBlur = async () => {
      const zip = recipZip;
      const country = recipCountry;
      const setStatus = setRecipZipStatus;
      const setSuggestions = setRecipCitySuggestions;
      const setShow = setShowRecipSuggestions;

      if (zip.length < 3) {
          console.log('[handleZipBlur] Zbyt krótki ZIP, przerywam.');
          return;
      }
      if (!profile?.activeCompanyId || !selectedIntegrationId) {
          console.log('[handleZipBlur] Brak companyId lub integrationId, przerywam:', { companyId: profile?.activeCompanyId, integrationId: selectedIntegrationId });
          return;
      }

      console.log(`[handleZipBlur] Rozpoczynam weryfikację dla ZIP: ${zip}, country: ${country}`);
      setStatus('loading');
      try {
          const verify = httpsCallable(functions, 'verifyDhlAddress');
          const result = await verify({ 
            companyId: profile.activeCompanyId,
            integrationId: selectedIntegrationId,
            postalCode: zip, 
            country,
            city: '' 
          });
          
          console.log(`[handleZipBlur] Gotowa odpowiedź z Cloud Function:`, result.data);
          
          const data = result.data as any;
          if (data.suggestions?.length > 0) {
            setStatus('valid');
            setSuggestions(data.suggestions);
            setShow(true);
          } else if (data.valid) {
            setStatus('valid');
            setSuggestions([]);
          } else {
            setStatus('invalid');
            setSuggestions([]);
          }
      } catch (err) {
          console.error(`[handleZipBlur] BŁĄD przy weryfikacji adresu:`, err);
          setStatus('invalid');
      }
  };

  const handleAddressCheck = async () => {
    if (!profile?.activeCompanyId) return;
    setIsVerifyingAddr(true);
    setAddrCheckResult(null);
    try {
        const verifyDhlAddress = httpsCallable(functions, 'verifyDhlAddress');
        const res: any = await verifyDhlAddress({
            companyId: profile.activeCompanyId,
            zip: recipZip,
            city: recipCity,
            street: recipStreet
        });
        if (res.data.valid) {
            setAddrCheckResult(t('dhlNewShipment.alerts.addressOk'));
        } else {
            setAddrCheckResult(t('dhlNewShipment.alerts.addressInvalid'));
        }
    } catch (e: any) {
        setAddrCheckResult(t('dhlNewShipment.alerts.addressError') + e.message);
    } finally {
        setIsVerifyingAddr(false);
    }
  };

  const handleDiagnostic = async () => {
      if (!selectedIntegrationId) {
         setErrorMsg(t('dhlNewShipment.alerts.selectIntegration'));
         return;
      }
      try {
         setErrorMsg(''); setSuccessMsg('');
         const testDhlIntegration = httpsCallable(functions, 'testDhlIntegration');
         const res: any = await testDhlIntegration({ companyId: profile?.activeCompanyId, integrationId: selectedIntegrationId });
         if (res.data.success) {
             setSuccessMsg(t('dhlNewShipment.alerts.diagSuccess') + res.data.message);
         } else {
             setErrorMsg(t('dhlNewShipment.alerts.diagFail') + res.data.message);
         }
      } catch(e: any) {
         setErrorMsg(t('dhlNewShipment.alerts.diagError') + e.message);
      }
  };

  const handleGenerateLabel = async (selectedInteg: any) => {
     setShowValidationErrors(true);
     
     if (!recipStreet || !recipNumber || !recipZip || !recipCity) {
         return setErrorMsg(t('dhlNewShipment.alerts.missingAddress', 'Proszę uzupełnić wszystkie wymagane dane adresu odbiorcy (Ulica, Nr, Kod pocztowy, Miejscowość).'));
     }

     if (recipCountry === 'DE' && !/^\d{5}$/.test(recipZip.trim())) {
         return setErrorMsg(t('dhlNewShipment.alerts.invalidZipDe', 'Błąd: Kod pocztowy dla Niemiec (DE) musi składać się z dokładnie 5 cyfr.'));
     }

     let errorFound = null;
     for (const p of parcels) {
         if (!p.weight || parseFloat(p.weight) <= 0) errorFound = t('dhlNewShipment.alerts.weightRequired', 'Błąd: Waga każdej paczki musi być większa od zera.');
         if (!p.length || parseFloat(p.length) <= 0) errorFound = t('dhlNewShipment.alerts.lengthRequired', 'Błąd: Długość każdej paczki (cm) jest wymagana.');
         if (!p.width || parseFloat(p.width) <= 0) errorFound = t('dhlNewShipment.alerts.widthRequired', 'Błąd: Szerokość każdej paczki (cm) jest wymagana.');
         if (!p.height || parseFloat(p.height) <= 0) errorFound = t('dhlNewShipment.alerts.heightRequired', 'Błąd: Wysokość każdej paczki (cm) jest wymagana.');
         if (errorFound) break;
     }
     if (errorFound) return setErrorMsg(errorFound);

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
                     companyId: profile?.activeCompanyId,
                     integrationId: selectedInteg.id,
                     integrationSource: selectedInteg.source,
                     sender: { 
                        company: senderCompany, 
                        name: senderName,
                        street: senderStreet,
                        streetNumber: senderNumber,
                        zip: senderZip,
                        city: senderCity,
                        country: senderCountry
                     },
                     recipient: { company: recipCompany, name: recipName, phone: recipPhone, email: recipEmail, street: recipStreet, streetNumber: recipNumber, zip: recipZip, city: recipCity, country: recipCountry },
                     parcel: { weight: parseFloat(p.weight || '0'), length: parseFloat(p.length || '0'), width: parseFloat(p.width || '0'), height: parseFloat(p.height || '0') },
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
             setSuccessMsg(t('dhlNewShipment.alerts.labelSuccess') + ' ' + trackingNumbers.join(', '));
             setTimeout(() => navigate('/app/shipments'), 2500);
         }
         
         if (apiError) {
             setErrorMsg(t('dhlNewShipment.alerts.labelError') + apiError);
         }
     } catch(e: any) {
         setErrorMsg(t('dhlNewShipment.alerts.labelError') + e.message);
     } finally {
         setIsGenerating(false);
     }
  };

  if (loadingInitial) return <div className="p-8 text-center text-gray-500">{t('dhlNewShipment.loading')}</div>;

  const handleSwapAddresses = () => {
    setIsReturn(prev => {
        const next = !prev;
        if (next) {
            setRecipStreet('Johannes-R.-Becher-Straße');
            setRecipNumber('29');
            setRecipZip('02827');
            setRecipCity('Görlitz');
            setRecipCountry('DE');

            setSenderStreet(recipStreet);
            setSenderNumber(recipNumber);
            setSenderZip(recipZip);
            setSenderCity(recipCity);
            setSenderCountry(recipCountry || 'DE');
        } else {
            setSenderStreet('Johannes-R.-Becher-Straße');
            setSenderNumber('29');
            setSenderZip('02827');
            setSenderCity('Görlitz');
            setSenderCountry('DE');

            setRecipStreet(senderStreet);
            setRecipNumber(senderNumber);
            setRecipZip(senderZip);
            setRecipCity(senderCity);
            setRecipCountry(senderCountry || 'DE');
        }
        return next;
    });
  };

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-[1200px] mx-auto pb-32 relative">
       <AppTour run={runTour} steps={tourSteps} tourId="new_shipment_v1" eurReward={50} onFinish={handleTourFinish} />
       {selectedInteg?.sandboxMode && (
           <div className="bg-yellow-50 text-yellow-800 px-4 py-2 rounded-lg border border-yellow-200 text-xs font-bold flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-[16px]">warning</span>
              {t('dhlNewShipment.sandboxWarning')}
           </div>
       )}

       {errorMsg && <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 font-medium">{errorMsg}</div>}
       {successMsg && <div className="bg-green-50 text-green-700 p-4 rounded-xl border border-green-100 font-medium">{successMsg}</div>}

       <div className="flex flex-col gap-4">
          {/* GÓRNY PANEL: Nadawca & Odbiorca obok siebie */}
          <div id="tour-new-shipment-header" className="grid grid-cols-1 lg:grid-cols-2 gap-4 relative">
             
             {/* PRZYCISK ZAMIANY (wyśrodkowany absolutnie między kolumnami na desktopie) */}
             <div className="hidden lg:flex absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 bg-white rounded-full p-1.5 shadow-[0_0_20px_rgba(37,99,235,0.1)] border border-blue-50">
                 <button 
                     type="button" 
                     onClick={handleSwapAddresses} 
                     className="w-10 h-10 flex items-center justify-center text-blue-600 bg-blue-50 hover:bg-blue-600 hover:text-white rounded-full transition-all duration-300"
                     title="Zamień adresy"
                 >
                     <span className="material-symbols-outlined text-[22px]">sync_alt</span>
                 </button>
             </div>

             {/* NADAWCA */}
             <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 h-full flex flex-col hover:border-blue-100 transition-colors">
                 <div className="flex justify-between items-center mb-4">
                     <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                         <span className="material-symbols-outlined text-[16px]">storefront</span> {t('dhlNewShipment.sender.title')}
                     </h2>
                     {/* Przycisk widoczny tylko na mobile */}
                     <button type="button" onClick={handleSwapAddresses} className="lg:hidden w-8 h-8 flex items-center justify-center text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-full transition-colors">
                         <span className="material-symbols-outlined text-[18px]">sync_alt</span>
                     </button>
                 </div>
                 <div className="space-y-3 flex-1 flex flex-col">
                     <div className="flex gap-3">
                         <input type="text" placeholder={t('dhlNewShipment.sender.company')} value={senderCompany} onChange={e=>setSenderCompany(e.target.value)} className="w-3/5 bg-gray-50 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"/>
                         <input type="text" placeholder={t('dhlNewShipment.sender.name')} value={senderName} onChange={e=>setSenderName(e.target.value)} className="w-2/5 bg-gray-50 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"/>
                     </div>
                     <div className="flex gap-3">
                         <input type="text" placeholder={t('dhlNewShipment.sender.street')} value={senderStreet} onChange={e=>setSenderStreet(e.target.value)} disabled={!isReturn} className={`w-3/4 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow ${!isReturn ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-transparent' : 'bg-gray-50'}`}/>
                         <input type="text" placeholder={t('dhlNewShipment.sender.number')} value={senderNumber} onChange={e=>setSenderNumber(e.target.value)} disabled={!isReturn} className={`w-1/4 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow ${!isReturn ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-transparent' : 'bg-gray-50'}`}/>
                     </div>
                     <div className="flex gap-3">
                         <input type="text" placeholder={t('dhlNewShipment.sender.zip')} value={senderZip} onChange={e=>setSenderZip(e.target.value)} disabled={!isReturn} className={`w-1/3 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow ${!isReturn ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-transparent' : 'bg-gray-50'}`}/>
                         <input type="text" placeholder={t('dhlNewShipment.sender.city')} value={senderCity} onChange={e=>setSenderCity(e.target.value)} disabled={!isReturn} className={`w-2/3 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow ${!isReturn ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-transparent' : 'bg-gray-50'}`}/>
                     </div>
                     <div className="grid grid-cols-1 mt-auto pt-1">
                         <select value={senderCountry} onChange={e=>setSenderCountry(e.target.value)} disabled={!isReturn} className={`w-full rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-shadow ${!isReturn ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-transparent' : 'bg-gray-50'}`}>
                            {EU_COUNTRIES.map(code => (
                               <option key={code} value={code}>{getCountryName(code)}</option>
                            ))}
                         </select>
                     </div>
                 </div>
             </div>

             {/* ODBIORCA */}
             <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 h-full flex flex-col hover:border-red-100 transition-colors">
                 <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2"><span className="material-symbols-outlined text-[16px]">person</span> {t('dhlNewShipment.recipient.title')}</h2>
                    <div className="flex bg-gray-100 rounded-lg p-1">
                        <button onClick={()=>setRecipientType('address')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${recipientType==='address'?'bg-white shadow-sm text-[#b10024]':'text-gray-500 hover:text-gray-700'}`}>{t('dhlNewShipment.recipient.tabAddress')}</button>
                        <button onClick={()=>setRecipientType('pickup')} className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${recipientType==='pickup'?'bg-white shadow-sm text-[#b10024]':'text-gray-500 hover:text-gray-700'}`}>{t('dhlNewShipment.recipient.tabPickup')}</button>
                    </div>
                 </div>

                 {recipientType === 'address' ? (
                 <div className="space-y-3 flex-1 flex flex-col">
                     <div className="flex gap-3">
                         <input type="text" placeholder={t('dhlNewShipment.recipient.company')} value={recipCompany} onChange={e=>setRecipCompany(e.target.value)} className="w-1/2 bg-gray-50 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-red-500 outline-none transition-shadow"/>
                         <input type="text" placeholder={t('dhlNewShipment.recipient.name')} value={recipName} onChange={e=>setRecipName(e.target.value)} className="w-1/2 bg-gray-50 border border-transparent focus:bg-white rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-red-500 outline-none transition-shadow"/>
                     </div>
                     <div className="flex gap-3">
                         <input type="text" placeholder={t('dhlNewShipment.recipient.phone')} value={recipPhone} onChange={e=>setRecipPhone(e.target.value)} className="w-1/2 bg-gray-50 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-red-500 outline-none transition-shadow"/>
                         <input type="email" placeholder={t('dhlNewShipment.recipient.email')} value={recipEmail} onChange={e=>setRecipEmail(e.target.value)} className="w-1/2 bg-gray-50 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-red-500 outline-none transition-shadow"/>
                     </div>
                     <div className="flex gap-3">
                         <input type="text" placeholder={t('dhlNewShipment.recipient.street')} value={recipStreet} onChange={e=>setRecipStreet(e.target.value)} disabled={isReturn} className={`w-3/4 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-red-500 outline-none transition-shadow ${isReturn ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-transparent' : (!recipStreet && showValidationErrors ? 'bg-red-50 border border-red-500 placeholder-red-300' : 'bg-gray-50 border border-transparent')}`}/>
                         <input type="text" placeholder={t('dhlNewShipment.recipient.number')} value={recipNumber} onChange={e=>setRecipNumber(e.target.value)} disabled={isReturn} className={`w-1/4 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-red-500 outline-none transition-shadow ${isReturn ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-transparent' : (!recipNumber && showValidationErrors ? 'bg-red-50 border border-red-500 placeholder-red-300' : 'bg-gray-50 border border-transparent')}`}/>
                     </div>
                     <div className="flex gap-3">
                         <div className="relative w-1/3">
                            <input type="text" placeholder={t('dhlNewShipment.recipient.zip')} value={recipZip} onChange={e=>{setRecipZip(e.target.value); setRecipZipStatus('idle'); setShowRecipSuggestions(false); }} onBlur={handleZipBlur} disabled={isReturn} className={`w-full transition-shadow rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-red-500 outline-none ${isReturn ? 'bg-gray-100 text-gray-400 cursor-not-allowed border-transparent' : (!recipZip && showValidationErrors ? 'bg-red-50 border border-red-500 placeholder-red-300' : (recipZipStatus === 'valid' ? 'border border-green-500 bg-green-50' : recipZipStatus === 'invalid' ? 'border border-red-500 bg-red-50' : recipZipStatus === 'loading' ? 'border border-yellow-400 bg-yellow-50' : 'bg-gray-50 border border-transparent'))}`}/>
                            {recipZipStatus === 'loading' && <span className="absolute right-3 top-2.5 material-symbols-outlined animate-spin text-yellow-500 text-[18px]">refresh</span>}
                         </div>
                         <div className="relative w-2/3">
                            <input type="text" placeholder={t('dhlNewShipment.recipient.city')} value={recipCity} onChange={e=>setRecipCity(e.target.value)} disabled={isReturn} className={`w-full rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-red-500 outline-none transition-shadow ${isReturn ? 'bg-gray-100 text-gray-400 cursor-not-allowed border-transparent' : (!recipCity && showValidationErrors ? 'bg-red-50 border border-red-500 placeholder-red-300' : 'bg-gray-50 border border-transparent')}`}/>
                            {showRecipSuggestions && recipCitySuggestions.length > 0 && !isReturn && (
                              <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                                {recipCitySuggestions.map((city) => (
                                  <button key={city} type="button" className="w-full text-left px-4 py-2 hover:bg-red-50 hover:text-[#b10024] text-sm font-medium transition-colors" onClick={() => { setRecipCity(city); setShowRecipSuggestions(false); setRecipZipStatus('valid'); }}>
                                    {city}
                                  </button>
                                ))}
                              </div>
                            )}
                         </div>
                     </div>
                     
                     <div className="mt-auto pt-1 grid grid-cols-1 gap-3">
                         <select value={recipCountry} onChange={e=>setRecipCountry(e.target.value)} disabled={isReturn} className={`w-full rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-red-500 outline-none font-bold text-gray-700 transition-shadow ${isReturn ? 'bg-gray-100 text-gray-400 cursor-not-allowed border border-transparent' : 'bg-gray-50'}`}>
                             {EU_COUNTRIES.map(code => (
                                 <option key={code} value={code}>{getCountryName(code)}</option>
                             ))}
                         </select>
                         
                         <button onClick={handleAddressCheck} disabled={isVerifyingAddr || !recipCity || !recipZip} type="button" className="w-full py-2 rounded-xl border border-dashed border-gray-300 text-gray-500 font-bold text-[11px] hover:border-[#b10024] hover:bg-red-50 hover:text-[#b10024] transition-all flex justify-center items-center gap-1.5 uppercase tracking-wide">
                            {isVerifyingAddr ? <span className="material-symbols-outlined animate-spin text-[16px]">refresh</span> : <span className="material-symbols-outlined text-[16px]">location_on</span>}
                            {t('dhlNewShipment.recipient.addressCheck', 'ADDRESS CHECK DHL')}
                         </button>
                         {addrCheckResult && <p className={`text-[11px] font-bold text-center -mt-1.5 ${addrCheckResult.includes(t('dhlNewShipment.alerts.addressInvalid')) ? 'text-red-500' : 'text-[#0A3D91]'}`}>{addrCheckResult}</p>}
                     </div>
                 </div>
                 ) : (
                    <div className="text-sm text-gray-500 p-4 bg-gray-50 rounded-xl text-center border border-dashed border-gray-200 flex-1 flex flex-col justify-center">
                       {t('dhlNewShipment.recipient.pickupNotReady')}
                    </div>
                 )}
             </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-50">
             {/* PARAMETRY I ZAWARTOŚĆ PACZEK (MULTIPACZKI) */}
             <div className="p-5 w-full">
                 <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">inventory_2</span> {t('dhlNewShipment.parcel.title', 'Parametry i Zawartość Paczek')}
                 </h2>
                 
                 <div className="flex flex-col gap-4">
                    {parcels.map((parcel, index) => (
                       <div key={parcel.id} className="flex flex-col xl:flex-row gap-4 items-start w-full border border-gray-100 rounded-xl p-4 bg-gray-50/30 relative shadow-sm">
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
                                      <div key={i} className="flex items-center gap-1 bg-white border border-gray-200 rounded-md px-2 py-1 shadow-sm">
                                         <span className="text-[10px] font-bold">{sp.sku}</span>
                                         <input type="number" min="1" max={sp.stock} value={sp.issuedQty} onChange={e => {
                                            const val = Math.min(parseInt(e.target.value) || 1, sp.stock);
                                            const newParcels = [...parcels];
                                            newParcels[index].selectedProducts[i].issuedQty = val;
                                            setParcels(newParcels);
                                         }} className="w-10 text-[10px] bg-gray-50 border border-gray-200 rounded px-1 text-center font-bold" />
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
                          <div className="w-full xl:w-48">
                             <label className="text-[9px] font-bold text-gray-500 mb-1 block uppercase">{t('dhlNewShipment.contents.referenceLabel', 'NR REF')}</label>
                             <input type="text" value={parcel.reference} onChange={e => setParcels(parcels.map(p => p.id === parcel.id ? {...p, reference: e.target.value} : p))} className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none" />
                          </div>

                          {/* Akcja dodaj/usuń paczkę */}
                          <div className="flex items-center justify-end xl:mt-5 shrink-0">
                             {index === parcels.length - 1 ? (
                                <button type="button" onClick={() => {
                                   setParcels([...parcels, {
                                      id: crypto.randomUUID(),
                                      weight: '1', length: '10', width: '10', height: '10',
                                      reference: parcel.reference, // Default to previous ref
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

             {/* USUNIĘTO: ZAZNACZONA INTEGRACJA */}
          </div>
       </div>

       {/* GŁÓWNY PANEL ZAPISU - KURIERZY */}
       <div id="tour-new-shipment-bottom" className="fixed bottom-0 left-0 lg:left-[80px] w-full lg:w-[calc(100%-80px)] bg-white border-t border-gray-200 p-4 sm:p-6 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-40 flex flex-col items-center gap-4 shrink-0">
          <div className="flex flex-wrap items-center justify-center gap-4 w-full">
             {integrations.length === 0 && (
                 <p className="text-red-500 font-bold">{t('shipments.noCarriersAvailable', 'Brak dostępnych kurierów — skontaktuj się z administratorem')}</p>
             )}
              {integrations.map(inte => {
                 const est = estimates[inte.id];
                 return (
                 <button 
                    key={inte.id}
                    onClick={() => handleGenerateLabel(inte)}
                    disabled={isGenerating || !recipName || !recipZip || parcels.length === 0}
                    className={`p-4 px-8 shadow-lg rounded-xl font-bold tracking-wide flex items-center justify-center gap-3 transition-all disabled:opacity-50 disabled:shadow-none ${
                        inte.source === 'global' ? 
                           (inte.type === 'gls_de' ? 'bg-[#001489] hover:bg-[#000e60] text-white shadow-blue-900/30' : 'bg-[#FFCC00] hover:bg-[#E6B800] text-[#D40511] shadow-yellow-500/30') 
                           : 'bg-[#0A3D91] hover:bg-[#082a63] text-white shadow-blue-500/30'
                    }`}
                 >
                    {isGenerating ? <span className="material-symbols-outlined animate-spin">refresh</span> : <span className="material-symbols-outlined">print</span>}
                    <div className="flex flex-col text-left">
                        <span className="uppercase">{inte.source === 'global' && inte.type === 'gls_de' && inte.customName === 'GEPARD' ? 'GLS DE (GEPARD)' : inte.customName}</span>
                        {inte.sandboxMode && <span className="text-[10px] lowercase opacity-80 leading-none mt-0.5">sandbox</span>}
                        {inte.source === 'global' && (
                          <div className="text-xs font-normal mt-1 opacity-90">
                             {est?.loading ? (
                               <span className="animate-pulse">Wyceniam...</span>
                             ) : est?.error ? (
                               <span className="text-red-200">{est.error}</span>
                             ) : est?.price != null ? (
                               <span>{est.price.toFixed(2)} {est.currency}</span>
                             ) : (
                               <span>---</span>
                             )}
                          </div>
                        )}
                    </div>
                 </button>
              )})}
           </div>
        </div>
     </div>
  );
}
