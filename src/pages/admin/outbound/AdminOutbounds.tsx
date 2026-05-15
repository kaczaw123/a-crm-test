import { useEffect, useState } from 'react';
import { collectionGroup, query, orderBy, getDocs, collection } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { OutboundForm } from '../../app/outbound/OutboundForm';
import { forceSyncClaimsCallable } from '../../../data/users';

export default function AdminOutbounds() {
  const [shipments, setShipments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isSyncing, setIsSyncing] = useState(false);

  const [selectedShipment, setSelectedShipment] = useState<any | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const q = query(
          collectionGroup(db, 'outboundShipments'),
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
            companyName: c?.name || 'Nieznana Firma',
            companyNip: c?.taxId || '-'
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
      const cname = s.companyName?.toLowerCase() || '';
      const cnip = s.companyNip?.toLowerCase() || '';
      return s.documentNumber?.toLowerCase().includes(term) || 
             s.id?.toLowerCase().includes(term) || 
             s.issuedTo?.toLowerCase().includes(term) ||
             cname.includes(term) || cnip.includes(term);
    }
    return true;
  });

  const handleForceSync = async () => {
    setIsSyncing(true);
    try {
      const { data } = await forceSyncClaimsCallable();
      alert((data as any)?.message || 'Zsynchronizowano pomyślnie. Wyloguj się i zaloguj ponownie aby zaktualizować token!');
    } catch (error: any) {
      alert('Błąd synchronizacji: ' + error.message);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-64px)] relative">
      <div className="w-full transition-all duration-300">
        <div className="w-full px-4 py-4">
          <div className="flex justify-between items-center mb-5">
            <h1 className="text-xl font-semibold text-[#0F172A] tracking-tight">Wydania Globalne (Outbounds WZ)</h1>
            <div className="flex items-center gap-2">
               <button 
                 onClick={handleForceSync}
                 disabled={isSyncing}
                 className="flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors border border-indigo-200 shadow-sm"
               >
                 <span className={`material-symbols-outlined text-[16px] ${isSyncing ? 'animate-spin' : ''}`}>sync</span>
                 {isSyncing ? 'Synchronizowanie...' : 'Sync JWT'}
               </button>
               <button 
                 onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
                 className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors border ${
                   statusFilter === 'pending' 
                   ? 'bg-amber-100 text-amber-800 border-amber-200 shadow-sm' 
                   : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                 }`}
               >
                 Oczekujące na wydanie
               </button>
            </div>
          </div>

          <div className="bg-white p-3 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.05)] border border-[#E2E8F0] mb-5 flex flex-col sm:flex-row gap-3 justify-between items-center">
            <div className="relative w-full sm:w-[400px]">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8] text-[20px]">search</span>
              <input 
                type="text" 
                placeholder="Szukaj po WZ, Odbiorcy, NIP, Nazwie..." 
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
                  <option value="pending">Oczekujące (Pending)</option>
                  <option value="draft">Szkic (Draft)</option>
                  <option value="completed">Zakończone (Completed)</option>
                  <option value="canceled">Anulowane (Canceled)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-x-auto rounded-2xl border border-[#E2E8F0]">
            <table className="min-w-full divide-y divide-[#E2E8F0] text-[13px]">
              <thead className="bg-[#F8FAFC]">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">ID WZ</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Klient (NIP)</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Data Utworzenia</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Wydano Do</th>
                  <th className="px-4 py-3 text-center font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">Liczba Zapasów</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-[#F1F5F9]">
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[#64748B]">Ładowanie globalnych wydań...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[#64748B]">Brak wyników.</td></tr>
                ) : (
                  filtered.map(s => {
                    const createdAtDate = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleDateString('pl-PL') : (typeof s.createdAt === 'string' ? new Date(s.createdAt).toLocaleDateString('pl-PL') : '-');

                    return (
                    <tr 
                      key={s.id} 
                      onClick={() => setSelectedShipment(s)}
                      className="hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap font-mono font-semibold text-[#0F172A]">{s.documentNumber || s.id?.substring(0,8).toUpperCase()}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="font-semibold text-[#0F172A]">{s.companyName}</div>
                        <div className="text-[11px] text-[#94A3B8] font-mono mt-0.5">NIP: {s.companyNip}</div>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`px-2 py-0.5 inline-flex text-[11px] leading-tight font-bold rounded-md ${
                          s.status === 'completed' ? 'bg-[#DCFCE7] text-[#166534]' : 
                          s.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                          s.status === 'draft' ? 'bg-gray-100 text-gray-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {s.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-[#475569] font-medium">{createdAtDate}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-[#475569] font-bold text-[#0F172A]">{s.issuedTo || '-'}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-[#475569] text-center font-bold">
                         {s.totalIssuedQty || 0} szt ({s.itemsCount || 0} SKU)
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
      
      {selectedShipment && (
        <OutboundForm 
          existingOutbound={selectedShipment}
          companyIdOverride={selectedShipment.orgId}
          onClose={() => setSelectedShipment(null)}
        />
      )}
    </div>
  );
}
