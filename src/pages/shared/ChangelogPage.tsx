import React from 'react';
import { useTranslation } from 'react-i18next';

interface ChangelogEntry {
  id: string;
  type: 'feature' | 'fix' | 'improvement';
  i18nKey: string;
  version?: string;
  image?: string;
}

// Miejsce na definiowanie wpisów z nowościami
const changelogData: ChangelogEntry[] = [
  {
    id: '5',
    i18nKey: 'multi_parcels',
    type: 'feature',
    image: '/images/changelog/multi_parcels.webp'
  },
  {
    id: '4',
    i18nKey: 'bulk_labels',
    type: 'feature',
    image: '/images/changelog/bulk_labels.png'
  },
  {
    id: '3',
    i18nKey: 'gls_de_integration',
    type: 'feature'
  },
  {
    id: '2',
    i18nKey: 'manual_reservation',
    type: 'feature'
  },
  {
    id: '1',
    i18nKey: 'v1_2_0',
    version: 'v1.2.0',
    type: 'feature'
  }
];

export default function ChangelogPage() {
  const { t } = useTranslation();

  const getTypeColor = (type: ChangelogEntry['type']) => {
    switch (type) {
      case 'feature':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'fix':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'improvement':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getTypeLabel = (type: ChangelogEntry['type']) => {
    switch (type) {
      case 'feature':
        return t('changelog.badges.feature', 'Nowa Funkcja');
      case 'fix':
        return t('changelog.badges.fix', 'Poprawka');
      case 'improvement':
        return t('changelog.badges.improvement', 'Ulepszenie');
      default:
        return t('changelog.badges.other', 'Inne');
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
      <div className="mb-10 text-center">
        <h1 className="text-3xl font-extrabold text-[#0F172A] tracking-tight mb-3">{t('changelog.title', 'Nowości i Aktualizacje')}</h1>
        <p className="text-lg text-[#64748B] max-w-2xl mx-auto">
          {t('changelog.subtitle', 'Sprawdź co nowego dodaliśmy w systemie GEPARD. Poniżej znajdziesz historię wprowadzonych funkcji i ulepszeń.')}
        </p>
      </div>

      <div className="relative border-l-2 border-[#E2E8F0] ml-3 md:ml-6 mt-12">
        {changelogData.map((entry, index) => (
          <div key={entry.id} className={`mb-12 relative ${index === changelogData.length - 1 ? 'mb-0' : ''}`}>
            {/* Oś czasu - kropka */}
            <div className="absolute -left-[11px] top-1.5 w-5 h-5 rounded-full bg-white border-4 border-[#4338CA] shadow-sm"></div>
            
            <div className="pl-8 md:pl-10">
              <div className="flex flex-col md:flex-row md:items-center gap-2 mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-[#475569]">{t(`changelog.entries.${entry.i18nKey}.date`, 'Brak daty')}</span>
                  {entry.version && (
                    <span className="px-2.5 py-0.5 rounded-md text-xs font-medium bg-[#F1F5F9] text-[#64748B] border border-[#E2E8F0]">
                      {entry.version}
                    </span>
                  )}
                </div>
                <div className="hidden md:block w-1.5 h-1.5 rounded-full bg-[#CBD5E1]"></div>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getTypeColor(entry.type)} w-max`}>
                  {getTypeLabel(entry.type)}
                </span>
              </div>
              
              <div className="bg-white rounded-2xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.03)] border border-[#E2E8F0] hover:shadow-md transition-shadow">
                <h3 className="text-xl font-bold text-[#0F172A] mb-3">{t(`changelog.entries.${entry.i18nKey}.title`)}</h3>
                <p className="text-[#475569] leading-relaxed whitespace-pre-wrap">
                  {t(`changelog.entries.${entry.i18nKey}.description`)}
                </p>
                {entry.image && (
                  <div className="mt-6 rounded-xl overflow-hidden border border-[#E2E8F0] bg-gray-50">
                    <img src={entry.image} alt={t(`changelog.entries.${entry.i18nKey}.title`)} className="w-full h-auto object-cover max-h-[400px]" />
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
