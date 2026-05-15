import React, { useEffect, useState } from 'react';
import { collection, query, getDocs } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { useTranslation } from 'react-i18next';
import type { InboundShipment, InboundShipmentItem } from '../../../data/inbound';

interface Props {
  companyId: string;
  shipment: InboundShipment;
  onClose: () => void;
}

export default function InboundPrintModal({ companyId, shipment, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<InboundShipmentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchItems = async () => {
      try {
        if (!shipment.id) return;
        const q = query(collection(db, `companies/${companyId}/inboundShipments/${shipment.id}/items`));
        const res = await getDocs(q);
        const data = res.docs.map(d => ({ id: d.id, ...d.data() } as InboundShipmentItem));
        setItems(data);
      } catch (err) {
        console.error('Błąd pobierania pozycji awizacji do wydruku:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchItems();
  }, [shipment.id, companyId]);

  const handlePrint = () => {
    window.print();
  };

  const etaDate = shipment.plannedDeliveryDate 
      ? new Intl.DateTimeFormat(i18n.language).format(new Date((shipment.plannedDeliveryDate as any).seconds * 1000))
      : t('print.manifest.none');
  const createdAt = shipment.createdAt 
      ? new Intl.DateTimeFormat(i18n.language).format(new Date((shipment.createdAt as any).seconds * 1000))
      : t('print.manifest.none');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm print:bg-transparent print:p-0 print:block">
      
      {/* Container - hide shadow and rounding during print */}
      <div className="bg-gray-100 shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col rounded-[24px] overflow-hidden print:w-auto print:h-auto print:shadow-none print:rounded-none select-text">
        
        {/* Navigation / Header - Hidden during print */}
        <div className="flex items-center justify-between p-6 bg-white border-b border-gray-200 shrink-0 print:hidden">
           <div>
              <h2 className="text-2xl font-black italic tracking-wide text-gray-900 uppercase">
                {t('print.preview.title')}
              </h2>
              <p className="text-xs text-gray-500 font-bold tracking-widest uppercase mt-1">
                {t('print.preview.format')}
              </p>
           </div>
           <div className="flex gap-4 items-center">
             <button 
               onClick={handlePrint} 
               disabled={loading}
               className="bg-[#0A3D91] hover:bg-[#083075] text-white px-8 py-3 rounded-xl flex items-center gap-2 font-bold uppercase tracking-widest text-sm shadow-md transition-colors disabled:opacity-50"
             >
               <span className="material-symbols-outlined">print</span> 
               {t('print.preview.button')}
             </button>
             <button 
               onClick={onClose} 
               className="w-12 h-12 flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-full transition-colors"
             >
               <span className="material-symbols-outlined text-2xl">close</span>
             </button>
           </div>
        </div>

        {/* Printable Paper Area */}
        <div className="flex-1 overflow-y-auto p-12 print:p-0 print:overflow-visible">
           
           {/* The actual "A4 page" wrapper */}
           <div id="print-area" className="max-w-[800px] mx-auto bg-white min-h-[1100px] shadow-sm p-[1cm] print:shadow-none print:m-0 print:w-full print:border-none border border-gray-200">
             
             {loading ? (
               <div className="flex flex-col items-center justify-center h-full text-gray-400">
                 <span className="material-symbols-outlined text-5xl animate-spin mb-4">refresh</span>
                 <p className="font-bold tracking-widest uppercase">{t('print.preview.loading')}</p>
               </div>
             ) : (
               <>
                 {/* Header Section */}
                 <div className="flex justify-between items-start mb-12 border-b-2 border-black pb-6">
                    <div>
                       <h1 className="text-4xl font-black uppercase tracking-tighter text-black">{t('print.manifest.title')}</h1>
                       <p className="text-sm font-bold tracking-widest text-gray-600 uppercase mt-2">Gepard Logistics Sp. z o.o.</p>
                       <p className="text-xs text-gray-500 font-mono mt-1">{t('print.manifest.generated')} {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}</p>
                    </div>
                    <div className="text-right">
                       <p className="font-mono text-4xl" style={{ fontFamily: "'Libre Barcode 39', cursive", transform: "scaleY(1.5)" }}>
                         *{shipment.id?.substring(0,8).toUpperCase()}*
                       </p>
                       <p className="text-sm font-bold tracking-widest font-mono text-gray-800 uppercase mt-2">
                         ID: {shipment.id?.substring(0,8).toUpperCase()}
                       </p>
                    </div>
                 </div>

                 {/* Information Grid */}
                 <div className="grid grid-cols-2 gap-8 mb-12">
                    <div>
                       <h3 className="text-[10px] font-black tracking-widest text-gray-400 uppercase mb-2">{t('print.manifest.transport')}</h3>
                       <div className="bg-gray-50 border border-gray-200 p-4 font-mono text-sm">
                          <p className="mb-2"><span className="text-gray-500">{t('print.manifest.carrier')}</span> <strong className="text-black">{shipment.carrier || t('print.manifest.noData')}</strong></p>
                          <p className="mb-2"><span className="text-gray-500">{t('print.manifest.waybill')}</span> <strong className="text-black">{shipment.trackingNumber || t('print.manifest.noData')}</strong></p>
                          <p className="mb-2"><span className="text-gray-500">{t('print.manifest.eta')}</span> <strong className="text-black">{etaDate}</strong></p>
                          <p><span className="text-gray-500">{t('print.manifest.createdAt')}</span> <strong className="text-black">{createdAt}</strong></p>
                       </div>
                    </div>
                    <div>
                       <h3 className="text-[10px] font-black tracking-widest text-gray-400 uppercase mb-2">{t('print.manifest.warehouse')}</h3>
                       <div className="bg-gray-50 border border-gray-200 p-4 font-mono text-sm h-[134px]">
                          <p className="font-bold text-black uppercase mb-1">{(shipment as any).destinationWarehouseName || 'Gepard Fulfillment'}</p>
                          <p className="text-gray-600">{(shipment as any).destinationWarehouseCode || 'MG-1'}</p>
                       </div>
                    </div>
                 </div>

                 {/* Items Table */}
                 <div className="mb-12">
                    <h3 className="text-[10px] font-black tracking-widest text-gray-400 uppercase mb-2">{t('print.manifest.contents')}</h3>
                    <table className="w-full text-left font-mono border-collapse">
                      <thead>
                        <tr className="bg-black text-white">
                          <th className="py-2 px-3 text-[11px] font-bold uppercase tracking-wider border border-black">{t('print.manifest.no')}</th>
                          <th className="py-2 px-3 text-[11px] font-bold uppercase tracking-wider border border-black w-[40%]">{t('print.manifest.product')}</th>
                          <th className="py-2 px-3 text-[11px] font-bold uppercase tracking-wider border border-black w-[20%]">SKU</th>
                          <th className="py-2 px-3 text-[11px] font-bold uppercase tracking-wider border border-black text-center">{t('print.manifest.quantity')}</th>
                        </tr>
                      </thead>
                      <tbody>
                         {items.length === 0 ? (
                           <tr>
                              <td colSpan={4} className="py-8 text-center text-gray-500 italic border border-gray-300">{t('print.manifest.emptyItems')}</td>
                           </tr>
                         ) : (
                           items.map((item, index) => (
                             <tr key={item.id} className="border-b border-gray-300">
                                <td className="py-3 px-3 border border-gray-300 text-center text-xs">{index + 1}</td>
                                <td className="py-3 px-3 border border-gray-300">
                                   <div className="font-bold text-black text-xs truncate max-w-[250px]">{item.name}</div>
                                   {item.ean && <div className="text-[10px] text-gray-500 mt-0.5">EAN: {item.ean}</div>}
                                </td>
                                <td className="py-3 px-3 border border-gray-300 text-xs font-bold">{item.sku || '-'}</td>
                                <td className="py-3 px-3 border border-gray-300 text-center font-black text-black">
                                  {new Intl.NumberFormat(i18n.language).format(item.expectedQty)} {t('print.manifest.unit')}
                                </td>
                             </tr>
                           ))
                         )}
                      </tbody>
                    </table>
                 </div>

                 {/* Signatures Area */}
                 <div className="mt-20 pt-8 border-t border-gray-300 grid grid-cols-3 gap-8 text-center">
                    <div>
                       <div className="border-b border-gray-400 h-16 w-full mx-auto mb-2"></div>
                       <p className="text-[10px] font-bold tracking-widest uppercase text-gray-500">{t('print.manifest.signatureDriver')}</p>
                    </div>
                    <div>
                       <div className="border-b border-gray-400 h-16 w-full mx-auto mb-2"></div>
                       <p className="text-[10px] font-bold tracking-widest uppercase text-gray-500">{t('print.manifest.dateAndTime')}</p>
                    </div>
                    <div>
                       <div className="border-b border-gray-400 h-16 w-full mx-auto mb-2"></div>
                       <p className="text-[10px] font-bold tracking-widest uppercase text-gray-500">{t('print.manifest.signatureReceiver')}</p>
                    </div>
                 </div>

               </>
             )}
           </div>

        </div>
      </div>
    </div>
  );
}
