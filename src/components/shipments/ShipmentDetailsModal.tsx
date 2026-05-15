import React from 'react';
import { X, User, MapPin, Package, Receipt, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function ShipmentDetailsModal({ shipment, onClose }: { shipment: any; onClose: () => void }) {
  const { t } = useTranslation();
  if (!shipment) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-auto flex flex-col border border-gray-200 max-h-[90vh]">
         <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0 bg-white rounded-t-xl">
           <div className="flex items-center gap-3">
             <div className="bg-blue-50 p-2 rounded-lg">
               <Info className="w-5 h-5 text-blue-600"/>
             </div>
             <div>
               <h2 className="text-lg font-bold text-gray-900">{t('shipmentDetails.title')}</h2>
               <p className="text-xs text-gray-500 font-mono tracking-wider">{shipment.trackingNumber || t('shipmentDetails.noTracking')}</p>
             </div>
           </div>
           <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors">
             <X className="w-5 h-5" />
           </button>
         </div>

         <div className="p-6 overflow-y-auto flex-1 space-y-6 bg-gray-50/50 rounded-b-xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* NADAWCA */}
                <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-gray-400 to-gray-500"></div>
                   <h3 className="font-bold text-gray-800 text-sm mb-4 border-b pb-2 flex items-center gap-2">
                       <User className="w-4 h-4 text-gray-400" /> {t('shipmentDetails.sender')}
                   </h3>
                   <div className="text-sm space-y-1 text-gray-600">
                       <div className="font-bold text-gray-900">{shipment.sender?.company || shipment.sender?.name || '-'}</div>
                       <div>{shipment.sender?.street} {shipment.sender?.streetNumber}</div>
                       <div>{shipment.sender?.zip} {shipment.sender?.city}</div>
                       <div>{shipment.sender?.country}</div>
                   </div>
                </div>

                {/* ODBIORCA */}
                <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-400 to-blue-500"></div>
                   <h3 className="font-bold text-gray-800 text-sm mb-4 border-b pb-2 flex items-center gap-2">
                       <MapPin className="w-4 h-4 text-blue-400" /> {t('shipmentDetails.recipient')}
                   </h3>
                   <div className="text-sm space-y-1 text-gray-600">
                       <div className="font-bold text-gray-900">{shipment.recipient?.company || shipment.recipient?.name || '-'}</div>
                       <div>{shipment.recipient?.street} {shipment.recipient?.streetNumber}</div>
                       <div>{shipment.recipient?.zip} {shipment.recipient?.city}</div>
                       <div>{shipment.recipient?.country}</div>
                       {shipment.recipient?.phone && <div>{t('shipmentDetails.phone')} {shipment.recipient?.phone}</div>}
                       {shipment.recipient?.email && <div>{t('shipmentDetails.email')} {shipment.recipient?.email}</div>}
                   </div>
                </div>
            </div>

            {/* PACZKA */}
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-400 to-amber-500"></div>
               <h3 className="font-bold text-gray-800 text-sm mb-4 border-b pb-2 flex items-center gap-2">
                   <Package className="w-4 h-4 text-amber-500" /> {t('shipmentDetails.parcel')}
               </h3>
               <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                   <div className="flex flex-col">
                       <span className="text-[10px] uppercase font-bold text-gray-400">{t('shipmentDetails.weight')}</span>
                       <span className="font-bold text-gray-900">{shipment.parcel?.weight} kg</span>
                   </div>
                   <div className="flex flex-col">
                       <span className="text-[10px] uppercase font-bold text-gray-400">{t('shipmentDetails.length')}</span>
                       <span className="font-bold text-gray-900">{shipment.parcel?.length || '-'} cm</span>
                   </div>
                   <div className="flex flex-col">
                       <span className="text-[10px] uppercase font-bold text-gray-400">{t('shipmentDetails.width')}</span>
                       <span className="font-bold text-gray-900">{shipment.parcel?.width || '-'} cm</span>
                   </div>
                   <div className="flex flex-col">
                       <span className="text-[10px] uppercase font-bold text-gray-400">{t('shipmentDetails.height')}</span>
                       <span className="font-bold text-gray-900">{shipment.parcel?.height || '-'} cm</span>
                   </div>
               </div>
            </div>

            {/* WYCENA */}
            <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 to-emerald-500"></div>
               <h3 className="font-bold text-gray-800 text-sm mb-4 border-b pb-2 flex items-center gap-2">
                   <Receipt className="w-4 h-4 text-emerald-500" /> {t('shipmentDetails.pricing')}
               </h3>
               
               {!shipment.billing ? (
                   <div className="text-sm text-gray-500 italic p-4 text-center bg-gray-50 rounded-lg">
                       {t('shipmentDetails.noBilling')}
                   </div>
               ) : (
                   <div className="space-y-4">
                       <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-100">
                           <span className="text-xs font-bold text-gray-500 uppercase">{t('shipmentDetails.pricingSource')}</span>
                           <span className="text-sm font-semibold text-gray-800">
                               {shipment.billing.pricingSource === 'contract' ? t('shipmentDetails.sourceContract') : 
                                shipment.billing.pricingSource === 'priceList' ? t('shipmentDetails.sourcePriceList') : 
                                shipment.billing.pricingSource || '-'}
                           </span>
                       </div>

                       {shipment.billing.breakdown && shipment.billing.breakdown.length > 0 ? (
                           <div className="border border-gray-200 rounded-lg overflow-hidden">
                               <table className="w-full text-sm text-left text-gray-600">
                                   <thead className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-200">
                                       <tr>
                                           <th className="px-4 py-2 font-semibold">{t('shipmentDetails.position')}</th>
                                           <th className="px-4 py-2 font-semibold text-right">{t('shipmentDetails.amount')}</th>
                                       </tr>
                                   </thead>
                                   <tbody className="divide-y divide-gray-100">
                                       {shipment.billing.breakdown.map((item: any, idx: number) => (
                                           <tr key={idx} className="hover:bg-gray-50">
                                               <td className="px-4 py-2 font-medium text-gray-700">{item.label}</td>
                                               <td className="px-4 py-2 text-right">{item.amount.toFixed(2)} {shipment.billing.currency}</td>
                                           </tr>
                                       ))}
                                   </tbody>
                               </table>
                           </div>
                       ) : (
                           <div className="text-sm text-gray-500 italic">{t('shipmentDetails.noBreakdown')}</div>
                       )}

                       <div className="flex justify-between items-center border-t border-gray-200 pt-4 mt-4">
                           <span className="font-black text-gray-800">{t('shipmentDetails.totalNet')}</span>
                           <span className="font-black text-lg text-emerald-600">
                               {shipment.billing.totalClientCost.toFixed(2)} {shipment.billing.currency}
                           </span>
                       </div>
                   </div>
               )}
            </div>
         </div>
      </div>
    </div>
  );
}
