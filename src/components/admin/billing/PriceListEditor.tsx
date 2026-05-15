import React, { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../firebase/config';
import { Plus, Trash2, Loader2, Copy } from 'lucide-react';
import type { PriceListEntry, PriceListService, CarrierPriceList } from '../../../types/billing';

interface Props {
  contractId: string;
  existingPriceList: CarrierPriceList | null;  // null = nowy cennik, inaczej kopiowanie do nowej wersji
  editMode?: 'copy' | 'edit';
  onSaved: () => void;
}

export function PriceListEditor({ contractId, existingPriceList, editMode = 'copy', onSaved }: Props) {
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [prices, setPrices] = useState<PriceListEntry[]>([]);
  const [services, setServices] = useState<PriceListService[]>([]);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (existingPriceList) {
      if (editMode === 'edit') {
        const fromD = existingPriceList.validFrom?.toDate ? existingPriceList.validFrom.toDate() : 
                      (existingPriceList.validFrom?._seconds ? new Date(existingPriceList.validFrom._seconds * 1000) : 
                      (existingPriceList.validFrom ? new Date(existingPriceList.validFrom) : new Date()));
        setValidFrom(fromD.toISOString().slice(0, 10));
        
        if (existingPriceList.validTo) {
          const toD = existingPriceList.validTo?.toDate ? existingPriceList.validTo.toDate() : 
                        (existingPriceList.validTo?._seconds ? new Date(existingPriceList.validTo._seconds * 1000) : 
                        new Date(existingPriceList.validTo));
          setValidTo(toD.toISOString().slice(0, 10));
        } else {
          setValidTo('');
        }
      } else {
        // Inicjalizuj z poprzedniej wersji (kopiowanie do nowej)
        const today = new Date().toISOString().slice(0, 10);
        setValidFrom(today);
        setValidTo('');
      }
      setPrices(existingPriceList.prices || []);
      setServices(existingPriceList.services || []);
    } else {
      setValidFrom(new Date().toISOString().slice(0, 10));
      setValidTo('');
      setPrices([]);
      setServices([{ code: 'STANDARD', name: 'Standard' }]);
    }
    setErrorMsg('');
  }, [existingPriceList, contractId]);

  const addPriceRow = () => {
    setPrices([...prices, { zoneCode: '', weightFrom: 0, weightTo: 1, basePrice: 0, currency: 'EUR', serviceCode: services[0]?.code || 'STANDARD' }]);
  };

  const updatePriceRow = (idx: number, field: keyof PriceListEntry, value: any) => {
    const next = [...prices];
    (next[idx] as any)[field] = value;
    setPrices(next);
  };

  const removePriceRow = (idx: number) => {
    setPrices(prices.filter((_, i) => i !== idx));
  };

  const addService = () => {
    setServices([...services, { code: '', name: '' }]);
  };

  const updateService = (idx: number, field: keyof PriceListService, value: any) => {
    const next = [...services];
    (next[idx] as any)[field] = value;
    setServices(next);
  };

  const removeService = (idx: number) => {
    setServices(services.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!validFrom) { setErrorMsg('Wymagana data od'); return; }
    if (prices.length === 0) { setErrorMsg('Cennik musi zawierać minimum 1 wiersz'); return; }
    
    // Walidacja po stronie front
    for (let i = 0; i < prices.length; i++) {
      const p = prices[i];
      if (!p.zoneCode || !p.serviceCode || !p.currency) {
        setErrorMsg(`Wiersz ${i + 1}: wymagane zoneCode, serviceCode, currency`); return;
      }
      if (p.weightTo <= p.weightFrom) {
        setErrorMsg(`Wiersz ${i + 1}: weightTo (${p.weightTo}) musi być większe niż weightFrom (${p.weightFrom})`); return;
      }
    }

    setSaving(true);
    setErrorMsg('');
    try {
      const fn = httpsCallable(functions, 'saveCarrierPriceList');
      await fn({
        contractId,
        priceListId: editMode === 'edit' && existingPriceList ? existingPriceList.id : undefined,
        name: existingPriceList?.name,
        validFrom: new Date(validFrom).toISOString(),
        validTo: validTo ? new Date(validTo).toISOString() : null,
        prices,
        services
      });
      onSaved();
    } catch (err: any) {
      setErrorMsg(err.message || 'Błąd zapisu cennika');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Obowiązuje od</label>
          <input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} className="px-3 py-2 border rounded text-sm"/>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Obowiązuje do (opcjonalne)</label>
          <input type="date" value={validTo} onChange={e => setValidTo(e.target.value)} className="px-3 py-2 border rounded text-sm"/>
        </div>
      </div>

      {/* Services section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold text-gray-700">Usługi (serviceCodes)</h4>
          <button onClick={addService} className="text-xs font-semibold text-blue-600 flex items-center gap-1"><Plus className="w-3 h-3"/> Dodaj</button>
        </div>
        <div className="space-y-3">
          {services.map((s, idx) => (
            <div key={idx} className="flex flex-col gap-2 p-3 border rounded bg-gray-50/50">
              <div className="flex gap-2 items-center">
                <input value={s.code} onChange={e => updateService(idx, 'code', e.target.value.toUpperCase())} placeholder="Kod (np. SAISON_SPRING)" className="px-2 py-1.5 border rounded text-xs font-mono w-40"/>
                <input value={s.name} onChange={e => updateService(idx, 'name', e.target.value)} placeholder="Nazwa usługi" className="px-2 py-1.5 border rounded text-xs flex-1"/>
                <button onClick={() => removeService(idx)} className="text-red-500 hover:text-red-700 p-1"><Trash2 className="w-4 h-4"/></button>
              </div>
              
              <div className="flex flex-wrap gap-3 items-center text-xs mt-1">
                <select value={s.category || 'optional'} onChange={e => updateService(idx, 'category', e.target.value)} className="px-2 py-1.5 border rounded bg-white text-gray-700">
                  <option value="optional">Opcjonalna</option>
                  <option value="mandatory">Obowiązkowa</option>
                  <option value="conditional">Warunkowa (daty/adres)</option>
                  <option value="penalty">Kara (Penalty)</option>
                  <option value="base">Cena Bazowa</option>
                </select>
                
                <select value={s.type || 'flat'} onChange={e => updateService(idx, 'type', e.target.value)} className="px-2 py-1.5 border rounded bg-white text-gray-700">
                  <option value="flat">Kwota stała (EUR)</option>
                  <option value="percent">Procentowa (%)</option>
                </select>
                
                <div className="flex items-center gap-1">
                  {(s.type || 'flat') === 'flat' ? (
                    <input type="number" step="0.01" value={s.basePrice ?? ''} onChange={e => updateService(idx, 'basePrice', parseFloat(e.target.value) || 0)} placeholder="0.00" className="px-2 py-1.5 border rounded w-20 text-right"/>
                  ) : (
                    <input type="number" step="0.01" value={s.percent ?? ''} onChange={e => updateService(idx, 'percent', parseFloat(e.target.value) || 0)} placeholder="0.0" className="px-2 py-1.5 border rounded w-20 text-right"/>
                  )}
                  <span className="text-gray-500 font-medium">{(s.type || 'flat') === 'flat' ? 'EUR' : '%'}</span>
                </div>

                <select value={(s.conditions?.b2cOnly ? 'b2c' : s.conditions?.b2bOnly ? 'b2b' : 'all')} 
                         onChange={e => {
                            const val = e.target.value;
                            const conds = { ...(s.conditions || {}) };
                            delete conds.b2cOnly;
                            delete conds.b2bOnly;
                            if (val === 'b2c') conds.b2cOnly = true;
                            if (val === 'b2b') conds.b2bOnly = true;
                            updateService(idx, 'conditions', conds);
                         }}
                         className="px-2 py-1.5 text-xs outline-none border rounded bg-white text-gray-700">
                    <option value="all">Wszyscy (B2B+B2C)</option>
                    <option value="b2c">Tylko B2C (Osob. Prywatna)</option>
                    <option value="b2b">Tylko B2B (Firma)</option>
                </select>

                {s.category === 'conditional' && (
                  <div className="flex items-center gap-2 bg-white border rounded px-2 py-1 ml-auto">
                    <span className="text-gray-500 font-semibold text-[10px] uppercase">Sezon:</span>
                    <span className="text-gray-400">od m-ca</span>
                    <input type="number" min="1" max="12" value={s.conditions?.dateRange?.fromMonth || ''} onChange={e => {
                      const val = parseInt(e.target.value) || 1;
                      const conds = { ...(s.conditions || {}), dateRange: { ...(s.conditions?.dateRange || {toMonth: 12}), fromMonth: val } };
                      updateService(idx, 'conditions', conds);
                    }} className="w-10 text-center font-bold outline-none bg-gray-50 rounded" placeholder="np 4"/>
                    <span className="text-gray-400 ml-1">do m-ca</span>
                    <input type="number" min="1" max="12" value={s.conditions?.dateRange?.toMonth || ''} onChange={e => {
                      const val = parseInt(e.target.value) || 12;
                      const conds = { ...(s.conditions || {}), dateRange: { ...(s.conditions?.dateRange || {fromMonth: 1}), toMonth: val } };
                      updateService(idx, 'conditions', conds);
                    }} className="w-10 text-center font-bold outline-none bg-gray-50 rounded" placeholder="np 5"/>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Prices table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold text-gray-700">
            Tabela cen ({prices.length} wierszy)
            <span className="text-xs font-normal text-gray-500 ml-2 italic">Wypełnij €/kg dla stref ratecard. Pusta = cena flat.</span>
          </h4>
          <button onClick={addPriceRow} className="text-xs font-semibold text-blue-600 flex items-center gap-1"><Plus className="w-3 h-3"/> Dodaj wiersz</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-2 py-1 text-left">Strefa</th>
                <th className="px-2 py-1 text-left">Usługa</th>
                <th className="px-2 py-1 text-left">Waga od (kg)</th>
                <th className="px-2 py-1 text-left">Waga do (kg)</th>
                <th className="px-2 py-1 text-left">Cena bazowa</th>
                <th className="px-2 py-1 text-left">€/kg (opc.)</th>
                <th className="px-2 py-1 text-left">Waluta</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-1 py-1"><input value={p.zoneCode} onChange={e => updatePriceRow(idx, 'zoneCode', e.target.value.toUpperCase())} className="w-20 px-2 py-1 border rounded text-xs font-mono"/></td>
                  <td className="px-1 py-1">
                    <select value={p.serviceCode} onChange={e => updatePriceRow(idx, 'serviceCode', e.target.value)} className="px-2 py-1 border rounded text-xs">
                      {services.map(s => <option key={s.code} value={s.code}>{s.code}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1"><input type="number" step="0.001" value={p.weightFrom} onChange={e => updatePriceRow(idx, 'weightFrom', parseFloat(e.target.value) || 0)} className="w-24 px-2 py-1 border rounded text-xs"/></td>
                  <td className="px-1 py-1"><input type="number" step="0.001" value={p.weightTo} onChange={e => updatePriceRow(idx, 'weightTo', parseFloat(e.target.value) || 0)} className="w-24 px-2 py-1 border rounded text-xs"/></td>
                  <td className="px-1 py-1"><input type="number" step="0.01" value={p.basePrice} onChange={e => updatePriceRow(idx, 'basePrice', parseFloat(e.target.value) || 0)} className="w-24 px-2 py-1 border rounded text-xs"/></td>
                  <td className="px-1 py-1"><input type="number" step="0.01" placeholder="—" value={p.pricePerKg === undefined ? '' : p.pricePerKg} onChange={e => updatePriceRow(idx, 'pricePerKg', e.target.value === '' ? undefined : parseFloat(e.target.value))} className="w-20 px-2 py-1 border rounded text-xs"/></td>
                  <td className="px-1 py-1"><input value={p.currency} onChange={e => updatePriceRow(idx, 'currency', e.target.value.toUpperCase())} maxLength={3} className="w-16 px-2 py-1 border rounded text-xs font-mono uppercase"/></td>
                  <td className="px-1 py-1"><button onClick={() => removePriceRow(idx)} className="text-red-500"><Trash2 className="w-4 h-4"/></button></td>
                </tr>
              ))}
              {prices.length === 0 && (
                <tr><td colSpan={8} className="text-center text-gray-400 py-4 italic">Brak wierszy. Dodaj pierwszy wiersz cennika.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {errorMsg && <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{errorMsg}</div>}

      <div className="flex justify-end gap-2 pt-3 border-t">
        <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded flex items-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin"/>} 
          {editMode === 'edit' ? 'Zaktualizuj cennik (v+1)' : existingPriceList ? 'Zapisz jako nową kopię' : 'Zapisz cennik'}
        </button>
      </div>
    </div>
  );
}
