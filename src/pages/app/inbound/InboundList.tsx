import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, startAfter, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db, auth } from '../../../firebase/config';
import { useAuth } from '../../../auth/useAuth';
import { useTranslation } from 'react-i18next';
import type { InboundShipment } from '../../../data/inbound';
import InboundForm from './InboundForm';
import InboundPrintModal from './InboundPrintModal';

export default function InboundList() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [shipments, setShipments] = useState<InboundShipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [pageMarkers, setPageMarkers] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [pageSize, setPageSize] = useState(20);

  const [showForm, setShowForm] = useState(false);
  const [editDraftId, setEditDraftId] = useState<string | undefined>(undefined);
  const [printShipment, setPrintShipment] = useState<InboundShipment | null>(null);

  const handleDelete = async (id: string) => {
    if (!profile?.activeCompanyId) return;
    if (!window.confirm(t('inboundList.deleteConfirm') || 'Czy na pewno chcesz usunąć tę awizację?')) return;

    try {
      setLoading(true);
      
      // Kasowanie podkolekcji items - iteracja po elementach (ponieważ Firestore JS SDK nie ma deleteCollection z poziomu klienta w łatwy sposób)
      const itemsRef = collection(db, 'companies', profile.activeCompanyId, 'inboundShipments', id, 'items');
      const itemsSnap = await getDocs(itemsRef);
      const deletePromises = itemsSnap.docs.map(d => deleteDoc(d.ref));
      await Promise.all(deletePromises);

      // Kasowanie samego dokumentu awizacji
      const docRef = doc(db, 'companies', profile.activeCompanyId, 'inboundShipments', id);
      await deleteDoc(docRef);

      loadData(true);
    } catch (err: any) {
      console.error("Delete Error:", err);
      setError(err.message || 'Błąd podczas usuwania awizacji.');
      setLoading(false);
    }
  };

  const loadData = async (isNewQuery = false) => {
    if (!profile?.activeCompanyId) return;
    setLoading(true);

    try {
      console.log("[DIAG] auth.currentUser?.uid:", auth.currentUser?.uid);
      console.log("[DIAG] profile.uid:", profile?.uid);
      console.log("[DIAG] profile.activeCompanyId:", profile?.activeCompanyId);
      console.log("[DIAG] full collection query path:", `companies/${profile.activeCompanyId}/inboundShipments`);
      
      console.log("[DIAG] Firestore config:", {
        projectId: db.app.options.projectId,
        host: (db as any)._settings?.host || "PRODUCTION (or default host)",
        isEmulator: !!(db as any)._settings?.host
      });

      const collRef = collection(db, 'companies', profile.activeCompanyId, 'inboundShipments');
      let q = query(collRef, orderBy('createdAt', 'desc'), limit(pageSize));

      if (!isNewQuery && currentPage > 0 && pageMarkers[currentPage - 1]) {
        q = query(q, startAfter(pageMarkers[currentPage - 1]));
      }

      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as InboundShipment));
      
      setShipments(data);
      setHasNextPage(snapshot.docs.length === pageSize);

      if (snapshot.docs.length > 0) {
        setPageMarkers(prev => {
          const newMarkers = [...prev];
          newMarkers[currentPage] = snapshot.docs[snapshot.docs.length - 1];
          return newMarkers;
        });
      }
    } catch (err: any) {
      console.error("InboundList Error:", err);
      setError(err.message || t('inboundList.error.fetchList'));
    } finally {
      setLoading(false);
    }
  };

  const getTransportStageData = (shipment: InboundShipment) => {
    if (shipment.status === 'draft') return { label: t('inboundList.stages.draft'), step: 0 };
    if (shipment.status === 'in_receiving') return { label: t('inboundList.stages.receiving'), step: 3 };
    if (['received_partial', 'received_complete', 'closed_with_shortage'].includes(shipment.status)) {
      return { label: t('inboundList.stages.received'), step: 4 };
    }

    if (!shipment.plannedDeliveryDate) return { label: t('inboundList.stages.advised'), step: 1 };

    const etaDate = new Date((shipment.plannedDeliveryDate as any).seconds * 1000);
    const today = new Date();
    today.setHours(0,0,0,0);
    const etaDay = new Date(etaDate);
    etaDay.setHours(0,0,0,0);

    if (etaDay > today) {
      return { label: t('inboundList.stages.advised'), step: 1 };
    } else if (etaDay.getTime() === today.getTime()) {
      return { label: t('inboundList.stages.transit'), step: 2 };
    } else {
      return { label: t('inboundList.stages.delayed'), step: 2, isError: true };
    }
  };

  useEffect(() => {
    loadData(true);
    // eslint-disable-next-line
  }, [profile?.activeCompanyId, currentPage, pageSize]);

  return (
     <div className="flex flex-col h-full gap-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('inboundList.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('inboundList.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-[#0A3D91] hover:bg-[#0A3D91]/90 text-white px-5 py-2.5 rounded-xl font-bold text-[14px] transition-colors shadow-sm"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          {t('inboundList.newInbound')}
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex-1 flex flex-col">
        <div className="overflow-x-auto flex-1 h-full min-h-[400px]">
          <table className="w-full text-left whitespace-nowrap">
            <thead className="bg-[#F8FAFC] border-b border-gray-200 sticky top-0 z-10 hidden sm:table-header-group">
              <tr>
                <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('inboundList.table.id')}</th>
                <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('inboundList.table.status')}</th>
                <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('inboundList.table.carrier')}</th>
                <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('inboundList.table.stage')}</th>
                <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Magazyn</th>
                <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">{t('inboundList.table.qty')}</th>
                <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">{t('inboundList.table.weight')}</th>
                <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">{t('inboundList.table.volume')}</th>
                <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('inboundList.table.progress')}</th>
                <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Akcje</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {error ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-red-500">
                    <span className="material-symbols-outlined text-4xl mb-2">error</span>
                    <p className="text-sm font-bold">{t('inboundList.error.readList')}</p>
                    <p className="text-[11px] mt-2 opacity-80 max-w-xl mx-auto font-mono bg-red-50 p-3 rounded">{error}</p>
                  </td>
                </tr>
              ) : loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-500">
                    <span className="material-symbols-outlined animate-spin text-3xl">refresh</span>
                    <p className="mt-2 text-sm font-medium">{t('inboundList.loading')}</p>
                  </td>
                </tr>
              ) : shipments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-500">
                    <span className="material-symbols-outlined text-4xl mb-2 text-gray-300">inventory</span>
                    <p className="text-sm font-medium text-gray-900">{t('inboundList.empty')}</p>
                  </td>
                </tr>
              ) : (
                shipments.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50/50 transition-colors group">
                    <td className="py-3 px-4">
                      <div className="font-bold text-[13px] text-gray-900">{s.id?.substring(0,8).toUpperCase()}</div>
                      <div className="text-[11px] text-gray-400">
                        {s.createdAt ? new Date((s.createdAt as any).seconds * 1000).toLocaleDateString() : '-'}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded text-[11px] font-bold tracking-widest uppercase ${
                        s.status === 'draft' ? 'bg-gray-100 text-gray-600' : 
                        s.status === 'submitted' ? 'bg-blue-50 text-blue-600' :
                        s.status === 'received_complete' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'
                      }`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                       <div className="font-bold text-[12px] text-gray-900">{s.carrier || '-'}</div>
                       <div className="text-[11px] text-[#0A3D91] font-mono">{s.trackingNumber || '-'}</div>
                    </td>
                    <td className="py-3 px-4">
                      {(() => {
                        const stage = getTransportStageData(s);
                        const totalSteps = 5;
                        return (
                          <div className="flex flex-col gap-2.5 w-[140px] pt-1">
                            <div className="flex items-center w-full px-1">
                              {Array.from({ length: totalSteps }).map((_, idx) => {
                                const isCompleted = idx < stage.step;
                                const isCurrent = idx === stage.step;
                                const isError = isCurrent && stage.isError;
                                
                                let dotColor = 'bg-gray-200';
                                if (isError) dotColor = 'bg-red-500 ring-2 ring-red-100';
                                else if (isCurrent) dotColor = 'bg-[#0A3D91] ring-2 ring-blue-100';
                                else if (isCompleted) dotColor = 'bg-[#0A3D91]';

                                let lineColor = 'bg-gray-200';
                                if (isCompleted) lineColor = 'bg-[#0A3D91] opacity-30';

                                return (
                                  <div key={idx} className={`flex items-center ${idx < totalSteps - 1 ? 'flex-1' : ''}`}>
                                    <div className={`w-[7px] h-[7px] rounded-full z-10 shrink-0 ${dotColor}`} />
                                    {idx < totalSteps - 1 && (
                                      <div className={`flex-1 h-[2px] mx-1 z-0 rounded-full ${lineColor}`} />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            <span className={`text-[10px] font-bold tracking-widest uppercase leading-none ${stage.isError ? 'text-red-500' : 'text-[#0A3D91]'}`}>
                              {stage.label}
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="py-3 px-4">
                       <div className="font-bold text-[12px] text-gray-900 text-ellipsis overflow-hidden max-w-[150px] whitespace-nowrap" title={(s as any).destinationWarehouseName || '-'}>
                          {(s as any).destinationWarehouseName || '-'}
                       </div>
                       <div className="text-[10px] text-gray-500 font-mono">{(s as any).destinationWarehouseCode || ''}</div>
                    </td>
                    <td className="py-3 px-4 text-center">
                       <span className="font-bold text-[13px]">{s.totalReceivedQty} / {s.totalExpectedQty}</span>
                    </td>
                    <td className="py-3 px-4 text-center text-[13px] text-gray-600 font-medium">
                       {['received_complete', 'received_partial', 'closed_with_shortage'].includes(s.status) ? s.totalReceivedWeight?.toFixed(2) : s.totalExpectedWeight?.toFixed(2)} kg
                    </td>
                    <td className="py-3 px-4 text-center text-[13px] text-gray-600 font-medium">
                       {['received_complete', 'received_partial', 'closed_with_shortage'].includes(s.status) ? s.totalReceivedVolume?.toFixed(4) : s.totalExpectedVolume?.toFixed(4)} m³
                    </td>
                    <td className="py-3 px-4">
                       <div className="w-full bg-gray-100 rounded-full h-1.5 mb-1">
                          <div className={`h-1.5 rounded-full ${s.receiptProgress === 100 ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${s.receiptProgress || 0}%` }}></div>
                       </div>
                       <div className="text-[10px] text-gray-400 font-bold text-right">{s.receiptProgress || 0}%</div>
                    </td>
                    <td className="py-3 px-4 text-right">
                       <div className="flex items-center justify-end gap-2">
                           <button 
                             onClick={() => setPrintShipment(s)}
                             className="text-gray-500 hover:text-[#0A3D91] bg-gray-50 hover:bg-blue-50 p-2 rounded-lg transition-colors inline-flex items-center"
                             title={t('inboundList.actions.print') || 'Drukuj manifest dostawy'}
                           >
                             <span className="material-symbols-outlined text-[18px]">print</span>
                           </button>
                         {s.status === 'draft' && (
                           <button 
                             onClick={() => { setEditDraftId(s.id); setShowForm(true); }}
                             className="text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 p-2 rounded-lg transition-colors inline-flex items-center"
                             title="Edytuj wersję roboczą"
                           >
                             <span className="material-symbols-outlined text-[18px]">edit</span>
                           </button>
                         )}
                         {(s.status === 'draft' || s.status === 'submitted') && (
                           <button 
                             onClick={() => s.id && handleDelete(s.id)}
                             className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-2 rounded-lg transition-colors inline-flex items-center"
                             title="Usuń awizację"
                           >
                             <span className="material-symbols-outlined text-[18px]">delete</span>
                           </button>
                         )}
                       </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginacja */}
        <div className="px-4 py-3 bg-white border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between sm:px-6 gap-4">
          <div className="flex items-center gap-4">
             <p className="text-[13px] font-medium text-gray-500">
               {t('inboundList.pagination.page')} <span className="font-bold text-gray-900">{currentPage + 1}</span> 
             </p>
             <div className="flex items-center gap-2 border-l border-gray-200 pl-4 h-5">
                <span className="text-[13px] font-medium text-gray-500">{t('inboundList.pagination.pageSize')}</span>
                <select 
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(0);
                    setPageMarkers([]);
                  }}
                  className="bg-transparent border-none text-[13px] font-bold text-gray-900 focus:ring-0 p-0 cursor-pointer outline-none"
                >
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
             </div>
          </div>
          <div className="flex-1 flex justify-between sm:justify-end gap-2">
            <button
              onClick={() => { setCurrentPage(p => p - 1); setShipments([]); }}
              disabled={currentPage === 0 || loading}
              className="relative inline-flex items-center px-4 py-2 border border-gray-200 text-sm font-bold rounded-xl text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm"
            >
              {t('inboundList.pagination.prev')}
            </button>
            <button
              onClick={() => { setCurrentPage(p => p + 1); setShipments([]); }}
              disabled={!hasNextPage || loading}
              className="relative inline-flex items-center px-4 py-2 border border-gray-200 text-sm font-bold rounded-xl text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm"
            >
              {t('inboundList.pagination.next')}
            </button>
          </div>
        </div>

      </div>

      {showForm && (
        <InboundForm 
          companyId={profile?.activeCompanyId!} 
          draftId={editDraftId}
          onClose={() => { 
             setShowForm(false);
             setEditDraftId(undefined);
             setCurrentPage(0); 
             setPageMarkers([]); 
             loadData(true); 
          }} 
        />
      )}

      {printShipment && (
        <InboundPrintModal 
          companyId={profile?.activeCompanyId!} 
          shipment={printShipment}
          onClose={() => setPrintShipment(null)} 
        />
      )}
    </div>
  );
}
