import React from 'react';
import { useTranslation } from 'react-i18next';

interface DiscountWalletBadgeProps {
  balance?: number;
  className?: string;
}

export const DiscountWalletBadge: React.FC<DiscountWalletBadgeProps> = ({ balance = 0, className = '' }) => {
  const { t } = useTranslation();

  return (
    <div className={`flex flex-col gap-1.5 p-3 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 shadow-sm ${className}`}>
      <div className="flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
           <div className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-600 text-white shadow-sm shadow-emerald-200">
             <span className="material-symbols-outlined text-[16px]">account_balance_wallet</span>
           </div>
           <div className="flex flex-col">
             <span className="text-[10px] font-bold text-emerald-700 tracking-wide uppercase">
               {t('gamification.walletLabel', 'Zgromadzony Rabat')}
             </span>
             <span className="text-[15px] font-black text-slate-800 leading-none mt-0.5">
               &euro; {balance.toFixed(2)}
             </span>
           </div>
        </div>
      </div>
      <div className="text-[9px] text-emerald-600/80 font-medium leading-tight">
        {t('gamification.walletDesc', 'Środki zostaną wykorzystane do pomniejszenia kolejnej faktury abonamentowej.')}
      </div>
    </div>
  );
};
