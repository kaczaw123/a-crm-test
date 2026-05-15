import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enTranslation from './locales/en/translation.json';
import plTranslation from './locales/pl/translation.json';
import deTranslation from './locales/de/translation.json';
import csTranslation from './locales/cs/translation.json';
import itTranslation from './locales/it/translation.json';
import esTranslation from './locales/es/translation.json';
import frTranslation from './locales/fr/translation.json';

const resources = {
  en: { translation: enTranslation },
  pl: { translation: plTranslation },
  de: { translation: deTranslation },
  cs: { translation: csTranslation },
  it: { translation: itTranslation },
  es: { translation: esTranslation },
  fr: { translation: frTranslation },
};

const getInitialLanguage = (): string => {
  if (typeof window === 'undefined') return 'pl';
  
  // 1. Check user's manual selection from localStorage
  const savedLang = localStorage.getItem('appLanguage');
  if (savedLang) return savedLang;
  
  // 2. Detect by domain extension
  const hostname = window.location.hostname.toLowerCase();
  if (hostname.endsWith('.de')) return 'de';
  if (hostname.endsWith('.cz')) return 'cs';
  if (hostname.endsWith('.it')) return 'it';
  if (hostname.endsWith('.es')) return 'es';
  if (hostname.endsWith('.fr')) return 'fr';
  if (hostname.endsWith('.en') || hostname.endsWith('.co.uk') || hostname.endsWith('.com')) return 'en';
  
  // 3. Default fallback
  return 'pl';
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: getInitialLanguage(), 
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, 
    },
  });

export default i18n;
