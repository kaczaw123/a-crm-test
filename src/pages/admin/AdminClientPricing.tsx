import React, { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { functions, functionsEU, db } from '../../firebase/config';
import { useAuth } from '../../auth/useAuth';
import type { ClientPricing, PriceListPricing } from '../../types/clientPricing';
import type { CarrierPriceList } from '../../types/billing';
import { ClientPriceListCard } from '../../components/admin/billing/ClientPriceListCard';
import { Settings, ArrowLeft, Check, Loader2 } from 'lucide-react';

export default function AdminClientPricing() {
  const { user } = useAuth();
  
  const [companiesList, setCompaniesList] = useState<{id: string, name: string, code?: string}[]>([]);
  const [carriersList, setCarriersList] = useState<{id: string, name: string}[]>([]);
  const [allPricings, setAllPricings] = useState<Record<string, ClientPricing>>({});
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Editor mode state
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingCarrierId, setEditingCarrierId] = useState<string | null>(null);
  const [contractId, setContractId] = useState<string>('');
  const [contractsList, setContractsList] = useState<{id: string, name: string}[]>([]);
  const [priceLists, setPriceLists] = useState<Record<string, CarrierPriceList>>({});

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        // 1. Fetch companies
        const snap = await getDocs(collection(db, 'companies'));
        const list = snap.docs.map(doc => ({ id: doc.id, name: doc.data().name || doc.id, code: doc.data().companyCode }));
        list.sort((a, b) => {
          const codeA = a.code || '';
          const codeB = b.code || '';
          if (codeA && !codeB) return -1;
          if (!codeA && codeB) return 1;
          if (codeA && codeB) return codeB.localeCompare(codeA);
          return a.name.localeCompare(b.name);
        });
        setCompaniesList(list);

        // 2. Fetch carriers
        const listCarriersFn = httpsCallable(functions, 'listCarriers');
        const carriersRes: any = await listCarriersFn({});
        const cList = carriersRes.data.carriers || [];
        setCarriersList(cList);

        // 3. Fetch active pricings for all companies
        const pricingPromises = list.map(c => getDocs(query(collection(db, 'companies', c.id, 'pricing'), where('status', '==', 'active'))));
        const pricingSnaps = await Promise.all(pricingPromises);
        
        const tempPricings: Record<string, ClientPricing> = {};
        pricingSnaps.forEach((psnap, idx) => {
           if (!psnap.empty) {
               tempPricings[list[idx].id] = psnap.docs[0].data() as ClientPricing;
           } else {
               tempPricings[list[idx].id] = {
                   id: '',
                   companyId: list[idx].id,
                   version: 0,
                   status: 'active',
                   shippingPricing: {},
                   fulfillmentPricing: { storageRatePerM3PerMonth: 0, packingFeePerOrder: 0, currency: 'EUR' },
                   validFrom: null,
                   createdBy: '',
                   createdAt: null
               } as unknown as ClientPricing;
           }
        });
        setAllPricings(tempPricings);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const toggleCarrierActive = async (companyId: string, carrierId: string) => {
    const currentPricing = allPricings[companyId];
    if (!currentPricing) return;

    const currentShipping = currentPricing.shippingPricing?.[carrierId] || { mode: 'no_markup' };
    const newIsActive = !(currentShipping.isActive === true);

    const updatedPricing = {
       ...currentPricing,
       shippingPricing: {
         ...(currentPricing.shippingPricing || {}),
         [carrierId]: {
            ...currentShipping,
            isActive: newIsActive
         }
       }
    };

    setAllPricings(prev => ({ ...prev, [companyId]: updatedPricing }));
    setError(null);
    setSuccess(null);

    try {
      const saveFn = httpsCallable(functionsEU, 'saveClientPricing');
      const res = await saveFn({ companyId, pricing: updatedPricing }) as any;
      setAllPricings(prev => ({
         ...prev,
         [companyId]: {
            ...updatedPricing,
            id: res.data.id,
            version: res.data.version
         }
      }));
    } catch(err: any) {
      setAllPricings(prev => ({ ...prev, [companyId]: currentPricing }));
      setError("Nie udało się zapisać zmiany widoczności: " + err.message);
    }
  };

  const openEditor = async (compId: string, carrId: string) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const fn = httpsCallable(functions, 'listCarrierContracts');
      const res: any = await fn({ carrierId: carrId });
      const cList = res.data.contracts || [];
      setContractsList(cList);
      
      let cId = '';
      if (cList.length > 0) {
          cId = cList[0].id;
          setContractId(cId);
      } else {
          setContractId('');
      }

      if (cId) {
          await loadContractPriceLists(cId);
      } else {
          setPriceLists({});
      }

      setEditingCompanyId(compId);
      setEditingCarrierId(carrId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadContractPriceLists = async (cId: string) => {
    const plSnap = await getDocs(collection(db, 'carrierContracts', cId, 'priceLists'));
    const plData: Record<string, CarrierPriceList> = {};
    plSnap.forEach(doc => {
      plData[doc.id] = doc.data() as CarrierPriceList;
    });
    setPriceLists(plData);
  };

  const closeEditor = () => {
    setEditingCompanyId(null);
    setEditingCarrierId(null);
    setContractId('');
    setContractsList([]);
    setPriceLists({});
    setError(null);
    setSuccess(null);
  };

  const handleContractChange = async (newContractId: string) => {
    setContractId(newContractId);
    setLoading(true);
    try {
      await loadContractPriceLists(newContractId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEditor = async () => {
    if (!editingCompanyId || !editingCarrierId) return;
    const pricingToSave = allPricings[editingCompanyId];
    if (!pricingToSave) return;

    setLoading(true);
    setSuccess(null);
    setError(null);
    try {
      const saveFn = httpsCallable(functionsEU, 'saveClientPricing');
      const res = await saveFn({ companyId: editingCompanyId, pricing: pricingToSave }) as any;
      
      setAllPricings(prev => ({
        ...prev,
        [editingCompanyId]: {
           ...pricingToSave,
           id: res.data.id,
           version: res.data.version
        }
     }));
      setSuccess('Zapisano pomyślnie. Ceny zaktualizowane.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const updatePriceListPricing = (plId: string, plPricing: PriceListPricing) => {
    if (!editingCompanyId || !editingCarrierId) return;
    const pricing = allPricings[editingCompanyId];
    if (!pricing) return;

    const currentShipping = pricing.shippingPricing?.[editingCarrierId] || { mode: 'no_markup' };
    const currentPriceLists = currentShipping.priceLists || {};
    
    const updatedPricing = {
      ...pricing,
      shippingPricing: {
        ...(pricing.shippingPricing || {}),
        [editingCarrierId]: {
          ...currentShipping,
          priceLists: {
            ...currentPriceLists,
            [plId]: plPricing
          }
        }
      }
    };
    setAllPricings(prev => ({ ...prev, [editingCompanyId]: updatedPricing }));
  };

  if (loading && companiesList.length === 0) {
    return <div className="p-8 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-500"/></div>;
  }

  // --- EDITOR VIEW ---
  if (editingCompanyId && editingCarrierId) {
    const compName = companiesList.find(c => c.id === editingCompanyId)?.name || editingCompanyId;
    const carrName = carriersList.find(c => c.id === editingCarrierId)?.name || editingCarrierId;
    const pricing = allPricings[editingCompanyId];

    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={closeEditor} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Ustawienia Cen: {compName}</h1>
            <p className="text-sm text-gray-500">Kurier: <span className="font-semibold text-gray-700">{carrName}</span></p>
          </div>
        </div>

        {error && <div className="bg-red-50 text-red-700 p-4 rounded-md">{error}</div>}
        {success && <div className="bg-green-50 text-green-700 p-4 rounded-md">{success}</div>}

        <div className="bg-white p-4 shadow rounded-lg border border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-1">Contract ID</label>
          <select 
             className="w-full md:w-1/3 border-gray-300 rounded-md shadow-sm sm:text-sm" 
             value={contractId} 
             onChange={(e) => handleContractChange(e.target.value)}
             disabled={loading}
          >
            <option value="" disabled>Wybierz kontrakt</option>
            {contractsList.map((c: any) => (
              <option key={c.id} value={c.id}>{c.name || c.id}</option>
            ))}
          </select>
        </div>

        {loading ? <div className="p-4 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-500"/></div> : (
          pricing && Object.keys(priceLists).length > 0 ? (
            <div className="space-y-6">
              <div className="flex justify-between items-center bg-gray-50 p-4 rounded-lg border border-gray-200">
                <div>
                  <h2 className="text-lg font-medium text-gray-900">Narzuty dla Firmy (Wersja: {pricing.version || 'Nowa'})</h2>
                  <p className="text-sm text-gray-500">Modyfikujesz ustawienia dla kontraktu <span className="font-mono">{contractId}</span></p>
                </div>
                <button onClick={handleSaveEditor} disabled={loading} className="px-6 py-2 bg-green-600 text-white rounded-md text-sm font-bold shadow-sm hover:bg-green-700 disabled:opacity-50 transition-colors">
                  Zapisz jako Nową Wersję
                </button>
              </div>

              <div className="grid grid-cols-1 gap-6">
                {Object.entries(priceLists).map(([plId, plData]) => (
                  <ClientPriceListCard
                    key={plId}
                    priceListId={plId}
                    priceList={plData}
                    pricing={pricing.shippingPricing?.[editingCarrierId]?.priceLists?.[plId]}
                    onChange={(newPricing) => updatePriceListPricing(plId, newPricing)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-500 p-8 bg-gray-50 rounded-xl border border-dashed border-gray-300">
              Brak cenników dla wybranego kontraktu.
            </div>
          )
        )}
      </div>
    );
  }

  // --- TABLE VIEW ---
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Zarządzanie Cennikami Klientów</h1>
        <p className="text-sm text-gray-500">Aktywuj dostęp i ustawiaj cenniki kurierów dla poszczególnych firm.</p>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-4 rounded-md">{error}</div>}
      
      <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-gray-600">
            <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-4 font-semibold w-32">Nr Klienta</th>
                <th className="px-4 py-4 font-semibold w-1/3">Firma (Klient)</th>
                {carriersList.map(c => (
                  <th key={c.id} className="px-4 py-4 font-semibold text-center whitespace-nowrap">
                    {c.name || c.id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {companiesList.map(comp => (
                <tr key={comp.id} className="hover:bg-blue-50/30 transition-colors">
                  <td className="px-4 py-4 font-medium font-mono text-gray-900 border-r border-gray-50 align-middle">
                    {comp.code || '-'}
                  </td>
                  <td className="px-4 py-4 font-medium text-gray-900 border-r border-gray-50">
                    <div className="flex flex-col">
                      <span>{comp.name}</span>
                      <span className="text-[10px] text-gray-400 font-mono">{comp.id}</span>
                    </div>
                  </td>
                  {carriersList.map(carrier => {
                    const pr = allPricings[comp.id]?.shippingPricing?.[carrier.id];
                    const isActive = pr?.isActive === true;
                    
                    return (
                      <td key={carrier.id} className="px-4 py-3 border-r border-gray-50 last:border-0 align-middle">
                        <div className="flex items-center justify-center gap-3">
                          <button 
                              onClick={() => toggleCarrierActive(comp.id, carrier.id)}
                              title={isActive ? "Wyłącz dla klienta" : "Włącz dla klienta"}
                              className={`w-11 h-6 rounded-full relative transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 ${isActive ? 'bg-green-500' : 'bg-gray-200'}`}
                          >
                            <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-200 flex items-center justify-center ${isActive ? 'translate-x-5' : 'translate-x-0'}`}>
                                {isActive && <Check className="w-3 h-3 text-green-500" />}
                            </div>
                          </button>
                          
                          <button 
                              onClick={() => openEditor(comp.id, carrier.id)}
                              title="Ustaw ceny"
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                          >
                             <Settings className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {companiesList.length === 0 && !loading && (
                <tr>
                  <td colSpan={carriersList.length + 2} className="p-8 text-center text-gray-400 italic">
                    Brak firm w systemie.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
