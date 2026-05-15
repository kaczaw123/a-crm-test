import React, { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../firebase/config';
import { X, Loader2 } from 'lucide-react';
import type { Carrier } from '../../../types/billing';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  carrier: Carrier | null;  // null = create mode
  onSuccess: () => void;
}

export function CarrierFormModal({ isOpen, onClose, carrier, onSuccess }: Props) {
  const [carrierId, setCarrierId] = useState('');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [country, setCountry] = useState('DE');
  const [apiIntegrationType, setApiIntegrationType] = useState('');
  const [surchargeUrl, setSurchargeUrl] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (carrier) {
        setCarrierId(carrier.id);
        setCode(carrier.code || '');
        setDisplayName(carrier.displayName || '');
        setCountry(carrier.country || 'DE');
        setApiIntegrationType(carrier.apiIntegrationType || '');
        setSurchargeUrl(carrier.surchargeUrl || '');
        setActive(carrier.active !== false);
      } else {
        setCarrierId('');
        setCode('');
        setDisplayName('');
        setCountry('DE');
        setApiIntegrationType('');
        setSurchargeUrl('');
        setActive(true);
      }
      setErrorMsg('');
    }
  }, [isOpen, carrier]);

  const handleSave = async () => {
    if (!code || !displayName) {
      setErrorMsg('Wymagane: kod i nazwa wyświetlana.');
      return;
    }
    if (!carrier && !carrierId) {
      setErrorMsg('Wymagany ID dokumentu (np. dhl_de).');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    try {
      const fn = httpsCallable(functions, 'upsertCarrier');
      await fn({
        carrierId: carrier?.id || carrierId,
        code, displayName, country,
        apiIntegrationType: apiIntegrationType || null,
        surchargeUrl: surchargeUrl || null,
        active
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Błąd zapisu');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-bold">{carrier ? 'Edytuj kuriera' : 'Dodaj kuriera'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
        </div>
        <div className="px-6 py-4 space-y-3">
          {!carrier && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">ID dokumentu (np. dhl_de)</label>
              <input value={carrierId} onChange={e => setCarrierId(e.target.value)} className="w-full px-3 py-2 border rounded text-sm font-mono"/>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Kod (alfanumeryczny)</label>
            <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} className="w-full px-3 py-2 border rounded text-sm font-mono" placeholder="DHL_DE"/>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Nazwa wyświetlana</label>
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" placeholder="DHL Germany"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Kraj (ISO2)</label>
              <input value={country} onChange={e => setCountry(e.target.value.toUpperCase())} maxLength={2} className="w-full px-3 py-2 border rounded text-sm font-mono uppercase"/>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Typ integracji API</label>
              <input value={apiIntegrationType} onChange={e => setApiIntegrationType(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" placeholder="rest, soap, none"/>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">URL strony z surcharges</label>
            <input value={surchargeUrl} onChange={e => setSurchargeUrl(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" placeholder="https://www.dhl.de/..."/>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-4 h-4"/>
            Aktywny
          </label>
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
