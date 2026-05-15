import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/useAuth';
import { functions } from '../../firebase/config';
import { httpsCallable } from 'firebase/functions';
import { Plus, Edit2, Loader2, Truck, FileText, ListOrdered, Trash2, Copy } from 'lucide-react';
import { CarrierFormModal } from '../../components/admin/billing/CarrierFormModal';
import { ContractFormModal } from '../../components/admin/billing/ContractFormModal';
import { PriceListEditor } from '../../components/admin/billing/PriceListEditor';
import { CarrierSurchargesPanel } from '../../components/admin/billing/CarrierSurchargesPanel';
import { useSearchParams } from 'react-router-dom';
import type { Carrier, CarrierContract, CarrierPriceList } from '../../types/billing';

export default function AdminCarrierContracts() {
  const { profile } = useAuth();
  const isSuperadmin = (profile as any)?.globalRole === 'superadmin' || (profile as any)?.platformRole === 'SUPER_ADMIN';

  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [contracts, setContracts] = useState<CarrierContract[]>([]);
  const [priceLists, setPriceLists] = useState<CarrierPriceList[]>([]);

  const [selectedCarrierId, setSelectedCarrierId] = useState<string | null>(null);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);

  const [loadingCarriers, setLoadingCarriers] = useState(false);
  const [loadingContracts, setLoadingContracts] = useState(false);
  const [loadingPriceLists, setLoadingPriceLists] = useState(false);

  const [carrierModalOpen, setCarrierModalOpen] = useState(false);
  const [editingCarrier, setEditingCarrier] = useState<Carrier | null>(null);
  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [editingContract, setEditingContract] = useState<CarrierContract | null>(null);
  const [priceListEditingFromExisting, setPriceListEditingFromExisting] = useState<CarrierPriceList | null>(null);
  const [priceListEditMode, setPriceListEditMode] = useState<'copy' | 'edit'>('copy');
  const [priceListEditorOpen, setPriceListEditorOpen] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'surcharges' ? 'surcharges' : 'contracts';
  const setView = (v: 'contracts' | 'surcharges') => {
    const next = new URLSearchParams(searchParams);
    if (v === 'surcharges') next.set('view', 'surcharges'); else next.delete('view');
    setSearchParams(next);
  };

  // Load carriers
  const loadCarriers = async () => {
    setLoadingCarriers(true);
    try {
      const fn = httpsCallable(functions, 'listCarriers');
      const res: any = await fn({});
      setCarriers(res.data.carriers || []);
    } catch (err) { console.error(err); }
    finally { setLoadingCarriers(false); }
  };

  // Load contracts for selected carrier
  const loadContracts = async (carrierId: string) => {
    setLoadingContracts(true);
    try {
      const fn = httpsCallable(functions, 'listCarrierContracts');
      const res: any = await fn({ carrierId });
      setContracts(res.data.contracts || []);
    } catch (err) { console.error(err); }
    finally { setLoadingContracts(false); }
  };

  // Load price lists for selected contract
  const loadPriceLists = async (contractId: string) => {
    setLoadingPriceLists(true);
    try {
      const fn = httpsCallable(functions, 'listPriceListsForContract');
      const res: any = await fn({ contractId });
      setPriceLists(res.data.priceLists || []);
    } catch (err) { console.error(err); }
    finally { setLoadingPriceLists(false); }
  };

  useEffect(() => { if (isSuperadmin) loadCarriers(); }, [isSuperadmin]);
  useEffect(() => { if (selectedCarrierId) loadContracts(selectedCarrierId); else setContracts([]); }, [selectedCarrierId]);
  useEffect(() => { if (selectedContractId) loadPriceLists(selectedContractId); else setPriceLists([]); }, [selectedContractId]);

  if (!isSuperadmin) {
    return <div className="p-8 text-center text-gray-500">Brak uprawnień. Dostęp tylko dla SUPER ADMIN.</div>;
  }

  const formatTimestamp = (ts: any) => {
    if (!ts) return '—';
    try {
      const d = ts.toDate ? ts.toDate() : (ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts));
      return d.toISOString().slice(0, 10);
    } catch { return '—'; }
  };

  const handleDeleteCarrier = async (e: React.MouseEvent, c: any) => {
    e.stopPropagation();
    if (!window.confirm(`Czy na pewno usunąć kuriera ${c.displayName}? To usunie tylko wpis kuriera. Kontrakty i cenniki zostaną w bazie.`)) return;
    try {
      const delFn = httpsCallable(functions, 'deleteCarrier');
      await delFn({ carrierId: c.id });
      if (selectedCarrierId === c.id) {
        setSelectedCarrierId(null);
        setSelectedContractId(null);
      }
      loadCarriers();
    } catch(err: any) {
      alert("Błąd: " + err.message);
    }
  };

  const handleDeletePriceList = async (pl: any) => {
    if (!selectedContractId) return;
    if (!window.confirm(`Czy na pewno usunąć cennik ${pl.id}?`)) return;
    try {
      const delFn = httpsCallable(functions, 'deleteCarrierPriceList');
      await delFn({ contractId: selectedContractId, priceListId: pl.id });
      loadPriceLists(selectedContractId);
    } catch(err: any) {
      alert("Błąd: " + err.message);
    }
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Kontrakty Kurierów</h1>
        <p className="text-sm text-gray-500">Zarządzanie kontraktami z kurierami i cennikami zakupu (super-admin only)</p>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* COL 1 — KURIERZY */}
        <div className="col-span-3 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold flex items-center gap-2"><Truck className="w-4 h-4"/> Kurierzy</h2>
            <button onClick={() => { setEditingCarrier(null); setCarrierModalOpen(true); }} className="text-xs font-semibold text-blue-600 flex items-center gap-1"><Plus className="w-3 h-3"/> Dodaj</button>
          </div>
          {loadingCarriers ? <Loader2 className="w-4 h-4 animate-spin"/> : (
            <ul className="space-y-1">
              {carriers.map(c => (
                <li key={c.id} className={`group p-2 rounded cursor-pointer flex items-center justify-between ${selectedCarrierId === c.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'}`}>
                  <div onClick={() => { setSelectedCarrierId(c.id); setSelectedContractId(null); }} className="flex-1">
                    <div className="text-sm font-semibold">{c.displayName}</div>
                    <div className="text-[10px] font-mono text-gray-500">{c.code} • {c.country}</div>
                    {!c.active && <span className="text-[10px] text-red-500 font-bold">NIEAKTYWNY</span>}
                  </div>
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100">
                    <button onClick={(e) => { e.stopPropagation(); setEditingCarrier(c); setCarrierModalOpen(true); }}><Edit2 className="w-3 h-3 text-gray-400 hover:text-blue-500"/></button>
                    <button onClick={(e) => handleDeleteCarrier(e, c)}><Trash2 className="w-3 h-3 text-red-400 hover:text-red-600"/></button>
                  </div>
                </li>
              ))}
              {carriers.length === 0 && <li className="text-xs text-gray-400 italic p-2">Brak kurierów</li>}
            </ul>
          )}
        </div>

        {/* PRAWA STRONA */}
        <div className="col-span-9 flex flex-col gap-4">
          {selectedCarrierId && (
            <div className="flex gap-2">
              <button onClick={() => setView('contracts')} className={`px-4 py-1.5 rounded-full text-sm font-semibold ${view==='contracts' ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>Kontrakty</button>
              <button onClick={() => setView('surcharges')} className={`px-4 py-1.5 rounded-full text-sm font-semibold ${view==='surcharges' ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>Dopłaty</button>
            </div>
          )}

          {selectedCarrierId && view === 'surcharges' ? (
            <CarrierSurchargesPanel carrierId={selectedCarrierId} />
          ) : (
            <div className="grid grid-cols-9 gap-4">
              {/* COL 2 — KONTRAKTY */}
              <div className="col-span-4 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold flex items-center gap-2"><FileText className="w-4 h-4"/> Kontrakty</h2>
                  {selectedCarrierId && (
                    <button onClick={() => { setEditingContract(null); setContractModalOpen(true); }} className="text-xs font-semibold text-blue-600 flex items-center gap-1"><Plus className="w-3 h-3"/> Nowy kontrakt</button>
                  )}
                </div>
                {!selectedCarrierId ? (
                  <div className="text-xs text-gray-400 italic p-4 text-center">← Wybierz kuriera</div>
                ) : loadingContracts ? <Loader2 className="w-4 h-4 animate-spin"/> : (
                  <ul className="space-y-2">
                    {contracts.map(c => (
                      <li key={c.id} className={`p-3 rounded border cursor-pointer ${selectedContractId === c.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`} onClick={() => setSelectedContractId(c.id)}>
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="text-sm font-semibold">v{c.version}</div>
                            <div className="text-xs text-gray-600">{formatTimestamp(c.validFrom)} → {c.validTo ? formatTimestamp(c.validTo) : '∞'}</div>
                            <div className="text-[10px] uppercase tracking-wider mt-1">
                              <span className={`px-1.5 py-0.5 rounded ${c.status === 'active' ? 'bg-emerald-100 text-emerald-700' : c.status === 'draft' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>{c.status}</span>
                            </div>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); setEditingContract(c); setContractModalOpen(true); }}><Edit2 className="w-3 h-3 text-gray-400"/></button>
                        </div>
                        {c.notes && <div className="text-[10px] text-gray-500 mt-1 truncate">{c.notes}</div>}
                      </li>
                    ))}
                    {contracts.length === 0 && <li className="text-xs text-gray-400 italic p-2">Brak kontraktów</li>}
                  </ul>
                )}
              </div>

              {/* COL 3 — CENNIK */}
              <div className="col-span-5 bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold flex items-center gap-2"><ListOrdered className="w-4 h-4"/> Cennik kontraktu</h2>
                  {selectedContractId && (
                    <button onClick={() => { setPriceListEditingFromExisting(null); setPriceListEditMode('copy'); setPriceListEditorOpen(true); }} className="text-xs font-semibold text-blue-600 flex items-center gap-1"><Plus className="w-3 h-3"/> Nowy cennik</button>
                  )}
                </div>
                {!selectedContractId ? (
                  <div className="text-xs text-gray-400 italic p-4 text-center">← Wybierz kontrakt</div>
                ) : priceListEditorOpen ? (
                  <PriceListEditor
                    contractId={selectedContractId}
                    existingPriceList={priceListEditingFromExisting}
                    editMode={priceListEditMode}
                    onSaved={() => { setPriceListEditorOpen(false); loadPriceLists(selectedContractId); }}
                  />
                ) : loadingPriceLists ? <Loader2 className="w-4 h-4 animate-spin"/> : (
                  <ul className="space-y-2">
                    {priceLists.map(pl => (
                      <li key={pl.id} className="p-3 rounded border border-gray-200">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="text-sm font-semibold">{pl.name ? `${pl.name} (v${pl.version})` : `v${pl.version}`}</div>
                            <div className="text-xs text-gray-600">{formatTimestamp(pl.validFrom)} → {pl.validTo ? formatTimestamp(pl.validTo) : '∞'}</div>
                            <div className="text-[11px] text-gray-500 mt-1">{pl.prices?.length || 0} wierszy cen, {pl.services?.length || 0} usług</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button onClick={() => { setPriceListEditingFromExisting(pl); setPriceListEditMode('edit'); setPriceListEditorOpen(true); }} className="text-xs font-semibold text-emerald-600 flex items-center gap-1 hover:text-emerald-700"><Edit2 className="w-3 h-3"/> Edytuj</button>
                            <button onClick={() => { setPriceListEditingFromExisting(pl); setPriceListEditMode('copy'); setPriceListEditorOpen(true); }} className="text-xs font-semibold text-blue-600 flex items-center gap-1 hover:text-blue-700"><Copy className="w-3 h-3"/> Kopiuj</button>
                            <button onClick={() => handleDeletePriceList(pl)} className="text-xs font-semibold text-red-500 flex items-center gap-1 hover:text-red-700"><Trash2 className="w-3 h-3"/> Usuń</button>
                          </div>
                        </div>
                      </li>
                    ))}
                    {priceLists.length === 0 && <li className="text-xs text-gray-400 italic p-2">Brak cenników. Utwórz pierwszy.</li>}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <CarrierFormModal isOpen={carrierModalOpen} onClose={() => setCarrierModalOpen(false)} carrier={editingCarrier} onSuccess={loadCarriers}/>
      {selectedCarrierId && (
        <ContractFormModal isOpen={contractModalOpen} onClose={() => setContractModalOpen(false)} carrierId={selectedCarrierId} contract={editingContract} onSuccess={() => loadContracts(selectedCarrierId)}/>
      )}
    </div>
  );
}
