import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../../../auth/useAuth';
import { db, functions, storage } from '../../../firebase/config';
import { collection, query, orderBy, limit, getDocs, startAfter, where, doc, getDoc, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, getDownloadURL } from 'firebase/storage';
import { useInfiniteQuery } from '@tanstack/react-query';
import { List } from 'react-window';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { DhlShipment } from '../../../types/dhl';
import { ShipmentDetailsModal } from '../../../components/shipments/ShipmentDetailsModal';
import { GamificationShipmentProgress } from '../../../components/common/GamificationShipmentProgress';
import { AppTour } from '../../../components/common/AppTour';
import type { Step } from '../../../components/common/AppTour';

const PAGE_SIZE = 25;

export default function ShipmentsPage() {
   const { profile } = useAuth();
   const { t } = useTranslation();

   // FILTERS
   const [searchTerm, setSearchTerm] = useState('');
   const [filterStatus, setFilterStatus] = useState('all');
   const [filterSandbox, setFilterSandbox] = useState('all');
   const [filterIntegration, setFilterIntegration] = useState('all');
   const [archiveMode, setArchiveMode] = useState(false);

   // BULK ACTIONS
   const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
   const [isMerging, setIsMerging] = useState(false);
   const [mergeError, setMergeError] = useState('');
   const [detailsShipment, setDetailsShipment] = useState<any>(null);

   // STATS
   const [totalShipments, setTotalShipments] = useState<number | null>(null);

   // DEBOUNCED SEARCH
   const [debouncedSearch, setDebouncedSearch] = useState('');
   useEffect(() => {
      const handler = setTimeout(() => setDebouncedSearch(searchTerm.trim().toLowerCase()), 500);
      return () => clearTimeout(handler);
   }, [searchTerm]);

   // APP TOUR
   const [runTour, setRunTour] = useState(false);
   
   useEffect(() => {
     if (profile && !profile.completedTours?.includes('shipments_v1')) {
       const timer = setTimeout(() => setRunTour(true), 1500);
       return () => clearTimeout(timer);
     }
   }, [profile]);

   const handleTourFinish = () => setRunTour(false);

   const tourSteps: Step[] = [
     {
       target: '#tour-shipments-header',
       content: t('tour.shipments.step1', 'To jest moduł Przesyłek. Tutaj znajdziesz wszystkie wygenerowane listy przewozowe.'),
     },
     {
       target: '#tour-shipments-new',
       content: t('tour.shipments.step2', 'Kliknij ten przycisk, aby utworzyć nową przesyłkę ręcznie i wygenerować etykietę.'),
     },
     {
       target: '#tour-shipments-progress',
       content: t('tour.shipments.step3', 'Tutaj widzisz swój postęp! Nadaj 1000 przesyłek, a automatycznie zgarniesz +10 EUR na opłacenie abonamentu.'),
     }
   ];

   // LOAD STATS
   useEffect(() => {
      if (!profile?.activeCompanyId) return;
      const loadStats = async () => {
         const snap = await getDoc(doc(db, `companies/${profile.activeCompanyId}/stats/shipments`));
         if (snap.exists()) {
            const byStatus = snap.data().byStatus || {};
            const total = Object.values(byStatus).reduce((a: any, b: any) => a + b, 0) as number;
            setTotalShipments(total);
         } else {
            setTotalShipments(0);
         }
      };
      loadStats();
   }, [profile?.activeCompanyId]);

   const collectionName = archiveMode ? 'shipmentsArchive' : 'shipments';

   // REACT QUERY FETCH
   const fetchShipments = async ({ pageParam = null }: any) => {
      if (!profile?.activeCompanyId) return { docs: [], lastDoc: null };

      let q = query(collection(db, `companies/${profile.activeCompanyId}/${collectionName}`));

      if (filterStatus !== 'all') {
         q = query(q, where('status', '==', filterStatus));
      }
      if (filterSandbox !== 'all') {
         q = query(q, where('sandboxMode', '==', filterSandbox === 'true'));
      }
      if (filterIntegration !== 'all') {
         q = query(q, where('integrationId', '==', filterIntegration));
      }
      if (debouncedSearch) {
         q = query(q, where('searchTokens', 'array-contains', debouncedSearch));
      }

      // Default time boundary for non-archive
      if (!archiveMode && !debouncedSearch) { // If search is active, we might drop inequality date filter to avoid missing composite index
         const threeMonthsAgo = new Date();
         threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
         q = query(q, where('createdAt', '>=', Timestamp.fromDate(threeMonthsAgo)));
      }

      q = query(q, orderBy('createdAt', 'desc'));

      if (pageParam) {
         q = query(q, startAfter(pageParam));
      }

      q = query(q, limit(PAGE_SIZE));

      const snapshot = await getDocs(q);
      const docsData = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DhlShipment));
      return {
         docs: docsData,
         lastDoc: snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null,
         hasMore: snapshot.docs.length === PAGE_SIZE
      };
   };

   const {
      data,
      fetchNextPage,
      hasNextPage,
      isFetchingNextPage,
      status,
      refetch
   } = useInfiniteQuery({
      queryKey: ['shipments', profile?.activeCompanyId, collectionName, filterStatus, filterSandbox, filterIntegration, archiveMode, debouncedSearch],
      queryFn: fetchShipments,
      getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.lastDoc : undefined,
      initialPageParam: null,
      staleTime: 1000 * 60 * 5,
      enabled: !!profile?.activeCompanyId
   });

   const flatShipments = useMemo(() => {
      return data?.pages.flatMap(page => page.docs) || [];
   }, [data]);

   // TOGGLE SELECT
   const handleToggleSelect = (id: string) => {
      const newSet = new Set(selectedIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedIds(newSet);
   };

   const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.checked) setSelectedIds(new Set(flatShipments.map(s => s.id!)));
      else setSelectedIds(new Set());
   };

   // BULK PRINT
   const handleBulkPrint = async () => {
      if (selectedIds.size < 2) return;
      if (selectedIds.size > 100) {
         setMergeError(t('dhlShipments.maxLabelsError'));
         return;
      }
      setIsMerging(true);
      setMergeError('');
      try {
         const mergeDhlLabels = httpsCallable(functions, 'mergeDhlLabels');
         const res: any = await mergeDhlLabels({
            companyId: profile?.activeCompanyId,
            shipmentIds: Array.from(selectedIds)
         });
         const url = res.data.signedUrl || res.data.url;
         if (res.data.success && url) {
            window.open(url, '_blank');
            setSelectedIds(new Set());
         } else {
            setMergeError(res.data.message || t('dhlShipments.mergeError'));
         }
      } catch (e: any) {
         setMergeError(e.message || t('dhlShipments.mergePdfError'));
      } finally {
         setIsMerging(false);
      }
   };

   const handlePrint = async (path: string) => {
      try {
         const url = await getDownloadURL(ref(storage, path));
         window.open(url, '_blank');
      } catch (err) {
         console.error('Error fetching label:', err);
         alert(JSON.stringify(err));
      }
   };

   const cancelShipment = async (s: any) => {
      if (!confirm(t('dhlShipments.cancelConfirm', { tracking: s.trackingNumber }))) return;
      try {
         if (s.carrier === 'GLS') {
            const cancelGlsShipment = httpsCallable(functions, 'cancelGlsShipment');
            await cancelGlsShipment({ 
               companyId: profile?.activeCompanyId, 
               trackingNumber: s.trackingNumber,
               integrationId: s.integrationId,
               isGlobalBroker: s.integrationSource === 'global'
            });
            alert('Anulowano GLS');
         } else {
            const cancelDhlShipment = httpsCallable(functions, 'cancelDhlShipment');
            await cancelDhlShipment({ companyId: profile?.activeCompanyId, shipmentId: s.id });
            alert(t('dhlShipments.cancelSuccess'));
         }
         refetch();
      } catch (e: any) {
         alert(t('dhlShipments.cancelError') + e.message);
      }
   };

   // VIRTUALIZED ROW
   const Row = ({ index, style }: any) => {
      if (index === flatShipments.length) {
         return (
            <div style={style} className="flex justify-center items-center p-4">
               {hasNextPage ? (
                  <button onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="text-[#0A3D91] font-bold text-sm bg-blue-50 px-4 py-2 rounded-full hover:bg-blue-100">
                     {isFetchingNextPage ? t('dhlShipments.loadingNext') : t('dhlShipments.loadMore')}
                  </button>
               ) : (
                  <span className="text-gray-400 text-sm">{t('dhlShipments.endOfResults')}</span>
               )}
            </div>
         );
      }

      const s = flatShipments[index];
      if (!s) return null;

      const isSelected = selectedIds.has(s.id!);

      return (
         <div style={style} className={`flex items-center gap-4 px-6 py-0.5 border-b border-gray-100 bg-white hover:bg-gray-50 transition-colors ${isSelected ? 'bg-blue-50/50' : ''}`}>
            <div className="w-10">
               <input type="checkbox" checked={isSelected} onChange={() => handleToggleSelect(s.id!)} className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer" />
            </div>
            <div className="w-32 flex flex-col justify-center">
               <span className="text-[13px] font-bold text-gray-900">{s.createdAt?.toDate().toLocaleDateString('pl-PL')}</span>
               <span className="text-[11px] text-gray-500">{s.createdAt?.toDate().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="w-40 flex flex-col justify-center">
               {s.trackingNumber ? (
                  <a href={s.carrier?.toLowerCase() === 'gls_de' ? `https://gls-group.eu/track/${s.trackingNumber}` : `https://www.dhl.de/en/privatkunden/pakete-empfangen/verfolgen.html?piececode=${s.trackingNumber}`} target="_blank" rel="noreferrer" className="text-[13px] font-mono font-bold text-[#b10024] hover:underline">
                     {s.trackingNumber}
                  </a>
               ) : <span className="text-xs text-gray-400">{t('dhlShipments.noTracking')}</span>}
               {s.sandboxMode && <span className="text-[9px] bg-yellow-100 text-yellow-800 px-1 py-0.5 rounded w-fit uppercase font-bold mt-1">{t('dhlShipments.sandbox')}</span>}
            </div>

            <div className="w-48 text-[12px] truncate capitalize flex justify-center flex-col">
               <span className="font-bold text-gray-800">{s.sender?.company || s.sender?.name}</span>
               <span className="text-gray-500 text-[11px]">{s.sender?.city}, {s.sender?.country}</span>
            </div>

            <div className="w-10 flex justify-center items-center text-gray-300">
               <span className="material-symbols-outlined text-[16px]">arrow_right_alt</span>
            </div>

            <div className="w-48 text-[12px] truncate capitalize flex justify-center flex-col">
               <span className="font-bold text-gray-800">{s.recipient?.company || s.recipient?.name}</span>
               <span className="text-gray-500 text-[11px]">{s.recipient?.city}, {s.recipient?.country}</span>
            </div>

            <div className="w-24 flex justify-center items-center">
               <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${s.status === 'created' ? 'bg-blue-100 text-blue-800' : s.status === 'cancelled' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                  {s.status}
               </span>
            </div>

            <div className="flex-1 flex justify-end items-center gap-2 pr-2">
               <button onClick={() => setDetailsShipment(s)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Szczegóły">
                  <span className="material-symbols-outlined text-[18px]">info</span>
               </button>
               {s.status !== 'cancelled' && (
                  <>
                     <button onClick={() => s.labelStoragePath && handlePrint(s.labelStoragePath)} className="p-2 text-gray-400 hover:text-[#0A3D91] hover:bg-blue-50 rounded-lg" title={t('dhlShipments.printTooltip')}>
                        <span className="material-symbols-outlined text-[18px]">print</span>
                     </button>
                     <button onClick={() => cancelShipment(s)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title={t('dhlShipments.cancelTooltip')}>
                        <span className="material-symbols-outlined text-[18px]">cancel</span>
                     </button>
                  </>
               )}
            </div>
         </div>
      );
   };

   return (
      <div className="h-[calc(100vh-64px)] overflow-hidden flex flex-col bg-gray-50 relative">
         <AppTour run={runTour} steps={tourSteps} tourId="shipments_v1" eurReward={50} onFinish={handleTourFinish} />
         <div className="bg-white border-b border-gray-200 p-6 flex-shrink-0">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
               <div id="tour-shipments-header">
                  <h1 className="text-2xl font-black italic tracking-wide text-[#1A202C] flex items-center gap-3">
                     <span className="material-symbols-outlined text-[28px] text-[#b10024]">local_shipping</span>
                     {t('dhlShipments.pageTitle')}
                     {archiveMode && <span className="bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded font-bold uppercase tracking-wider ml-2 not-italic">{t('dhlShipments.archiveBadge')}</span>}
                  </h1>
                  <p className="text-gray-500 text-sm mt-1">{t('dhlShipments.pageSubtitle')}</p>
               </div>
               <div className="flex gap-3 items-center">
                  <div id="tour-shipments-progress" className="hidden sm:block">
                    <GamificationShipmentProgress shipmentsCreated={profile?.shipmentsCreated || 0} />
                  </div>
                  <div className="bg-blue-50 border border-blue-100 text-blue-800 px-4 py-2 rounded-xl text-sm font-bold flex gap-2">
                     <span className="material-symbols-outlined text-[18px]">equalizer</span>
                     {t('dhlShipments.totalInMonth')} {totalShipments !== null ? totalShipments : '...'}
                  </div>
                  <button onClick={() => { setArchiveMode(!archiveMode); setSelectedIds(new Set()); }} className="bg-white border border-gray-300 text-gray-700 font-bold text-sm px-4 py-2.5 rounded-xl hover:bg-gray-50 flex items-center gap-2">
                     <span className="material-symbols-outlined text-[18px]">inventory_2</span>
                     {archiveMode ? t('dhlShipments.showCurrent') : t('dhlShipments.showArchive')}
                  </button>
                  <Link id="tour-shipments-new" to="/app/shipments/new" className="bg-[#b10024] hover:bg-[#86001b] text-white font-bold text-sm px-6 py-2.5 rounded-xl uppercase tracking-wide flex items-center gap-2 shadow-sm">
                     <span className="material-symbols-outlined text-[18px]">add_box</span> {t('dhlShipments.newShipment')}
                  </Link>
               </div>
            </div>

            <div className="flex flex-wrap gap-4 items-center">
               <div className="relative flex-1 min-w-[200px]">
                  <span className="material-symbols-outlined absolute left-3 top-2.5 text-gray-400 text-[20px]">search</span>
                  <input type="text" placeholder={t('dhlShipments.searchPlaceholder')} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-10 pr-4 py-2 text-sm focus:ring-1 focus:ring-blue-500 outline-none" />
               </div>
               <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold text-gray-600 outline-none">
                  <option value="all">{t('dhlShipments.statusFilterAll')}</option>
                  <option value="created">{t('dhlShipments.statusFilterCreated')}</option>
                  <option value="cancelled">{t('dhlShipments.statusFilterCancelled')}</option>
               </select>
               <select value={filterIntegration} onChange={e => setFilterIntegration(e.target.value)} className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold text-gray-600 outline-none">
                  <option value="all">{t('dhlShipments.integrationFilterAll')}</option>
               </select>
               <select value={filterSandbox} onChange={e => setFilterSandbox(e.target.value)} className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold text-gray-600 outline-none">
                  <option value="all">{t('dhlShipments.sandboxFilterAll')}</option>
                  <option value="true">{t('dhlShipments.sandboxFilterTrue')}</option>
                  <option value="false">{t('dhlShipments.sandboxFilterFalse')}</option>
               </select>
            </div>
         </div>

         {/* BULK ACTIONS BAR */}
         {selectedIds.size >= 2 && (
            <div className="bg-blue-600 text-white px-6 py-3 flex justify-between items-center shadow-md animate-fade-in z-10 flex-shrink-0">
               <div className="flex items-center gap-4">
                  <span className="font-bold text-sm">{t('dhlShipments.selectedCount', { count: selectedIds.size })}</span>
                  {mergeError && <span className="text-red-200 text-xs font-bold uppercase">{mergeError}</span>}
               </div>
               <div className="flex items-center gap-3">
                  <button onClick={() => setSelectedIds(new Set())} className="text-blue-200 hover:text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded hover:bg-blue-700">{t('dhlShipments.deselectAll')}</button>
                  <button onClick={handleBulkPrint} disabled={isMerging} className="bg-white text-blue-800 hover:bg-blue-50 disabled:opacity-50 text-xs font-bold uppercase tracking-wider px-5 py-2 rounded-lg flex items-center gap-2 shadow-sm shadow-blue-900/20">
                     {isMerging ? <span className="material-symbols-outlined animate-spin text-[16px]">refresh</span> : <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>}
                     {isMerging ? t('dhlShipments.bulkMerging') : t('dhlShipments.bulkMerge')}
                  </button>
               </div>
            </div>
         )}

         {/* TABLE HEADER */}
         <div className="flex items-center gap-4 px-6 py-3 border-b border-gray-200 bg-gray-100 flex-shrink-0 shadow-sm z-0">
            <div className="w-10"><input type="checkbox" onChange={handleSelectAll} checked={flatShipments.length > 0 && selectedIds.size === flatShipments.length} className="w-4 h-4 rounded border-gray-300" /></div>
            <div className="w-32 text-[10px] font-black text-gray-500 uppercase tracking-widest">{t('dhlShipments.table.date')}</div>
            <div className="w-40 text-[10px] font-black text-gray-500 uppercase tracking-widest">{t('dhlShipments.table.tracking')}</div>
            <div className="w-48 text-[10px] font-black text-gray-500 uppercase tracking-widest flex justify-center">{t('dhlShipments.table.sender')}</div>
            <div className="w-10"></div>
            <div className="w-48 text-[10px] font-black text-gray-500 uppercase tracking-widest flex justify-center">{t('dhlShipments.table.receiver')}</div>
            <div className="w-24 text-[10px] font-black text-gray-500 uppercase tracking-widest flex justify-center">{t('dhlShipments.table.status')}</div>
            <div className="flex-1 text-[10px] font-black text-gray-500 uppercase tracking-widest text-right pr-4">{t('dhlShipments.table.actions')}</div>
         </div>

         {/* VIRTUALIZED TABLE BODY */}
         <div className="flex-1 overflow-hidden relative">
            {status === 'pending' ? (
               <div className="absolute inset-0 flex items-center justify-center p-8 bg-white/50 z-20">
                  <div className="text-center font-bold text-gray-500">{t('dhlShipments.loadingPacks')}</div>
               </div>
            ) : status === 'error' ? (
               <div className="absolute inset-0 flex items-center justify-center p-8">
                  <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 font-bold">{t('dhlShipments.fetchError')}</div>
               </div>
            ) : flatShipments.length === 0 ? (
               <div className="absolute inset-0 flex items-center justify-center p-8">
                  <div className="text-center text-gray-400 font-bold">{t('dhlShipments.noResults')}</div>
               </div>
            ) : (
               <div className="h-full w-full">
                  <List
                     style={{ height: window.innerHeight - 250, width: '100%' }}
                     rowCount={flatShipments.length + 1}
                     rowHeight={48}
                     className="scrollbar-thin scrollbar-thumb-gray-300 overflow-x-hidden"
                     rowComponent={Row}
                     rowProps={{}}
                  />
               </div>
            )}
         </div>
         <ShipmentDetailsModal shipment={detailsShipment} onClose={() => setDetailsShipment(null)} />
      </div>
   );
}
