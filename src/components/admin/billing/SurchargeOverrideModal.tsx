import React, { useState, useEffect } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { functionsEU } from '../../../firebase/config';
import type { CarrierSurcharge, SurchargeApplyMode } from '../../../types/billing';

interface SurchargeOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  carrierId: string;
  initialSurcharge?: CarrierSurcharge | null;
  onSuccess: () => void;
}

export const SurchargeOverrideModal: React.FC<SurchargeOverrideModalProps> = ({ isOpen, onClose, carrierId, initialSurcharge, onSuccess }) => {
  const [effectiveMonth, setEffectiveMonth] = useState('');
  const [energySurchargePercent, setEnergySurchargePercent] = useState<number>(0);
  const [fuelSurchargePercent, setFuelSurchargePercent] = useState<number>(0);
  const [applyMode, setApplyMode] = useState<SurchargeApplyMode>('percent_of_base');
  const [manualNote, setManualNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (initialSurcharge) {
        setEffectiveMonth(initialSurcharge.effectiveMonth || '');
        setEnergySurchargePercent(initialSurcharge.energySurchargePercent || 0);
        setFuelSurchargePercent(initialSurcharge.fuelSurchargePercent || 0);
        setApplyMode(initialSurcharge.applyMode || 'percent_of_base');
        setManualNote(initialSurcharge.manualNote || '');
      } else {
        setEffectiveMonth('');
        setEnergySurchargePercent(0);
        setFuelSurchargePercent(0);
        setApplyMode('percent_of_base');
        setManualNote('');
      }
      setError('');
    }
  }, [isOpen, initialSurcharge]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveMonth) {
      setError('Miesiąc jest wymagany (YYYY-MM)');
      return;
    }
    
    setLoading(true);
    setError('');

    try {
      const setSurchargeManualOverride = httpsCallable(functionsEU, 'setSurchargeManualOverride');
      await setSurchargeManualOverride({
        carrierId,
        effectiveMonth,
        energySurchargePercent,
        fuelSurchargePercent,
        applyMode,
        manualNote
      });
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Wystąpił błąd podczas zapisywania dopłaty.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-4 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-bold">Ręczna edycja dopłaty</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
          
          <form id="override-form" onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Miesiąc (YYYY-MM)</label>
              <input
                type="month"
                value={effectiveMonth}
                onChange={(e) => setEffectiveMonth(e.target.value)}
                required
                className="w-full text-sm border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Dopłata Energetyczna (%)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="30"
                  value={energySurchargePercent}
                  onChange={(e) => setEnergySurchargePercent(parseFloat(e.target.value))}
                  required
                  className="w-full text-sm border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Dopłata Paliwowa (%)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="50"
                  value={fuelSurchargePercent}
                  onChange={(e) => setFuelSurchargePercent(parseFloat(e.target.value))}
                  required
                  className="w-full text-sm border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Metoda naliczania</label>
              <select
                value={applyMode}
                onChange={(e) => setApplyMode(e.target.value as any)}
                className="w-full text-sm border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="percent_of_base">% od ceny podstawowej</option>
                <option value="percent_of_total">% od kwoty całkowitej</option>
                <option value="flat">Stała kwota</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Notatka</label>
              <textarea
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
                rows={2}
                className="w-full text-sm border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
                placeholder="Np. Indywidualna stawka wg. aneksu nr 3"
              />
            </div>
          </form>
        </div>

        <div className="p-4 border-t border-gray-100 flex justify-end gap-2 shrink-0 bg-gray-50 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded"
          >
            Anuluj
          </button>
          <button
            type="submit"
            form="override-form"
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Zapisz
          </button>
        </div>
      </div>
    </div>
  );
};
