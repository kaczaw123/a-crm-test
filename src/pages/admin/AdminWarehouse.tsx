import { useEffect, useState, useMemo } from 'react';
import { collectionGroup, getDocs, collection, query, orderBy, limit, startAfter } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, auth } from '../../firebase/config';

interface CompanyWarehouseStats {
  companyId: string;
  companyName: string;
  companyNip: string;
  totalQtyOnHand: number;
  totalQtyReserved: number;
  totalQtyAvailable: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  totalSkuCount: number;
  updatedAt: any;
}

interface GlobalStock {
  id: string; // doc id
  productId: string;
  sku: string;
  ean: string;
  productName: string;
  locationId: string;
  warehouseLocationId: string;
  companyId: string;
  companyName: string;
  companyNip?: string;
  qtyOnHand: number;
  qtyReserved: number;
  qtyAvailable: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  lastMovementAt: any;
  updatedAt: any;
  
  weightPerUnit?: number;
  lengthPerUnit?: number;
  widthPerUnit?: number;
  heightPerUnit?: number;
  volumePerUnit?: number;

  // legacy fallbacks
  onHand?: number;
  reserved?: number;
  available?: number;
  totalWeight?: number;
  totalVolume?: number;
}

export default function AdminWarehouse() {
  const [activeTab, setActiveTab] = useState<'summary' | 'details'>('summary');
  const [searchTerm, setSearchTerm] = useState('');

  // S T A T E : Summary
  const [companiesStats, setCompaniesStats] = useState<CompanyWarehouseStats[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(true);

  // S T A T E : Details (Paged)
  const [stock, setStock] = useState<GlobalStock[]>([]);
  const [lastDoc, setLastDoc] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // S T A T E : Korekta Logistyczna
  const [correctingStock, setCorrectingStock] = useState<GlobalStock | null>(null);
  const [logisticsForm, setLogisticsForm] = useState({ lengthCm: 0, widthCm: 0, heightCm: 0, weightKg: 0 });
  const [correctionSaving, setCorrectionSaving] = useState(false);

  const openLogisticsCorrection = (item: GlobalStock) => {
    setCorrectingStock(item);
    setLogisticsForm({
      lengthCm: item.lengthPerUnit || 0,
      widthCm: item.widthPerUnit || 0,
      heightCm: item.heightPerUnit || 0,
      weightKg: item.weightPerUnit || 0
    });
  };

  const handleCorrectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctingStock) return;
    setCorrectionSaving(true);
    try {
       const fn = httpsCallable(functions, 'correctStockDimensions');
       await fn({
         companyId: correctingStock.companyId,
         stockId: correctingStock.id,
         lengthCm: logisticsForm.lengthCm,
         widthCm: logisticsForm.widthCm,
         heightCm: logisticsForm.heightCm,
         weightKg: logisticsForm.weightKg
       });

       // Optymistyczna aktualizacja lokalnego stanu
       const newVolPerUnit = Number(((logisticsForm.lengthCm * logisticsForm.widthCm * logisticsForm.heightCm) / 1000000).toFixed(4));
       const newWeightPerUnit = Number(logisticsForm.weightKg.toFixed(3));
       const qty = correctingStock.qtyOnHand ?? correctingStock.onHand ?? 0;
       
       setStock(prev => prev.map(s => {
         if (s.id === correctingStock.id) {
            return {
              ...s,
              lengthPerUnit: Number(logisticsForm.lengthCm.toFixed(2)),
              widthPerUnit: Number(logisticsForm.widthCm.toFixed(2)),
              heightPerUnit: Number(logisticsForm.heightCm.toFixed(2)),
              weightPerUnit: newWeightPerUnit,
              volumePerUnit: newVolPerUnit,
              totalWeightKg: Number((qty * newWeightPerUnit).toFixed(2)),
              totalVolumeM3: Number((qty * newVolPerUnit).toFixed(4))
            };
         }
         return s;
       }));
       
       setCorrectingStock(null);
    } catch(err: any) {
       console.error(err);
       alert('Błąd podczas zapisu korekty: ' + err.message);
    } finally {
       setCorrectionSaving(false);
    }
  };

  // BACKFILL TRIGGER
  const handleBackfill = async () => {
    if (!auth.currentUser) {
      alert('Tylko zalogowany użytkownik może uruchomić ten skrypt.');
      return;
    }
    
    if (!window.confirm('Czy na pewno chcesz uruchomić pełny Backfill danych magazynowych? Zajmie to dłuższą chwilę.')) return;
    try {
      const fn = httpsCallable(functions, 'backfillWarehouseStats');
      const res = await fn();
      console.log('Backfill result:', res.data);
      alert('Backfill pomyślnie uruchomiony/zakonczony! Odśwież stronę widoku.');
    } catch(e: any) {
      console.error(e);
      alert('Błąd backfill: ' + (e.message || 'Wewnętrzny problem z połączeniem/odpowiedzią.'));
    }
  };

  // 1. Fetch Companies Stats (Zbiorczo)
  useEffect(() => {
    async function fetchCompaniesStats() {
      try {
        const snap = await getDocs(collection(db, 'companies'));
        const stats = snap.docs.map(d => {
          const data = d.data();
          const ws = data.warehouseStats || {};
          return {
            companyId: d.id,
            companyName: data.name || 'Nieznana Firma',
            companyNip: data.taxId || data.nip || '-',
            totalQtyOnHand: ws.totalQtyOnHand || 0,
            totalQtyReserved: ws.totalQtyReserved || 0,
            totalQtyAvailable: ws.totalQtyAvailable || 0,
            totalWeightKg: ws.totalWeightKg || 0,
            totalVolumeM3: ws.totalVolumeM3 || 0,
            totalSkuCount: ws.totalSkuCount || 0,
            updatedAt: ws.updatedAt || null
          } as CompanyWarehouseStats;
        }).filter(c => c.totalQtyOnHand > 0 || c.totalQtyReserved > 0 || c.totalQtyAvailable > 0);
        
        // Sortowanie po największej objętości
        stats.sort((a,b) => b.totalVolumeM3 - a.totalVolumeM3);
        setCompaniesStats(stats);
      } catch (e) {
         console.error(e);
      } finally {
         setLoadingSummary(false);
      }
    }
    fetchCompaniesStats();
  }, []);

  // 2. Fetch Paged Global Stock (Szczegółowo)
  const loadStock = async (isNextPage = false) => {
    if (isNextPage && !hasMore) return;
    
    try {
      if (isNextPage) setLoadingMore(true);
      else setLoadingDetails(true);

      let q = query(
        collectionGroup(db, 'inventoryStock'),
        orderBy('lastMovementAt', 'desc'),
        limit(20)
      );

      if (isNextPage && lastDoc) {
        q = query(q, startAfter(lastDoc));
      }

      const snap = await getDocs(q);
      const newDocs = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          companyId: data.companyId || (d.ref.parent.parent ? d.ref.parent.parent.id : ''),
          ...data
        } as GlobalStock;
      });
      
      if (isNextPage) {
        setStock(prev => [...prev, ...newDocs]);
      } else {
        setStock(newDocs);
      }

      setLastDoc(snap.docs[snap.docs.length - 1] || null);
      if (snap.docs.length < 20) setHasMore(false);
      
    } catch(e) {
      console.error(e);
    } finally {
      if (isNextPage) setLoadingMore(false);
      else setLoadingDetails(false);
    }
  };

  useEffect(() => {
    loadStock();
  }, []); 

  // K P I   A G R E G A C J A
  const { totalM3, totalKg, totalAvailable } = useMemo(() => {
    let m3=0, kg=0, av=0;
    companiesStats.forEach(c => {
       m3 += c.totalVolumeM3 || 0;
       kg += c.totalWeightKg || 0;
       av += c.totalQtyAvailable || 0;
    });
    return { totalM3: m3, totalKg: kg, totalAvailable: av };
  }, [companiesStats]);

  // F I L T R Y
  const filteredCompanies = useMemo(() => {
    if (!searchTerm) return companiesStats;
    const t = searchTerm.toLowerCase();
    return companiesStats.filter(c => 
      c.companyName.toLowerCase().includes(t) || 
      c.companyNip.toLowerCase().includes(t)
    );
  }, [companiesStats, searchTerm]);

  const filteredStock = useMemo(() => {
    if (!searchTerm) return stock;
    const t = searchTerm.toLowerCase();
    return stock.filter(item => 
      item.companyName?.toLowerCase().includes(t) || 
      item.sku?.toLowerCase().includes(t) || 
      item.productName?.toLowerCase().includes(t) || 
      item.ean?.includes(t) ||
      item.companyNip?.includes(t)
    );
  }, [stock, searchTerm]);

  return (
    <div className="w-full h-[calc(100vh-64px)] overflow-hidden flex flex-col pt-0">
      {/* Header and KPI Layer */}
      <div className="bg-white shrink-0 px-8 py-5 border-b border-[#E2E8F0] z-10 shadow-sm relative">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
           <div>
             <div className="flex items-center gap-4">
               <h1 className="text-2xl font-black italic tracking-wide text-[#0F172A] uppercase">MAGAZYN (GLOBAL)</h1>
               <button onClick={handleBackfill} className="text-[10px] font-bold uppercase tracking-widest text-[#4338CA] bg-[#EEF2FF] border border-[#C7D2FE] px-2 py-1 rounded hover:bg-[#E0E7FF] transition-colors">Uruchom Backfill</button>
             </div>
             <p className="text-[12px] font-bold text-[#64748B] uppercase tracking-widest mt-1 text-balance">Strumieniowy podgląd stanów wszystkich klientów (Paginacja & Agregowanie)</p>
           </div>
           <div className="flex bg-[#F1F5F9] p-1 rounded-xl w-full md:w-[400px]">
              <button 
                onClick={() => setActiveTab('summary')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-bold transition-all ${activeTab === 'summary' ? 'bg-white text-[#0F172A] shadow-sm' : 'text-[#64748B] hover:text-[#0F172A]'}`}
              >
                <span className="material-symbols-outlined text-[18px]">domain</span> Zbiorczo (Agregaty)
              </button>
              <button 
                onClick={() => setActiveTab('details')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-[13px] font-bold transition-all ${activeTab === 'details' ? 'bg-white text-[#0F172A] shadow-sm' : 'text-[#64748B] hover:text-[#0F172A]'}`}
              >
                <span className="material-symbols-outlined text-[18px]">list_alt</span> Szczegółowo (SKU)
              </button>
           </div>
        </div>

        <div className="flex flex-wrap items-center mt-6 gap-6">
           <div className="flex bg-[#0F172A] p-4 rounded-2xl text-white shadow-xl gap-8 relative overflow-hidden">
              <div className="absolute opacity-10 -right-4 -bottom-4">
                <span className="material-symbols-outlined text-[120px]">warehouse</span>
              </div>
              <div>
                <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Zajętość Kubatury</span>
                <span className="text-2xl font-black text-white">{totalM3.toFixed(3)} <span className="text-sm font-medium text-gray-400">m³</span></span>
              </div>
              <div>
                <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Całkowity Ciężar</span>
                <span className="text-2xl font-black text-white">{totalKg.toFixed(2)} <span className="text-sm font-medium text-gray-400">kg</span></span>
              </div>
              <div className="z-10 relative pr-4">
                <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest">Dostępnych Opak.</span>
                <span className="text-2xl font-black text-[#60A5FA]">{totalAvailable} <span className="text-sm font-medium text-[#2563EB]">szt</span></span>
              </div>
           </div>
           <div className="flex-1 min-w-[300px] relative">
             <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#94A3B8]">search</span>
             <input 
               type="text"
               value={searchTerm}
               onChange={e => setSearchTerm(e.target.value)}
               placeholder="Filtruj NIP, Firmę, Nazwę, SKU lub EAN we wczytanym raporcie..."
               className="w-full pl-12 pr-4 py-4 bg-white border border-[#CBD5E1] rounded-2xl text-[14px] focus:ring-[#4338CA] focus:border-[#4338CA] shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-shadow hover:shadow-md outline-none text-[#0F172A] font-medium placeholder:font-normal"
             />
           </div>
        </div>
      </div>

      {/* Main Content Scrollable */}
      <div className="flex-1 overflow-auto bg-[#F8FAFC] p-8">
         {/* T A B : S U M M A R Y */}
         {activeTab === 'summary' && (
           <>
             {loadingSummary ? (
                <div className="flex flex-col items-center justify-center pt-20 text-[#64748B]">
                   <span className="material-symbols-outlined animate-spin text-5xl mb-4 text-[#CBD5E1]">refresh</span>
                   <p className="font-semibold tracking-wide">Pobieranie wskaźników firmowych...</p>
                </div>
             ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 items-start">
                  {filteredCompanies.length === 0 ? (
                    <div className="col-span-full text-center py-10 text-gray-500 font-medium">Brak wyników do wyświetlenia...</div>
                  ) : filteredCompanies.map((g) => (
                    <div key={g.companyId} className="bg-white rounded-2xl p-5 border border-[#E2E8F0] shadow-sm hover:shadow-md transition-shadow relative group">
                       <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button className="text-[#94A3B8] hover:text-[#0F172A]"><span className="material-symbols-outlined text-[20px]">more_vert</span></button>
                       </div>
                       <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] uppercase tracking-widest font-black bg-[#F1F5F9] text-[#64748B] border border-[#CBD5E1] mb-4">
                          <span className="material-symbols-outlined text-[12px]">apartment</span>
                          Klient B2B
                       </span>
                       <h3 className="text-[16px] font-bold text-[#0F172A] leading-tight pr-8">{g.companyName}</h3>
                       <p className="text-[11px] font-mono font-bold text-[#64748B] tracking-wider mt-1 mb-5">NIP: {g.companyNip}</p>

                       <div className="space-y-3 bg-[#F8FAFC] p-4 rounded-xl border border-[#F1F5F9]">
                          <div className="flex justify-between items-end">
                             <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Aktualna Zajętość</span>
                             <span className="text-lg font-black text-[#0F172A]">{g.totalVolumeM3.toFixed(3)} <span className="text-xs text-[#94A3B8]">m³</span></span>
                          </div>
                          <div className="w-full bg-[#E2E8F0] h-[3px] rounded-full overflow-hidden">
                             <div className="bg-[#4338CA] h-full" style={{ width: '100%' }}></div>
                          </div>
                          <div className="flex justify-between items-end">
                             <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Waga (Load)</span>
                             <span className="text-[14px] font-bold text-[#475569]">{g.totalWeightKg.toFixed(2)} kg</span>
                          </div>
                       </div>

                       <div className="grid grid-cols-2 gap-4 mt-5 pt-4 border-t border-[#F1F5F9]">
                          <div>
                             <span className="block text-[10px] font-bold text-[#94A3B8] uppercase tracking-wider mb-1">Unikalne SKU</span>
                             <span className="text-[15px] font-black text-[#0F172A]">{g.totalSkuCount}</span>
                          </div>
                          <div>
                             <span className="block text-[10px] font-bold text-[#94A3B8] uppercase tracking-wider mb-1">Łącznie Sztuk</span>
                             <span className="text-[15px] font-black text-[#16A34A]">{g.totalQtyOnHand}</span>
                          </div>
                       </div>
                    </div>
                  ))}
                </div>
             )}
           </>
         )}

         {/* T A B : D E T A I L S */}
         {activeTab === 'details' && (
           <div className="bg-white rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden flex flex-col h-full"> {/* h-full do wypełnienia scrollowanej reszty */}
             {loadingDetails ? (
                <div className="flex flex-col items-center justify-center p-20 text-[#64748B]">
                  <span className="material-symbols-outlined animate-spin text-4xl mb-3 text-[#CBD5E1]">refresh</span>
                  <p>Ładowanie asortymentu...</p>
                </div>
             ) : (
                <div className="overflow-auto flex-1 h-[400px]"> {/* Stała/flexowa wysokość na wewn. scroll tabeli. Ale rodzic to już overflow-auto, więc zostawmy normalnie */}
                  <table className="w-full text-left border-collapse">
                     <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] sticky top-0 z-10">
                        <tr>
                           <th className="px-5 py-3.5 text-[10px] font-bold text-[#64748B] uppercase tracking-widest whitespace-nowrap bg-[#F8FAFC]">Opis Produktu / ID</th>
                           <th className="px-5 py-3.5 text-[10px] font-bold text-[#64748B] uppercase tracking-widest whitespace-nowrap bg-[#F8FAFC]">Firma (Owner)</th>
                           <th className="px-5 py-3.5 text-[10px] font-bold text-[#64748B] uppercase tracking-widest whitespace-nowrap text-right bg-[#F8FAFC]">Zapas (Dostępne)</th>
                           <th className="px-5 py-3.5 text-[10px] font-bold text-[#64748B] uppercase tracking-widest whitespace-nowrap text-right bg-[#F8FAFC]">Waga / Objętość</th>
                           <th className="px-5 py-3.5 text-[10px] font-bold text-[#64748B] uppercase tracking-widest whitespace-nowrap bg-[#F8FAFC]">Lokalizacja</th>
                           <th className="px-5 py-3.5 text-[10px] font-bold text-[#64748B] uppercase tracking-widest whitespace-nowrap bg-[#F8FAFC]">Ostatni Ruch</th>
                        </tr>
                     </thead>
                     <tbody className="divide-y divide-[#F1F5F9]">
                        {filteredStock.length === 0 ? (
                          <tr><td colSpan={6} className="text-center p-8 text-sm text-[#94A3B8] font-medium">Nic nie znaleziono...</td></tr>
                        ) : filteredStock.map(item => {
                          const avail = item.qtyAvailable ?? item.available ?? 0;
                          const res = item.qtyReserved ?? item.reserved ?? 0;
                          const onh = item.qtyOnHand ?? item.onHand ?? 0;
                          const m3 = item.totalVolumeM3 ?? item.totalVolume ?? 0;
                          const kg = item.totalWeightKg ?? item.totalWeight ?? 0;

                          return (
                          <tr key={item.id} className="hover:bg-[#F8FAFC] transition-colors group">
                            <td className="px-5 py-3">
                               <p className="text-[13px] font-bold text-[#0F172A]">{item.productName || 'Nieznany produkt'}</p>
                               <div className="flex gap-2 mt-1">
                                 <span className="text-[10px] font-mono text-[#64748B] bg-[#F1F5F9] px-1.5 py-0.5 rounded border border-[#E2E8F0]">SKU: {item.sku || '-'}</span>
                                 {item.ean && <span className="text-[10px] font-mono text-[#64748B] bg-[#F1F5F9] px-1.5 py-0.5 rounded border border-[#E2E8F0]">EAN: {item.ean}</span>}
                               </div>
                            </td>
                            <td className="px-5 py-3">
                               <p className="text-[12px] font-bold text-[#334155]">{item.companyName || 'Brak Danych'}</p>
                            </td>
                            <td className="px-5 py-3 text-right">
                               <p className="text-[14px] font-black text-[#16A34A]">{avail} <span className="text-[10px] text-[#94A3B8] uppercase font-bold">szt.</span></p>
                               <p className="text-[10px] font-medium text-[#94A3B8] uppercase tracking-widest mt-0.5">Rez: {res} | Hand: {onh}</p>
                            </td>
                            <td className="px-5 py-3 text-right">
                               <div className="flex items-center justify-end gap-2 group/cell">
                                 <div>
                                   <p className="text-[13px] font-bold text-[#475569]">{kg.toFixed(2)} kg</p>
                                   <p className="text-[11px] font-bold text-[#64748B] mt-0.5">{m3.toFixed(4)} m³</p>
                                 </div>
                                 <button 
                                   onClick={() => openLogisticsCorrection(item)}
                                   title="Korekta Logistyczna (Wymiary i Waga)"
                                   className="opacity-0 group-hover/cell:opacity-100 p-1.5 text-[#4338CA] hover:bg-[#EEF2FF] rounded-lg transition-all"
                                 >
                                   <span className="material-symbols-outlined text-[18px]">straighten</span>
                                 </button>
                               </div>
                            </td>
                            <td className="px-5 py-3">
                               <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-white border border-[#CBD5E1] text-[11px] font-bold text-[#0F172A] shadow-sm uppercase tracking-widest">
                                 <span className="material-symbols-outlined text-[14px] text-[#94A3B8]">pallet</span>
                                 {item.warehouseLocationId || item.locationId || 'BRAK'}
                               </span>
                            </td>
                            <td className="px-5 py-3">
                              {item.lastMovementAt ? (
                                <p className="text-[12px] text-[#64748B] font-medium">
                                  {new Date(item.lastMovementAt.toMillis ? item.lastMovementAt.toMillis() : item.lastMovementAt.seconds * 1000).toLocaleString()}
                                </p>
                              ) : '-'}
                            </td>
                          </tr>
                        )})}
                     </tbody>
                  </table>
                  
                  {/* Load More Trigger */}
                  {hasMore && (
                    <div className="p-4 bg-[#F8FAFC] border-t border-[#E2E8F0] flex justify-center">
                       <button
                         onClick={() => loadStock(true)}
                         disabled={loadingMore}
                         className="px-6 py-2.5 bg-white border border-[#CBD5E1] text-[#0F172A] rounded-xl text-[12px] font-bold uppercase tracking-widest hover:bg-[#F1F5F9] transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                       >
                         {loadingMore ? <span className="material-symbols-outlined animate-spin text-[16px]">refresh</span> : null}
                         Wczytaj kolejne 20 pozycji...
                       </button>
                    </div>
                  )}
                </div>
             )}
           </div>
         )}
      </div>

      {/* M O D A L : K O R E K T A   L O G I S T Y C Z N A */}
      {correctingStock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
           <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-[#E2E8F0] animate-in fade-in zoom-in duration-200">
             <div className="px-6 py-5 border-b border-[#E2E8F0] bg-[#F8FAFC]">
               <div className="flex items-center gap-3 mb-1">
                 <div className="w-10 h-10 rounded-full bg-[#EEF2FF] flex items-center justify-center text-[#4338CA]">
                    <span className="material-symbols-outlined text-[20px]">straighten</span>
                 </div>
                 <div>
                   <h3 className="text-[16px] font-black text-[#0F172A] tracking-tight">Korekta Logistyczna</h3>
                   <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-widest">{correctingStock.sku}</p>
                 </div>
               </div>
             </div>
             <form onSubmit={handleCorrectionSubmit} className="p-6 flex flex-col gap-5">
               <div className="grid grid-cols-3 gap-4">
                 <div>
                   <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-widest mb-1">Dł. (cm)</label>
                   <input type="number" step="0.1" min="0" required value={logisticsForm.lengthCm} onChange={e => setLogisticsForm({...logisticsForm, lengthCm: parseFloat(e.target.value) || 0})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] font-bold text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA]" />
                 </div>
                 <div>
                   <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-widest mb-1">Szer. (cm)</label>
                   <input type="number" step="0.1" min="0" required value={logisticsForm.widthCm} onChange={e => setLogisticsForm({...logisticsForm, widthCm: parseFloat(e.target.value) || 0})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] font-bold text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA]" />
                 </div>
                 <div>
                   <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-widest mb-1">Wys. (cm)</label>
                   <input type="number" step="0.1" min="0" required value={logisticsForm.heightCm} onChange={e => setLogisticsForm({...logisticsForm, heightCm: parseFloat(e.target.value) || 0})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] font-bold text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA]" />
                 </div>
               </div>
               <div>
                 <label className="block text-[10px] font-bold text-[#64748B] uppercase tracking-widest mb-1">Waga Jednostkowa (kg)</label>
                 <input type="number" step="0.001" min="0" required value={logisticsForm.weightKg} onChange={e => setLogisticsForm({...logisticsForm, weightKg: parseFloat(e.target.value) || 0})} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] font-bold text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA]" />
               </div>
               <div className="bg-[#F8FAFC] p-4 rounded-xl border border-[#F1F5F9] mt-2 space-y-2">
                 <div className="flex justify-between items-center">
                   <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-widest">Nowa Objętość Sztuki:</span>
                   <span className="text-[13px] font-black text-[#0F172A]">{((logisticsForm.lengthCm * logisticsForm.widthCm * logisticsForm.heightCm) / 1000000).toFixed(4)} m³</span>
                 </div>
                 <div className="flex justify-between items-center">
                   <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-widest">Wpływ na Magazyn (x{correctingStock.qtyOnHand ?? correctingStock.onHand ?? 0}):</span>
                   <span className="text-[13px] font-black text-[#4338CA]">
                     {(((logisticsForm.lengthCm * logisticsForm.widthCm * logisticsForm.heightCm) / 1000000) * (correctingStock.qtyOnHand ?? correctingStock.onHand ?? 0)).toFixed(4)} m³
                   </span>
                 </div>
               </div>
               <div className="flex justify-end gap-3 mt-2">
                 <button type="button" onClick={() => setCorrectingStock(null)} disabled={correctionSaving} className="px-5 py-2 text-[12px] font-bold uppercase tracking-widest text-[#64748B] hover:bg-[#F1F5F9] rounded-xl transition-colors">Anuluj</button>
                 <button type="submit" disabled={correctionSaving} className="px-5 py-2 text-[12px] font-bold uppercase tracking-widest bg-[#4338CA] bg-opacity-10 text-[#4338CA] hover:bg-opacity-20 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2">
                   {correctionSaving ? <span className="material-symbols-outlined animate-spin text-[16px]">refresh</span> : <span className="material-symbols-outlined text-[16px]">save</span>}
                   Zapisz Zmiany
                 </button>
               </div>
             </form>
           </div>
        </div>
      )}

    </div>
  );
}
