import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/useAuth';
import { updateUserProfile } from '../../data/firestore';

export const LANGUAGES = [
  { code: 'pl', label: 'Polski', country: 'pl' },
  { code: 'en', label: 'English', country: 'gb' },
  { code: 'de', label: 'Deutsch', country: 'de' },
  { code: 'cs', label: 'Čeština', country: 'cz' },
  { code: 'it', label: 'Italiano', country: 'it' },
  { code: 'es', label: 'Español', country: 'es' },
  { code: 'fr', label: 'Français', country: 'fr' }
];

interface LanguageSelectorProps {
  variant?: 'topbar' | 'auth';
}

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({ variant = 'topbar' }) => {
  const { i18n } = useTranslation();
  const { profile } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentLangCode = i18n.language || 'pl';
  const currentLang = LANGUAGES.find(l => l.code === currentLangCode) || LANGUAGES[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = async (code: string) => {
    i18n.changeLanguage(code);
    setIsOpen(false);
    
    // Zapis do localStorage, aby pamiętać wybór przed zalogowaniem
    localStorage.setItem('appLanguage', code);
    
    // Zapis do Firebase, jeżeli użytkownik jest zalogowany
    if (profile?.uid) {
      try {
        await updateUserProfile(profile.uid, { preferredLanguage: code });
      } catch (err) {
        console.error('Failed to save preferredLanguage', err);
      }
    }
  };

  const getFlagUrl = (country: string) => `https://flagcdn.com/w20/${country}.png`;
  const getFlagUrl2x = (country: string) => `https://flagcdn.com/w40/${country}.png 2x`;

  return (
    <div className="relative inline-block text-left z-50 cursor-pointer" ref={dropdownRef}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`flex justify-center items-center gap-1.5 font-medium hover:opacity-80 transition-opacity ${variant === 'auth' ? 'text-[#4338CA]' : 'text-[#64748B]'}`}
      >
        <span className="material-symbols-outlined text-[18px]">translate</span>
        <span className="text-[13px]">{currentLang.label}</span>
        <span className="material-symbols-outlined text-[16px]">{isOpen ? 'expand_less' : 'expand_more'}</span>
      </div>

      {isOpen && (
        <div className="absolute right-0 mt-3 w-[340px] bg-white rounded-xl shadow-lg border border-gray-100 py-3 px-3 animate-in fade-in slide-in-from-top-2 origin-top-right">
          <div className="grid grid-cols-2 gap-1">
            {LANGUAGES.map((lang) => (
              <button
                type="button"
                key={lang.code}
                onClick={() => handleSelect(lang.code)}
                className={`flex items-center gap-3 w-full text-left px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                  currentLang.code === lang.code ? 'bg-[#EEF2FF] text-[#4338CA]' : 'text-[#334155] hover:bg-[#F8FAFC]'
                }`}
              >
                <img 
                   src={getFlagUrl(lang.country)} 
                   srcSet={getFlagUrl2x(lang.country)} 
                   width="20" 
                   alt={lang.label} 
                   className="rounded-[2px] shadow-sm flex-shrink-0"
                />
                {lang.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
