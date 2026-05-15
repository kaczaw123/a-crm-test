import React from 'react';
import type { FulfillmentTaskItem } from '../../types/fulfillment';

interface ProductItemProps {
  item: FulfillmentTaskItem;
}

export const ProductItem: React.FC<ProductItemProps> = ({ item }) => {
  const isComplete = item.scannedQuantity >= item.quantity;
  const progressPercent = Math.min(100, Math.round((item.scannedQuantity / item.quantity) * 100));

  return (
    <div className={`flex relative items-stretch bg-[#1E222A] rounded-xl border overflow-hidden transition-all duration-300
      ${isComplete ? 'border-green-500/50 bg-[#162A1F]' : 'border-[#374151] hover:border-[#4B5563]'}
    `}>
      {/* Background Progress Bar (Optional, can just be border) */}
      <div 
        className={`absolute left-0 top-0 bottom-0 pointer-events-none transition-all duration-300 ${isComplete ? 'bg-green-900/20' : 'bg-blue-900/10'}`} 
        style={{ width: `${progressPercent}%` }}
      />

      {/* Thumbnail */}
      <div className="w-[120px] shrink-0 bg-white flex items-center justify-center border-r border-[#374151] p-2 relative z-10">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt={item.productName} className="object-contain w-full h-full max-h-[100px]" />
        ) : (
          <span className="material-symbols-outlined text-gray-300 text-5xl">photo_camera</span>
        )}
      </div>

      {/* Details */}
      <div className="flex-1 p-4 flex flex-col justify-center relative z-10">
        <h3 className={`text-[16px] font-bold ${isComplete ? 'text-green-50' : 'text-gray-100'} mb-1 leading-snug`}>
          {item.quantity} x {item.productName}
        </h3>
        
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-gray-400">
          <p>
            <span className="text-[#38BDF8]">EAN: </span>
            <span className="text-gray-300 tracking-wide">{item.ean || 'Brak'}</span>
          </p>
          <p>
            <span className="text-[#38BDF8]">SKU: </span>
            <span className="text-gray-300">{item.sku || 'Brak'}</span>
          </p>
          {item.location && (
            <p>
              <span className="text-amber-500">Loc: </span>
              <span className="text-amber-100 font-medium">{item.location}</span>
            </p>
          )}
        </div>
      </div>

      {/* Scan Progress Counter */}
      <div className="w-[100px] shrink-0 flex items-center justify-center border-l border-[#374151] relative z-10 bg-[#14171C]">
        <div className={`px-4 py-2 rounded-lg font-bold text-lg text-center flex items-center gap-1
          ${isComplete ? 'text-green-400' : 'text-white bg-[#2A2E37]'}
        `}>
          {isComplete && <span className="material-symbols-outlined text-[20px]">check_circle</span>}
          <span>{item.scannedQuantity} z {item.quantity}</span>
        </div>
      </div>
    </div>
  );
};
