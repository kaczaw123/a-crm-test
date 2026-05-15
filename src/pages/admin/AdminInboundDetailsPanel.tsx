import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { type InboundShipment, type InboundShipmentItem, startReceiptTransactionCallable, saveInboundReceiptItemDraftCallable, finalizeInboundShipmentCallable, forceCloseInboundShipmentCallable } from '../../data/inbound';

interface Props {
  shipmentId: string;
  companyId: string;
  fallbackNip?: string;
  onClose: () => void;
}

export default function AdminInboundDetailsPanel({ shipmentId, companyId, fallbackNip, onClose }: Props) {
  const [shipment, setShipment] = useState<InboundShipment | null>(null);
  const [items, setItems] = useState<InboundShipmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  
  // Stan wprowadzanych ilości do odbioru
  const [receiveInputs, setReceiveInputs] = useState<Record<string, number>>({});
  const [warehouseLocationId, setWarehouseLocationId] = useState('MAIN_FALLBACK'); // W idealnym systemie pobierane z DB

  // Stan dla poprawek logistycznych { [itemId]: { weight, length, width, height, isActive } }
  interface CorrectionState {
    isActive: boolean;
    weight: string;
    length: string;
    width: string;
    height: string;
  }
  const [corrections, setCorrections] = useState<Record<string, CorrectionState>>({});
  const [editingItems, setEditingItems] = useState<Record<string, boolean>>({});
  const [itemSaving, setItemSaving] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const unsubShipment = onSnapshot(doc(db, `companies/${companyId}/inboundShipments`, shipmentId), (docSnap) => {
      if (docSnap.exists()) {
        setShipment({ id: docSnap.id, ...docSnap.data() } as InboundShipment);
      }
    });

    const unsubItems = onSnapshot(collection(db, `companies/${companyId}/inboundShipments/${shipmentId}/items`), (snap) => {
      const its = snap.docs.map(d => ({ id: d.id, ...d.data() } as InboundShipmentItem));
      setItems(its);
      setLoading(false);
    });

    return () => {
      unsubShipment();
      unsubItems();
    };
  }, [shipmentId, companyId]);

  const handleStartReceiving = async () => {
    setActionLoading(true);
    try {
      await startReceiptTransactionCallable({ shipmentId, companyId });
    } catch (e: any) {
      alert(`Błąd: ${e.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDraftItem = async (itemId: string, diff: number, currentDraftQty?: number) => {
    let qtyValue = receiveInputs[itemId];
    // Jeśli pracownik nie zmodyfikował inputu, pobieramy domyślną wartość wyświetlaną wizualnie
    if (qtyValue === undefined) {
      qtyValue = currentDraftQty !== undefined ? currentDraftQty : diff;
    }

    if (qtyValue === null || qtyValue < 0) {
      alert("Wprowadź ilość większą lub równą 0.");
      return;
    }

    let corrPayload = undefined;
    const corr = corrections[itemId];
    if (corr && corr.isActive) {
      const w = Number(corr.weight);
      const l = Number(corr.length);
      const wid = Number(corr.width);
      const h = Number(corr.height);
      if (isNaN(w) || isNaN(l) || isNaN(wid) || isNaN(h) || w <= 0 || l <= 0 || wid <= 0 || h <= 0) {
        alert('Błąd w parametrach korekty: wszystkie wymiary i waga muszą być liczbami większymi od 0.');
        return;
      }
      corrPayload = { weightKg: w, lengthCm: l, widthCm: wid, heightCm: h };
    }

    setItemSaving(prev => ({ ...prev, [itemId]: true }));
    try {
      await saveInboundReceiptItemDraftCallable({
         companyId,
         shipmentId,
         itemId: itemId,
         receivedQty: qtyValue,
         ...(corrPayload || {})
      });
      // Sukces - UI samo pobierze nowe dane i odrysuje stan zatwierdzony roboczo!
      setEditingItems(prev => ({ ...prev, [itemId]: false }));
    } catch(e: any) {
      alert(`Błąd: ${e.message}`);
    } finally {
      setItemSaving(prev => ({ ...prev, [itemId]: false }));
    }
  };

  const handleFinalizeShipment = async () => {
    // Walidacja – upewnijmy się, że wszystkie pozycje są zaznaczone jako "draftCompleted"
    const uncompletedNames = items.filter(i => !i.draftCompleted && i.draftReceivedQty === undefined).map(i => i.name).join(', ');
    if (uncompletedNames) {
      alert(`Nie zatwierdzono jeszcze poniższych pozycji roboczo:\n${uncompletedNames}\n\nMusisz wcisnąć [Zatwierdź] przy każdej sztuce przed finalizacją.`);
      return;
    }

    const conf = window.confirm("⚠️ TWARDE ZAMKNIĘCIE ROZŁADUNKU ⚠️\n\nCzy jesteś absolutnie pewien, że chcesz bezpowrotnie zatwierdzić tę awizację? Od tej pory normalna modyfikacja będzie niemożliwa.\nModyfikacje po twardym zamknięciu wprowadzają korekty księgowe do konta klienta z audytem.");
    if (!conf) return;

    setActionLoading(true);
    try {
      await finalizeInboundShipmentCallable({ companyId, shipmentId });
      onClose();
    } catch(e: any) {
      alert(`Błąd: ${e.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleForceClose = async () => {
    const p = prompt('Podaj powód siłowego zamknięcia (Override) i niezgodności awizacji z faktycznym stanem:');
    if (!p) return;
    setActionLoading(true);
    try {
      await forceCloseInboundShipmentCallable({
        companyId,
        shipmentId,
        closeReason: p,
        closeNote: 'Wymuszone przez superadmin'
      });
      onClose(); // Po siłowym zamykamy panel
    } catch(e: any) {
       alert(`Błąd: ${e.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading || !shipment) {
     return <div className="p-8 text-center bg-white h-full shadow-2xl overflow-y-auto">Ładowanie szczegółów awizacji...</div>;
  }

  const isReceivingActive = shipment.status === 'in_receiving' && shipment.lockedBy !== null;
  const isClosed = shipment.status === 'received_complete' || shipment.status === 'closed_with_shortage';

  return (
    <div className="w-full lg:w-[600px] bg-white h-full shadow-2xl flex flex-col z-50 animate-slide-in relative border-l border-gray-200">
      <div className="flex justify-between items-center p-5 border-b border-gray-100 bg-gray-50 shrink-0">
        <div>
           <h2 className="text-lg font-black italic tracking-wide text-gray-900 flex items-center gap-2">
             <span className="material-symbols-outlined text-blue-600">trolley</span>
             AWIZACJA #{shipment.id?.substring(0,8).toUpperCase()}
           </h2>
           <p className="text-xs text-gray-500 font-medium">Globalny identyfikator: {shipmentId}</p>
        </div>
        <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-200 rounded-full transition-colors">
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 scrollbar-hide space-y-6 bg-white">
        
        {/* Sekcja Metadanych */}
        <div className="grid grid-cols-2 gap-4">
           <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
             <span className="block text-[10px] uppercase font-bold text-gray-500 tracking-wider">Firma NIP</span>
             <span className="text-sm font-semibold text-gray-900">{(shipment as any).companyNip || fallbackNip || 'Brak NIP'}</span>
           </div>
           <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
             <span className="block text-[10px] uppercase font-bold text-gray-500 tracking-wider">Status Odbioru</span>
             <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[11px] font-bold tracking-widest uppercase bg-blue-100 text-blue-800">
               {shipment.status}
             </span>
           </div>
           <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
             <span className="block text-[10px] uppercase font-bold text-gray-500 tracking-wider">Ilość całościowa</span>
             <span className="text-sm font-semibold text-gray-900">{shipment.totalReceivedQty} / {shipment.totalExpectedQty} szt.</span>
           </div>
           <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
             <span className="block text-[10px] uppercase font-bold text-gray-500 tracking-wider">Objętość całościowa</span>
             <span className="text-sm font-semibold text-gray-900">
               {['received_complete', 'received_partial', 'closed_with_shortage'].includes(shipment.status) ? 
                 (shipment.totalReceivedVolume || 0).toFixed(3) : 
                 (shipment.totalExpectedVolume || 0).toFixed(3)} m³
             </span>
           </div>
        </div>

        {/* Sekcja Różnic (Progress) */}
        {!isClosed && (
            <div className="pt-2">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold text-gray-700">Progres Rejestracji:</span>
                <span className="text-[11px] font-bold text-blue-600">{shipment.receiptProgress || 0}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${shipment.receiptProgress || 0}%` }}></div>
              </div>
            </div>
        )}

        {/* Tabela Pozycji (Items) */}
        <div>
           <div className="flex items-center justify-between mb-3 border-b pb-2">
             <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
               Skład Awizacji 
               <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{items.length} pozycji</span>
             </h3>
             {isReceivingActive && (
               <button 
                 onClick={() => {
                   const newInputs = { ...receiveInputs };
                   items.forEach(item => {
                     const diff = (item.expectedQty || 0) - (item.receivedQty || 0);
                     if (diff > 0 && item.id) newInputs[item.id] = diff;
                   });
                   setReceiveInputs(newInputs);
                 }}
                 disabled={actionLoading}
                 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg border border-blue-200 transition-colors"
               >
                 <span className="material-symbols-outlined text-[16px]">done_all</span>
                 Wypełnij w 100%
               </button>
             )}
           </div>

           <div className="space-y-3">
             {items.map(item => {
                const diff = (item.expectedQty || 0) - (item.receivedQty || 0);
                const isHistoricallyCompleted = diff <= 0;
                
                // Tryb WMS
                const isStaged = item.draftCompleted && !editingItems[item.id!];
                const displayQty = isStaged ? item.draftReceivedQty : item.receivedQty;

                return (
                  <div key={item.id} className={`p-4 rounded-xl border ${isStaged || isHistoricallyCompleted ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200 shadow-sm'} flex flex-col gap-2 transition-all`}>
                     <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className={`text-[13px] font-bold ${isStaged || isHistoricallyCompleted ? 'text-green-800' : 'text-gray-900'}`}>
                             {item.name || 'Produkt Nieznany'}
                             {isStaged && <span className="ml-2 inline-block px-2 text-[9px] uppercase tracking-widest bg-green-200 text-green-800 rounded">Roboczy Szkic</span>}
                          </p>
                          <p className="text-[11px] text-gray-500 font-mono mt-0.5">SKU: {item.sku || '-'} | EAN: {item.ean || 'Brak'}</p>
                          <div className="flex items-center mt-1.5">
                            {item.draftWeightPerUnit || item.weightPerUnit > 0 || item.volumePerUnit > 0 ? (
                              <div className="inline-flex flex-wrap items-center gap-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                <span className="flex items-center">
                                  <span className="material-symbols-outlined text-[12px] mr-1">scale</span>
                                  {isStaged ? (item.draftWeightPerUnit ?? item.weightPerUnit ?? 0) : (item.weightPerUnit || 0)} kg &nbsp;|&nbsp; {isStaged ? (item.draftVolumePerUnit ?? item.volumePerUnit ?? 0) : (item.volumePerUnit || 0)} m³
                                </span>
                                {(item.draftLengthPerUnit || item.lengthPerUnit || item.widthPerUnit || item.heightPerUnit) ? (
                                  <span className="flex items-center border-l border-blue-200 pl-2">
                                    <span className="material-symbols-outlined text-[12px] mr-1">straighten</span>
                                    {isStaged ? (item.draftLengthPerUnit ?? item.lengthPerUnit ?? 0) : (item.lengthPerUnit || 0)}x{isStaged ? (item.draftWidthPerUnit ?? item.widthPerUnit ?? 0) : (item.widthPerUnit || 0)}x{isStaged ? (item.draftHeightPerUnit ?? item.heightPerUnit ?? 0) : (item.heightPerUnit || 0)} cm
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
                                <span className="material-symbols-outlined text-[12px] mr-1">warning</span>
                                Brak podanej wagi / wymiarów
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right ml-3 flex flex-col items-end">
                           <span className="text-[10px] uppercase font-bold text-gray-500 block">Zrealizowano</span>
                           <span className={`text-lg font-black ${isStaged || isHistoricallyCompleted ? 'text-green-600' : 'text-gray-900'}`}>
                             {displayQty || 0} <span className="text-sm text-gray-400">/ {item.expectedQty}</span>
                           </span>
                           {/* Przycisk edycji rozliczonego wcześniej elementu */}
                           {isReceivingActive && isStaged && !isHistoricallyCompleted && (
                             <button
                               onClick={() => setEditingItems({ ...editingItems, [item.id!]: true })}
                               disabled={actionLoading || itemSaving[item.id!]}
                               className="mt-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-0.5 rounded-md transition-colors disabled:opacity-50"
                             >
                                <span className="material-symbols-outlined text-[14px]">edit</span> Edytuj
                             </button>
                           )}
                        </div>
                     </div>

                     {/* Tryb Wprowadzania Odbioru (Bufor WMS) */}
                     {isReceivingActive && !isStaged && !isHistoricallyCompleted && (
                       <div className="mt-2 pt-2 border-t border-gray-100/50 flex flex-col gap-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                             <button 
                               onClick={() => {
                                 setCorrections(prev => ({
                                   ...prev,
                                   [item.id!]: {
                                     isActive: !prev[item.id!]?.isActive,
                                     weight: prev[item.id!]?.weight || (item.draftWeightPerUnit ? String(item.draftWeightPerUnit) : (item.weightPerUnit ? String(item.weightPerUnit) : '')),
                                     length: prev[item.id!]?.length || (item.draftLengthPerUnit ? String(item.draftLengthPerUnit) : (item.lengthPerUnit ? String(item.lengthPerUnit) : '')),
                                     width: prev[item.id!]?.width || (item.draftWidthPerUnit ? String(item.draftWidthPerUnit) : (item.widthPerUnit ? String(item.widthPerUnit) : '')),
                                     height: prev[item.id!]?.height || (item.draftHeightPerUnit ? String(item.draftHeightPerUnit) : (item.heightPerUnit ? String(item.heightPerUnit) : ''))
                                   }
                                 }))
                               }}
                               disabled={actionLoading || itemSaving[item.id!]}
                               className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1.5 rounded-md transition-colors disabled:opacity-50 ${corrections[item.id!]?.isActive ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                             >
                               {corrections[item.id!]?.isActive ? 'Anuluj Korektę' : '+ Korekta Logistyczna'}
                             </button>

                             <div className="flex flex-1 md:flex-none justify-end gap-2 items-center">
                               <div className="flex items-center gap-2">
                                 <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest">SZT:</span>
                                 <input 
                                   type="number" min="0" max={diff}
                                   value={receiveInputs[item.id!] ?? (item.draftReceivedQty ?? diff)}
                                   onChange={(e) => setReceiveInputs({ ...receiveInputs, [item.id!]: parseInt(e.target.value) || 0 })}
                                   disabled={actionLoading || itemSaving[item.id!]}
                                   className="w-20 bg-gray-50 border border-gray-300 text-gray-900 text-sm font-bold rounded-lg px-2 py-1.5 focus:ring-blue-500 focus:border-blue-500 outline-none text-center disabled:opacity-50"
                                 />
                               </div>
                               <button 
                                 onClick={async () => {
                                    await handleDraftItem(item.id!, diff, item.draftReceivedQty);
                                 }}
                                 disabled={actionLoading || itemSaving[item.id!]}
                                 className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs uppercase tracking-widest transition-colors disabled:opacity-50 min-w-[120px] justify-center"
                               >
                                 {itemSaving[item.id!] ? <span className="material-symbols-outlined text-[16px] animate-spin">refresh</span> : <span className="material-symbols-outlined text-[16px]">check_circle</span>}
                                 {itemSaving[item.id!] ? 'Zapis...' : 'Zatwierdź'}
                               </button>
                             </div>
                          </div>

                          {corrections[item.id!]?.isActive && (
                            <div className="bg-amber-50 rounded-lg p-3 border border-amber-100 grid grid-cols-4 gap-2 animate-slide-in opacity-90 transition-opacity aria-disabled:opacity-50">
                               <div>
                                 <label className="block text-[10px] font-bold text-amber-800 mb-0.5">Waga (kg)</label>
                                 <input type="number" step="any" min="0.001" value={corrections[item.id!].weight} onChange={e => setCorrections({...corrections, [item.id!]: {...corrections[item.id!], weight: e.target.value}})} disabled={actionLoading || itemSaving[item.id!]} className="w-full text-xs px-2 py-1 border border-amber-200 rounded focus:ring-1 focus:ring-amber-500 outline-none disabled:bg-amber-100 disabled:opacity-70" placeholder="0.0" />
                               </div>
                               <div>
                                 <label className="block text-[10px] font-bold text-amber-800 mb-0.5">Dług. (cm)</label>
                                 <input type="number" step="any" min="0.1" value={corrections[item.id!].length} onChange={e => setCorrections({...corrections, [item.id!]: {...corrections[item.id!], length: e.target.value}})} disabled={actionLoading || itemSaving[item.id!]} className="w-full text-xs px-2 py-1 border border-amber-200 rounded focus:ring-1 focus:ring-amber-500 outline-none disabled:bg-amber-100 disabled:opacity-70" placeholder="0.0" />
                               </div>
                               <div>
                                 <label className="block text-[10px] font-bold text-amber-800 mb-0.5">Szer. (cm)</label>
                                 <input type="number" step="any" min="0.1" value={corrections[item.id!].width} onChange={e => setCorrections({...corrections, [item.id!]: {...corrections[item.id!], width: e.target.value}})} disabled={actionLoading || itemSaving[item.id!]} className="w-full text-xs px-2 py-1 border border-amber-200 rounded focus:ring-1 focus:ring-amber-500 outline-none disabled:bg-amber-100 disabled:opacity-70" placeholder="0.0" />
                               </div>
                               <div>
                                 <label className="block text-[10px] font-bold text-amber-800 mb-0.5">Wys. (cm)</label>
                                 <input type="number" step="any" min="0.1" value={corrections[item.id!].height} onChange={e => setCorrections({...corrections, [item.id!]: {...corrections[item.id!], height: e.target.value}})} disabled={actionLoading || itemSaving[item.id!]} className="w-full text-xs px-2 py-1 border border-amber-200 rounded focus:ring-1 focus:ring-amber-500 outline-none disabled:bg-amber-100 disabled:opacity-70" placeholder="0.0" />
                               </div>
                            </div>
                          )}
                       </div>
                     )}
                  </div>
                )
             })}
           </div>
        </div>
      </div>

      {/* Kontrolki Akcji (Na dole Drawera) */}
      <div className="p-5 border-t border-gray-100 bg-white shrink-0 flex flex-col gap-3">
         {isClosed ? (
           <div className="bg-gray-100 p-3 rounded-lg text-center flex items-center justify-center gap-2 text-gray-600 text-[13px] font-bold uppercase tracking-wider">
             <span className="material-symbols-outlined text-[18px]">lock</span>
             Awizacja jest zamknięta
           </div>
         ) : (!isReceivingActive && shipment.status !== 'received_partial') ? (
           <button 
             onClick={handleStartReceiving} 
             disabled={actionLoading || shipment.status === 'draft'}
             className="w-full flex items-center justify-center gap-2 py-3 bg-[#0A3D91] hover:bg-[#083075] text-white rounded-xl font-bold uppercase tracking-widest text-[13px] transition-colors disabled:opacity-50"
           >
             {actionLoading ? <span className="material-symbols-outlined animate-spin">refresh</span> : <span className="material-symbols-outlined">trolley</span>}
             Rozpocznij Rozładunek
           </button>
         ) : (
           <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                 <button 
                   onClick={handleFinalizeShipment}
                   disabled={actionLoading || items.some(i => !i.draftCompleted && i.draftReceivedQty === undefined)}
                   title={items.some(i => !i.draftCompleted && i.draftReceivedQty === undefined) ? 'Zatwierdź najpierw wszystkie pozycje roboczo' : ''}
                   className="flex-1 flex items-center justify-center gap-2 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold uppercase tracking-widest text-[13px] transition-colors disabled:opacity-50"
                 >
                   {actionLoading ? <span className="material-symbols-outlined animate-spin">refresh</span> : <span className="material-symbols-outlined">task_alt</span>}
                   ZATWIERDŹ AWIZACJĘ OSTATECZNIE
                 </button>
              </div>
              <button 
                 onClick={handleForceClose}
                 disabled={actionLoading}
                 className="w-full mt-1 flex items-center justify-center gap-2 py-2.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 rounded-xl font-bold uppercase tracking-widest text-[12px] transition-colors disabled:opacity-50"
               >
                 <span className="material-symbols-outlined text-[16px]">warning</span>
                 Zamknij jako Brakujące (Override)
               </button>
           </div>
         )}
      </div>

    </div>
  );
}
