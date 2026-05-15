import { useEffect, useState } from 'react';
import { collectionGroup, query, orderBy, getDocs, collection } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { InboundShipment } from '../../data/inbound';
import AdminInboundDetailsPanel from './AdminInboundDetailsPanel';

export default function AdminInbounds() {
  const [shipments, setShipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPanel, setSelectedPanel] = useState<{ id: string, companyId: string, cnip?: string } | null>(null);

  // Przyszłe filtry
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    async function load() {
      try {
        const q = query(
          collectionGroup(db, 'inboundShipments'), 
          orderBy('createdAt', 'desc')
        );
        const [companiesSnap, snapshot] = await Promise.all([
          getDocs(collection(db, 'companies')),
          getDocs(q)
        ]);
        
        const cmap = new Map();
        companiesSnap.forEach(d => cmap.set(d.id, d.data()));

        const data = snapshot.docs.map(d => {
          const s = d.data() as any;
          const c = cmap.get(s.orgId);
          return {
            id: d.id,
            ...s,
            companyName: s.companyName || c?.name || 'Nieznana Firma',
            companyNip: s.companyNip || c?.taxId || '-'
          };
        });
        setShipments(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = shipments.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      // Search by ID, tracking, or company Name/NIP
      const cname = (s as any).companyName?.toLowerCase() || '';
      const cnip = (s as any).companyNip?.toLowerCase() || '';
      return s.id?.toLowerCase().includes(term) || 
             s.trackingNumber?.toLowerCase().includes(term) || 
             cname.includes(term) || cnip.includes(term);
    }
    return true;
  });

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-64px)] relative">
      <div className={`transition-all duration-300 ${selectedPanel ? 'w-full lg:w-[calc(100%-600px)] hidden lg:block' : 'w-full'}`}>
        <div className="w-full px-4 py-4">
          <div className="flex justify-between items-center mb-5">
            <h1 className="text-xl font-semibold text-[#0F172A] tracking-tight">Awizacje Globalne (Inbounds)</h1>
          </div>

          <div className="bg-white p-3 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.05)] border border-[#E2E8F0] mb-5 flex flex-col sm:flex-row gap-3 justify-between items-center">
            <div className="relative w-full sm:w-[400px]">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8] text-[20px]">search</span>
              <input 
                type="text" 
                placeholder="Szukaj po ID, NIP firmy, Nazwie, lub Listach..." 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 h-[40px] text-[13px] border border-[#CBD5E1] rounded-xl focus:ring-[#4338CA] focus:border-[#4338CA] transition-colors"
              />
            </div>
            <div className="flex gap-3 w-full sm:w-auto">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#64748B] text-[20px]">filter_alt</span>
                <select 
                  value={statusFilter} 
                  onChange={e => setStatusFilter(e.target.value)}
                  className="border border-[#CBD5E1] rounded-xl h-[40px] px-3 text-[13px] focus:ring-[#4338CA] focus:border-[#4338CA] bg-white text-[#334155] cursor-pointer"
                >
                  <option value="all">Wszystkie statusy</option>
                  <option value="submitted">Zgłoszone (Submitted)</option>
                  <option value="in_receiving">W odbiorze (In Receiving)</option>
                  <option value="received_partial">Częściowo odebrane</option>
                  <option value="received_complete">Odebrane Kompletnie</option>
                  <option value="closed_with_shortage">Brak (Rozliczone siłowo)</option>
                </select>
              </div>
            </div>
          </div>

            <div className="bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-x-auto rounded-2xl border border-[#E2E8F0]">
            <table className="min-w-full divide-y divide-[#E2E8F0] text-[13px]">
              <thead className="bg-[#F8FAFC]">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">ID Awizacji</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Klient (NIP)</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Data Wprow.</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">ETA / Plan</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Tracker</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Magazyn Docelowy</th>
                  <th className="px-4 py-3 text-center font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Sztuk (Rec / Exp)</th>
                  <th className="px-4 py-3 text-center font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">V (m³)</th>
                  <th className="px-4 py-3 text-right font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Akcje</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-[#F1F5F9]">
                {loading ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-[#64748B]">Ładowanie globalnych awizacji...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-[#64748B]">Brak wyników.</td></tr>
                ) : (
                  filtered.map(s => {
                    const createdAtDate = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString('pl-PL') : (typeof s.createdAt === 'string' ? new Date(s.createdAt).toLocaleDateString('pl-PL') : '-');
                    const etaDateVal = s.estimatedArrivalDate || s.plannedDeliveryDate;
                    const etaDate = etaDateVal?.toDate ? etaDateVal.toDate().toLocaleDateString('pl-PL') : (typeof etaDateVal === 'string' ? new Date(etaDateVal).toLocaleDateString('pl-PL') : '-');

                    return (
                    <tr key={s.id} className="hover:bg-[#F8FAFC] transition-colors cursor-pointer" onClick={() => setSelectedPanel({ id: s.id!, companyId: s.orgId, cnip: s.companyNip })}>
                      <td className="px-4 py-2.5 whitespace-nowrap font-mono font-semibold text-[#0F172A]">{s.id?.substring(0,8).toUpperCase()}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="font-semibold text-[#0F172A]">{s.companyName}</div>
                        <div className="text-[11px] text-[#94A3B8] font-mono mt-0.5">NIP: {s.companyNip}</div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`px-2 py-0.5 inline-flex text-[11px] leading-tight font-bold rounded-md ${
                          s.status === 'received_complete' ? 'bg-[#DCFCE7] text-[#166534]' : 
                          s.status === 'in_receiving' ? 'bg-blue-100 text-blue-800' :
                          s.status === 'closed_with_shortage' ? 'bg-red-100 text-red-800' :
                          'bg-orange-100 text-orange-800'
                        }`}>
                          {s.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-[#475569] font-medium">{createdAtDate}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-[#475569] font-bold text-[#0F172A]">{etaDate}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-[#475569]">{s.carrier} <span className="font-mono text-xs">{s.trackingNumber}</span></td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="font-semibold text-[#0F172A] text-[12px] truncate max-w-[150px]" title={s.destinationWarehouseName || '-'}>
                          {s.destinationWarehouseName || '-'}
                        </div>
                        <div className="text-[10px] text-[#94A3B8] font-mono mt-0.5">{s.destinationWarehouseCode || ''}</div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-[#475569] text-center font-bold">
                         {s.totalReceivedQty || 0} / {s.totalExpectedQty}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-center text-[#475569]">
                        {['received_complete', 'received_partial', 'closed_with_shortage'].includes(s.status) ? 
                           (s.totalReceivedVolume || 0).toFixed(3) : 
                           (s.totalExpectedVolume || 0).toFixed(3)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-right">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setSelectedPanel({ id: s.id!, companyId: s.orgId, cnip: s.companyNip }); }}
                          className="px-3 py-1.5 bg-white border border-[#CBD5E1] text-[#475569] text-[12px] font-semibold rounded-lg hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition-colors shadow-sm inline-flex items-center gap-1"
                        >
                          {['submitted', 'in_receiving'].includes(s.status) ? 'Odbierz' : 'Podgląd'} <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedPanel && (
        <div className="w-full lg:w-[600px] bg-white lg:border-l border-[#E2E8F0] shadow-2xl lg:shadow-none flex flex-col fixed lg:sticky top-[64px] lg:top-0 h-[calc(100vh-64px)] right-0 z-40 transform transition-transform duration-300 translate-x-0">
          <AdminInboundDetailsPanel 
            shipmentId={selectedPanel.id} 
            companyId={selectedPanel.companyId}
            fallbackNip={selectedPanel.cnip}
            onClose={() => setSelectedPanel(null)} 
          />
        </div>
      )}
    </div>
  );
}
