import React, { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../firebase/config';
import { X, Loader2 } from 'lucide-react';
import type { CarrierContract } from '../../../types/billing';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  carrierId: string;
  contract: CarrierContract | null;
  onSuccess: () => void;
}

export function ContractFormModal({ isOpen, onClose, carrierId, contract, onSuccess }: Props) {
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'active' | 'expired' | 'draft'>('active');
  const [contractFileUrl, setContractFileUrl] = useState('');
  
  const [originCountry, setOriginCountry] = useState((contract as any)?.originCountry || '');
  const [injectionPoint, setInjectionPoint] = useState((contract as any)?.injectionPoint || '');
  const [contractEntity, setContractEntity] = useState((contract as any)?.contractEntity || '');
  const [contractRef, setContractRef] = useState((contract as any)?.contractRef || '');
  const [ekp, setEkp] = useState((contract as any)?.ekp || '');
  
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const formatForInput = (ts: any) => {
    if (!ts) return '';
    try {
      const d = ts.toDate ? ts.toDate() : (ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts));
      return d.toISOString().slice(0, 10);
    } catch { return ''; }
  };

  useEffect(() => {
    if (isOpen) {
      if (contract) {
        setValidFrom(formatForInput(contract.validFrom));
        setValidTo(formatForInput(contract.validTo));
        setNotes(contract.notes || '');
        setStatus(contract.status || 'active');
        setContractFileUrl(contract.contractFileUrl || '');
      } else {
        setValidFrom(new Date().toISOString().slice(0, 10));
        setValidTo('');
        setNotes('');
        setStatus('active');
        setContractFileUrl('');
        setOriginCountry('');
        setInjectionPoint('');
        setContractEntity('');
        setContractRef('');
        setEkp('');
      }
      setErrorMsg('');
    }
  }, [isOpen, contract]);

  const handleSave = async () => {
    if (!validFrom) {
      setErrorMsg('Wymagana data "Od"');
      return;
    }
    
    const validFromDate = new Date(validFrom);
    const validToDate = validTo ? new Date(validTo) : null;

    if (validToDate && validToDate <= validFromDate) {
      setErrorMsg('Data "Do" musi być późniejsza niż data "Od"');
      return;
    }

    setSaving(true);
    setErrorMsg('');
    try {
      const fn = httpsCallable(functions, 'saveCarrierContract');
      await fn({
        contractId: contract?.id,
        carrierId,
        validFrom: validFromDate.toISOString(),
        validTo: validToDate ? validToDate.toISOString() : null,
        contractFileUrl: contractFileUrl || null,
        notes: notes || '',
        status,
        originCountry: originCountry.trim().toUpperCase() || null,
        injectionPoint: injectionPoint.trim() || null,
        contractEntity: contractEntity.trim() || null,
        contractRef: contractRef.trim() || null,
        ekp: ekp.trim() || null
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Błąd zapisu kontraktu');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-bold">{contract ? 'Edytuj kontrakt' : 'Nowy kontrakt'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Obowiązuje od</label>
              <input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} className="w-full px-3 py-2 border rounded text-sm"/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Obowiązuje do</label>
              <input type="date" value={validTo} onChange={e => setValidTo(e.target.value)} className="w-full px-3 py-2 border rounded text-sm"/>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value as any)} className="w-full px-3 py-2 border rounded text-sm">
              <option value="active">Aktywny (active)</option>
              <option value="expired">Wygasły (expired)</option>
              <option value="draft">Szkic (draft)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">URL pliku z umową (opcjonalnie)</label>
            <input value={contractFileUrl} onChange={e => setContractFileUrl(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" placeholder="https://.../umowa.pdf"/>
          </div>
          
          <details className="border-t pt-2">
            <summary className="text-xs font-bold text-gray-600 cursor-pointer select-none uppercase">
              Metadane kontraktora (opcjonalne)
            </summary>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Kraj nadania (ISO-2)</label>
                <input value={originCountry} onChange={e => setOriginCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="DE" className="w-full px-3 py-2 border rounded text-sm font-mono uppercase"/>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">EKP / nr klienta</label>
                <input value={ekp} onChange={e => setEkp(e.target.value)} placeholder="5293784003" className="w-full px-3 py-2 border rounded text-sm font-mono"/>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Punkt nadania</label>
                <input value={injectionPoint} onChange={e => setInjectionPoint(e.target.value)} placeholder="Hub 02625 Bautzen, DE" className="w-full px-3 py-2 border rounded text-sm"/>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Strona umowy (legal entity)</label>
                <input value={contractEntity} onChange={e => setContractEntity(e.target.value)} placeholder="DHL Paket (Austria) GmbH" className="w-full px-3 py-2 border rounded text-sm"/>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Numer kontraktu</label>
                <input value={contractRef} onChange={e => setContractRef(e.target.value)} placeholder="CBS_AT_RESELLER_..." className="w-full px-3 py-2 border rounded text-sm font-mono"/>
              </div>
            </div>
          </details>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Notatki wewnętrzne</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full px-3 py-2 border rounded text-sm min-h-[80px]" placeholder="Opcjonalne notatki..."/>
          </div>
          
          {errorMsg && <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{errorMsg}</div>}
        </div>
        <div className="px-6 py-3 border-t bg-gray-50 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 rounded">Anuluj</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin"/>} Zapisz
          </button>
        </div>
      </div>
    </div>
  );
}
