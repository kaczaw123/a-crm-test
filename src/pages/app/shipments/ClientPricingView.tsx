import React, { useState, useEffect, useMemo } from 'react';
import { db, functionsEU } from '../../../firebase/config';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../../../auth/useAuth';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Truck, Package } from 'lucide-react';

function applyMarkup(amount: number, mode: string, value: number) {
  if (mode === 'cost_plus_percent') return amount + (amount * value) / 100;
  if (mode === 'cost_plus_fixed') return amount + value;
  if (mode === 'absolute_fixed') return value;
  if (mode === 'no_markup') return amount;
  return amount;
}

export default function ClientPricingView() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [contracts, setContracts] = useState<any[]>([]);
  const [clientPricing, setClientPricing] = useState<any>(null);
  const [selectedCarrier, setSelectedCarrier] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!profile?.activeCompanyId) return;
      try {
        const getActiveClientPricing = httpsCallable(functionsEU, 'getActiveClientPricing');
        const res: any = await getActiveClientPricing({ companyId: profile.activeCompanyId });
        if (res.data.found) {
          setClientPricing(res.data);
        }
        setContracts(res.data.contracts || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [profile?.activeCompanyId]);

  useEffect(() => {
    if (clientPricing && contracts.length > 0 && !selectedCarrier) {
      const activeContract = contracts.find(c => clientPricing.shippingPricing?.[c.carrierId]?.isActive !== false);
      if (activeContract) {
        setSelectedCarrier(activeContract.carrierId);
      }
    }
  }, [clientPricing, contracts, selectedCarrier]);

  if (loading) return <div className="p-8 text-center text-gray-500">{t('pricing.loading', 'Wczytywanie cennika...')}</div>;

  if (!clientPricing) {
    return (
      <div className="p-8 max-w-4xl mx-auto text-center">
        <div className="bg-blue-50 p-6 rounded-xl border border-blue-100 shadow-sm">
          <Truck className="w-12 h-12 text-blue-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-800 mb-2">{t('pricing.notConfigured.title', 'Twój cennik nie został jeszcze skonfigurowany')}</h2>
          <p className="text-gray-600">{t('pricing.notConfigured.desc', 'Skontaktuj się z administratorem, aby otrzymać indywidualną wycenę usług.')}</p>
        </div>
      </div>
    );
  }

  const getBaseMarkup = (priceListId: string, carrierId: string) => {
    const carrierPricing = clientPricing.shippingPricing?.[carrierId];
    if (!carrierPricing) return { mode: 'no_markup', value: 0 };
    
    const plPricing = carrierPricing.priceLists?.[priceListId];
    if (plPricing) {
      return { 
        mode: plPricing.baseMode || carrierPricing.mode || 'no_markup', 
        value: plPricing.baseValue ?? carrierPricing.value ?? 0 
      };
    }
    return { mode: carrierPricing.mode || 'no_markup', value: carrierPricing.value || 0 };
  };

  const getMarkupForService = (priceListId: string, carrierId: string, serviceCode: string, isBasePrice = false) => {
    const carrierPricing = clientPricing.shippingPricing?.[carrierId];
    if (!carrierPricing) return { mode: 'no_markup', value: 0 };
    
    const plPricing = carrierPricing.priceLists?.[priceListId];
    if (plPricing) {
      const override = plPricing.serviceOverrides?.[serviceCode];
      if (override) return { mode: override.mode, value: override.value };
      
      if (isBasePrice) {
        return { 
          mode: plPricing.baseMode || carrierPricing.mode || 'no_markup', 
          value: plPricing.baseValue ?? carrierPricing.value ?? 0 
        };
      }
      return { 
        mode: plPricing.surchargesMode || plPricing.baseMode || carrierPricing.mode || 'no_markup', 
        value: plPricing.surchargesValue ?? plPricing.baseValue ?? carrierPricing.value ?? 0 
      };
    }
    return { mode: carrierPricing.mode || 'no_markup', value: carrierPricing.value || 0 };
  };

  const activeContracts = contracts.filter(c => clientPricing.shippingPricing?.[c.carrierId]?.isActive !== false);
  const selectedContract = activeContracts.find(c => c.carrierId === selectedCarrier);

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-2">{t('pricing.title', 'Mój Cennik')}</h1>
        <p className="text-gray-500">{t('pricing.subtitle', 'Wybierz kuriera poniżej, aby wyświetlić dedykowane stawki i usługi dodatkowe.')}</p>
      </div>

      {/* CARRIER SELECTOR BUTTONS */}
      {activeContracts.length > 0 ? (
        <div className="flex flex-wrap gap-4">
          {activeContracts.map(contract => {
            const isSelected = selectedCarrier === contract.carrierId;
            return (
              <button
                key={contract.carrierId}
                onClick={() => setSelectedCarrier(contract.carrierId)}
                className={`flex items-center gap-3 px-6 py-4 rounded-2xl border-2 font-bold text-lg transition-all duration-200 ${
                  isSelected 
                    ? 'border-blue-600 bg-blue-50/50 text-blue-700 shadow-sm transform scale-[1.02]' 
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <Truck className={`w-6 h-6 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`} />
                {contract.name || contract.carrierId.toUpperCase()}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="text-gray-500 italic">Brak aktywnych cenników kurierów.</div>
      )}

      {/* SELECTED CARRIER PRICE LISTS */}
      {selectedContract && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {selectedContract.priceLists.map((pl: any) => {
            const baseMu = getBaseMarkup(pl.id, selectedContract.carrierId);
            
            return (
              <PriceListCard 
                key={pl.id} 
                pl={pl} 
                baseMu={baseMu} 
                carrierId={selectedContract.carrierId}
                getMarkupForService={getMarkupForService}
                t={t}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
// Komponent dla pojedynczego cennika (np. EuroBusinessParcel)
// ----------------------------------------------------------------------
function PriceListCard({ pl, baseMu, carrierId, getMarkupForService, t }: { pl: any, baseMu: any, carrierId: string, getMarkupForService: any, t: any }) {
  const [expandedZones, setExpandedZones] = useState<Record<string, boolean>>({});

  const toggleZone = (zoneCode: string) => {
    setExpandedZones(prev => ({ ...prev, [zoneCode]: !prev[zoneCode] }));
  };

  const groupedPrices = useMemo(() => {
    return (pl.prices || []).reduce((acc: any, p: any) => {
      if (!acc[p.zoneCode]) acc[p.zoneCode] = [];
      acc[p.zoneCode].push(p);
      return acc;
    }, {} as Record<string, any[]>);
  }, [pl.prices]);

  const sortedZones = Object.keys(groupedPrices).sort();

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="bg-gradient-to-r from-gray-50 to-white border-b border-gray-200 p-5 flex items-center gap-3">
        <Package className="w-5 h-5 text-gray-500" />
        <h3 className="font-extrabold text-lg text-gray-800">{pl.name || pl.id}</h3>
      </div>

      {/* TABELA BAZOWYCH - Z GRUPOWANIEM */}
      <div className="p-0">
        <div className="px-5 py-4 bg-white">
          <h4 className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-1">{t('pricing.baseRates', 'Stawki bazowe')}</h4>
          <p className="text-sm text-gray-500">Kliknij wybrane państwo, aby rozwinąć tabelę przedziałów wagowych.</p>
        </div>
        
        <div className="w-full">
          {sortedZones.map(zoneCode => {
            const isExpanded = expandedZones[zoneCode];
            const prices = groupedPrices[zoneCode];
            
            return (
              <div key={zoneCode} className="border-t border-gray-100 last:border-b">
                {/* Wiersz Państwa */}
                <button 
                  onClick={() => toggleZone(zoneCode)}
                  className={`w-full flex items-center justify-between p-4 transition-colors ${isExpanded ? 'bg-blue-50/30' : 'hover:bg-gray-50 bg-white'}`}
                >
                  <span className="font-bold text-gray-800 text-[15px]">
                    {t(`countries.${zoneCode}`, { defaultValue: zoneCode }) as string}
                  </span>
                  <div className="flex items-center gap-3 text-gray-400">
                    <span className="text-xs font-medium bg-gray-100 px-2 py-1 rounded-full text-gray-600">
                      {prices.length} przedziałów
                    </span>
                    {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </div>
                </button>

                {/* Rozwinięte przedziały */}
                {isExpanded && (
                  <div className="bg-gray-50/50 p-4 border-t border-gray-100">
                    <table className="w-full text-sm">
                      <thead className="text-gray-500 text-xs text-left border-b border-gray-200">
                        <tr>
                          <th className="pb-2 font-medium">{t('pricing.weightBand', 'Pasmo wagowe')}</th>
                          <th className="pb-2 font-medium text-right">{t('pricing.priceWithMarkup', 'Cena')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100/50">
                        {prices.map((p: any, idx: number) => {
                          const code = `BASE_${p.zoneCode}_${p.weightTo}_${p.serviceCode || 'STANDARD'}`;
                          const mu = getMarkupForService(pl.id, carrierId, code, true);
                          const clientPrice = applyMarkup(p.basePrice, mu.mode, mu.value);
                          const display = p.pricePerKg != null
                            ? `${clientPrice.toFixed(2)} + ${(p.pricePerKg * (1 + (mu.mode === 'cost_plus_percent' ? mu.value/100 : 0))).toFixed(2)}/kg`
                            : `${clientPrice.toFixed(2)} ${p.currency}`;
                            
                          return (
                            <tr key={idx} className="hover:bg-white transition-colors">
                              <td className="py-2.5 text-gray-700 font-medium">
                                {p.weightFrom} – {p.weightTo} kg
                                {p.serviceCode !== 'STANDARD' && <span className="ml-2 text-[10px] bg-white border border-gray-200 px-1.5 py-0.5 rounded-md text-gray-400">{p.serviceCode}</span>}
                              </td>
                              <td className="py-2.5 text-right font-mono font-semibold text-gray-900">{display}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* TABELA DOPŁAT */}
      <div className="p-5 border-t border-gray-200 bg-white mt-4">
        <h4 className="text-xs font-bold tracking-widest uppercase text-gray-400 mb-3">{t('pricing.surcharges', 'Usługi i opłaty dodatkowe')}</h4>
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs">
              <tr>
                <th className="p-3 text-left font-medium">{t('pricing.code', 'Kod')}</th>
                <th className="p-3 text-left font-medium">{t('pricing.name', 'Nazwa')}</th>
                <th className="p-3 text-left font-medium">{t('pricing.category', 'Kategoria')}</th>
                <th className="p-3 text-right font-medium">{t('pricing.priceWithMarkup', 'Cena')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(pl.services || []).filter((s: any) => s.category !== 'penalty' && s.category !== 'base').map((s: any) => {
                const mu = getMarkupForService(pl.id, carrierId, s.code);
                const clientPrice = s.basePrice != null ? applyMarkup(s.basePrice, mu.mode, mu.value) : null;
                const display = clientPrice != null
                  ? `${clientPrice.toFixed(2)} ${pl.prices?.[0]?.currency || 'EUR'}`
                  : (s.percent != null ? `${s.percent} ${t('pricing.percentOfBase', '% bazy')}` : t('pricing.variable', 'zmienne'));
                  
                return (
                  <tr key={s.code} className="hover:bg-gray-50 transition-colors">
                    <td className="p-3 font-mono text-xs text-gray-500">{s.code}</td>
                    <td className="p-3 font-medium text-gray-800">{s.name}</td>
                    <td className="p-3 text-xs">
                      <span className={`px-2 py-1 rounded-md text-[10px] font-semibold ${
                        s.category === 'mandatory' ? 'bg-red-50 text-red-700 border border-red-100' :
                        s.category === 'conditional' ? 'bg-yellow-50 text-yellow-700 border border-yellow-100' :
                        'bg-green-50 text-green-700 border border-green-100'
                      }`}>{s.category || 'optional'}</span>
                    </td>
                    <td className="p-3 text-right font-mono font-semibold text-gray-900">{display}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
