import React from 'react';
import { useTranslation } from 'react-i18next';

interface UserLevelBadgeProps {
  experiencePoints?: number;
  className?: string;
}

export const UserLevelBadge: React.FC<UserLevelBadgeProps> = ({ experiencePoints = 0, className = '' }) => {
  const { t } = useTranslation();

  const level = Math.floor(experiencePoints / 100) + 1;
  const currentLevelXp = experiencePoints % 100;
  const progressPercentage = currentLevelXp; // poniewaz max to 100
  
  return (
    <div className={`flex flex-col gap-1.5 p-3 rounded-xl bg-gradient-to-br from-indigo-50 to-blue-50 border border-blue-100/50 shadow-sm ${className}`}>
      <div className="flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
           <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white shadow-sm shadow-blue-200">
             <span className="material-symbols-outlined text-[14px]">stars</span>
           </div>
           <span className="text-xs font-bold text-slate-700 tracking-wide uppercase">
             {t('gamification.level', 'Poziom')} {level}
           </span>
        </div>
        <span className="text-[10px] font-bold text-blue-600 bg-white px-1.5 py-0.5 rounded-md border border-blue-100 shadow-sm">
          {experiencePoints} XP
        </span>
      </div>
      
      <div className="relative w-full h-1.5 bg-blue-100 rounded-full overflow-hidden mt-1">
        <div 
           className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full transition-all duration-1000 ease-out"
           style={{ width: `${progressPercentage}%` }}
        />
      </div>
      <div className="text-[9px] text-slate-500 font-medium text-right mt-0.5">
         {currentLevelXp} / 100 XP {t('gamification.toNextLevel', 'do kolejnego')}
      </div>
    </div>
  );
};
