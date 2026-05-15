import React from 'react';
import { useTranslation } from 'react-i18next';

interface GamificationShipmentProgressProps {
  shipmentsCreated: number;
}

export const GamificationShipmentProgress: React.FC<GamificationShipmentProgressProps> = ({ shipmentsCreated }) => {
  const { t } = useTranslation();
  
  const currentProgress = shipmentsCreated % 1000;
  const percentage = (currentProgress / 1000) * 100;
  
  return (
    <div className="flex flex-col w-[200px] bg-white border border-emerald-100 p-2.5 rounded-xl shadow-sm">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] font-black text-emerald-800 uppercase tracking-widest flex items-center gap-1">
          <span className="material-symbols-outlined text-[12px] text-emerald-600">redeem</span>
          {t('gamification.bonus', 'Bonus')} +10 &euro;
        </span>
        <span className="text-[10px] font-bold text-gray-500">
          {currentProgress} / 1000
        </span>
      </div>
      <div className="w-full bg-emerald-50 rounded-full h-2 relative overflow-hidden">
        <div 
          className="bg-gradient-to-r from-emerald-400 to-emerald-600 h-2 rounded-full shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)] transition-all duration-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="text-[9px] text-emerald-600/80 font-medium leading-tight mt-1 text-center truncate">
         {t('gamification.shipmentProgress', 'Zgarnij rabat za nadawanie paczek!')}
      </div>
    </div>
  );
};
