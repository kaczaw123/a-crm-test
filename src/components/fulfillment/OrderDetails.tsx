import React, { useState } from 'react';
import type { FulfillmentTask } from '../../types/fulfillment';
import { ScanInput } from './ScanInput';
import { ProductItem } from './ProductItem';

interface OrderDetailsProps {
  task: FulfillmentTask | null;
  packingState: 'IDLE' | 'SCANNING_ITEMS' | 'SCANNING_LABEL' | 'COMPLETED';
  cartonSuggestion: any;
  onScanEan: (ean: string) => void;
  onReportException: (reason: string) => void;
}

export const OrderDetails: React.FC<OrderDetailsProps> = ({
  task,
  packingState,
  cartonSuggestion,
  onScanEan,
  onReportException
}) => {
  const [scanValue, setScanValue] = useState('');

  if (!task) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#181A20] text-gray-500">
        <span className="material-symbols-outlined text-6xl mb-4 opacity-50">inbox</span>
        <h2 className="text-xl font-medium">Brak aktywnego zamówienia</h2>
        <p className="mt-2 text-sm text-gray-600">Wybierz zadanie z listy po lewej stronie, aby rozpocząć proces kompletacji.</p>
      </div>
    );
  }

  const handleScanSubmit = () => {
    onScanEan(scanValue.trim());
    setScanValue('');
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181A20] text-gray-200 overflow-hidden">
      
      {/* Top Action Bar */}
      <div className="p-4 flex items-center justify-between border-b border-[#2A2E37] shrink-0">
        <div className="flex items-baseline gap-3">
          <h2 className="text-2xl font-bold text-white tracking-tight">
             {task.referenceNumber || task.orderId}
          </h2>
          {task.trackingNumber && (
            <span className="text-gray-400 text-sm font-medium flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">local_shipping</span>
              {task.carrier || 'Kurier'}: {task.trackingNumber}
            </span>
          )}
        </div>
        
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-[#2A2E37] hover:bg-[#374151] rounded-full text-[13px] font-semibold transition border border-transparent">
            Zmiana statusu na BŁĘDNE
          </button>
          <button 
            onClick={async () => {
                if (!task?.orderId || !task?.companyId) return;
                try {
                    const { db, storage } = await import('../../firebase/config');
                    const { doc, getDoc } = await import('firebase/firestore');
                    const { ref, getDownloadURL } = await import('firebase/storage');
                    const { toast } = await import('react-hot-toast');
                    
                    const orderSnap = await getDoc(doc(db, `companies/${task.companyId}/orders/${task.orderId}`));
                    const labelPath = orderSnap.data()?.labelStoragePath;
                    if (!labelPath) {
                        toast.error('Nie znaleziono etykiety. Czy na pewno została wygenerowana?');
                        return;
                    }
                    const url = await getDownloadURL(ref(storage, labelPath));
                    window.open(url, '_blank');
                } catch (e: any) {
                    const { toast } = await import('react-hot-toast');
                    toast.error('Błąd pobierania etykiety: ' + e.message);
                }
            }}
            className="px-4 py-2 bg-[#2A2E37] hover:bg-[#374151] rounded-full text-[13px] font-semibold transition border border-transparent">
            Ponowny wydruk
          </button>
          <button 
            onClick={() => onReportException('Short pick zgłoszony z panelu operatora')}
            className="px-4 py-2 bg-red-900/40 text-red-400 hover:bg-red-900/60 rounded-full text-[13px] font-bold transition border border-red-900/50"
          >
            BRAK STANU
          </button>
        </div>
      </div>

      {/* Main Working Area */}
      <div className="flex-1 overflow-y-auto p-6 scrollbar-hide flex flex-col gap-6 relative">
        
        {/* Overlay do skanowania etykiety finalnej */}
        {packingState === 'SCANNING_LABEL' && (
          <div className="absolute inset-0 z-20 bg-[#181A20]/90 backdrop-blur-sm flex flex-col items-center justify-center p-8">
             <div className="bg-[#1E222A] p-8 rounded-2xl border border-blue-500/30 max-w-lg w-full text-center shadow-2xl">
               <span className="material-symbols-outlined text-blue-500 text-6xl mb-4">qr_code_scanner</span>
               <h3 className="text-2xl font-bold text-white mb-2">Zeskanuj Etykietę</h3>
               <p className="text-gray-400 mb-8">Wszystkie przedmioty spakowane. Potwierdź zeskanowaniem tracking numberu na etykiecie kurierskiej.</p>
               <ScanInput 
                  value={scanValue} 
                  onChange={setScanValue} 
                  onSubmit={handleScanSubmit} 
                  disabled={false} 
                  autoFocus={true} 
               />
             </div>
          </div>
        )}

        {/* Scan Input (visible when scanning items) */}
        {packingState === 'SCANNING_ITEMS' && (
          <div className="mb-2 shrink-0">
            <ScanInput 
              value={scanValue} 
              onChange={setScanValue} 
              onSubmit={handleScanSubmit} 
              disabled={packingState !== 'SCANNING_ITEMS'} 
            />
          </div>
        )}

        {/* Suggested Carton */}
        {cartonSuggestion && (
          <div className="bg-[#1E3A8A]/20 border border-blue-900 p-4 rounded-xl flex items-center justify-between shrink-0">
             <div className="flex items-center gap-3">
               <span className="material-symbols-outlined text-blue-400 text-3xl">inventory_2</span>
               <div className="text-left">
                 <h4 className="text-blue-200 font-bold uppercase tracking-wide text-[12px]">📦 Sugerowany Karton</h4>
                 <p className="text-white font-medium text-lg">{cartonSuggestion.name} <span className="text-gray-400 text-sm font-normal">({cartonSuggestion.dimensions || 'Brak wymiarów'})</span></p>
               </div>
             </div>
             <div className="text-right text-sm text-blue-300 font-medium">
               <p>Max waga: {cartonSuggestion.maxWeight || '?'} kg</p>
             </div>
          </div>
        )}

        {/* Items List */}
        <div className="flex flex-col gap-3">
          {!task.items || task.items.length === 0 ? (
            <div className="text-center p-8 border border-dashed border-[#374151] rounded-xl text-gray-500 mt-4">
              Brak zdefiniowanych produktów dla tego zamówienia. Zgłoś to administratorowi.
            </div>
          ) : (
            task.items.map(item => (
              <ProductItem key={item.productId} item={item} />
            ))
          )}
        </div>
        
      </div>
    </div>
  );
};
