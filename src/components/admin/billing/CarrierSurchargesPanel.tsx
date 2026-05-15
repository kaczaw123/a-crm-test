import React, { useState, useEffect } from 'react';
import { app } from '../../../firebase/config';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { functionsEU } from '../../../firebase/config';
import { Download, Edit2, Loader2, RotateCcw, AlertTriangle } from 'lucide-react';
import type { CarrierSurcharge } from '../../../types/billing';
import { SurchargeOverrideModal } from './SurchargeOverrideModal';

interface CarrierSurchargesPanelProps {
  carrierId: string;
}

interface SurchargeWithAlert extends CarrierSurcharge {
  hasAlert?: boolean;
}

export const CarrierSurchargesPanel: React.FC<CarrierSurchargesPanelProps> = ({ carrierId }) => {
  const [surcharges, setSurcharges] = useState<SurchargeWithAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchingNow, setFetchingNow] = useState(false);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [editingSurcharge, setEditingSurcharge] = useState<CarrierSurcharge | null>(null);

  const loadSurcharges = async () => {
    setLoading(true);
    try {
      const fn = httpsCallable(functionsEU, 'listSurcharges');
      const res: any = await fn({ carrierId });
      setSurcharges(res.data.surcharges || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (carrierId) {
      loadSurcharges();
    }
  }, [carrierId]);

  const handleFetchNow = async () => {
    setFetchingNow(true);
    try {
      const fn = httpsCallable(functionsEU, 'fetchSurchargesNow');
      await fn({ carrierId });
      await loadSurcharges();
    } catch (err) {
      console.error(err);
      alert('Błąd podczas pobierania dopłat.');
    } finally {
      setFetchingNow(false);
    }
  };

  const handleReset = async (month: string) => {
    if (!window.confirm(`Czy na pewno chcesz zresetować ręczną dopłatę dla ${month}?`)) return;
    
    try {
      const fn = httpsCallable(functionsEU, 'clearSurchargeManualOverride');
      await fn({ carrierId, effectiveMonth: month });
      await loadSurcharges();
    } catch (err) {
      console.error(err);
      alert('Błąd podczas resetowania dopłaty.');
    }
  };

  const formatTimestamp = (ts: any) => {
    if (!ts) return '—';
    try {
      const d = ts.toDate ? ts.toDate() : (ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts));
      return d.toISOString().slice(0, 10);
    } catch { return '—'; }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold flex items-center gap-2">Dopłaty Kurierskie (Fuel / Energy)</h2>
        <div className="flex gap-2">
          <button
            onClick={() => { setEditingSurcharge(null); setOverrideModalOpen(true); }}
            className="text-xs font-semibold text-blue-600 flex items-center gap-1 hover:bg-blue-50 px-2 py-1 rounded"
          >
            <Edit2 className="w-3 h-3" /> Nadpisz ręcznie
          </button>
          <button
            onClick={handleFetchNow}
            disabled={fetchingNow}
            className="text-xs font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50 flex items-center gap-1 px-3 py-1.5 rounded"
          >
            {fetchingNow ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
            {fetchingNow ? 'Pobieranie...' : 'Pobierz teraz'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : (
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-50 border-b border-gray-100 text-gray-600 text-xs">
              <tr>
                <th className="px-3 py-2 font-semibold">Miesiąc</th>
                <th className="px-3 py-2 font-semibold">Energy %</th>
                <th className="px-3 py-2 font-semibold">Fuel %</th>
                <th className="px-3 py-2 font-semibold">Source</th>
                <th className="px-3 py-2 font-semibold">Last Update</th>
                <th className="px-3 py-2 font-semibold text-right">Akcje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {surcharges.map(s => (
                <tr key={s.effectiveMonth} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium flex items-center gap-1">
                    {s.effectiveMonth}
                    {s.hasAlert && <span title="Znacząca zmiana dopłaty"><AlertTriangle className="w-3 h-3 text-orange-500" /></span>}
                  </td>
                  <td className="px-3 py-2">{s.energySurchargePercent?.toFixed(2) || '0.00'}%</td>
                  <td className="px-3 py-2">{s.fuelSurchargePercent?.toFixed(2) || '0.00'}%</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${
                      s.source === 'manual' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {s.source}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 text-nowrap">
                    {formatTimestamp(s.source === 'manual' ? s.manualOverrideAt : s.fetchedAt)}
                  </td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <button 
                      onClick={() => { setEditingSurcharge(s); setOverrideModalOpen(true); }}
                      className="text-blue-600 hover:text-blue-800 p-1" 
                      title="Nadpisz"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    {s.source === 'manual' && (
                      <button 
                        onClick={() => handleReset(s.effectiveMonth)}
                        className="text-red-500 hover:text-red-700 p-1"
                        title="Zresetuj do auto"
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {surcharges.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-gray-400 italic text-sm">
                    Brak danych o dopłatach dla tego kuriera.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <SurchargeOverrideModal 
        isOpen={overrideModalOpen} 
        onClose={() => { setOverrideModalOpen(false); setEditingSurcharge(null); }} 
        carrierId={carrierId}
        initialSurcharge={editingSurcharge}
        onSuccess={loadSurcharges} 
      />
    </div>
  );
};
