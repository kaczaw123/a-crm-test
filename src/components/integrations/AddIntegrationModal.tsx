import React from 'react';
import { useTranslation } from 'react-i18next';
import { X, Truck, Table, Link, ShoppingCart, Package, ShoppingBag, ChevronRight } from 'lucide-react';

interface IntegrationType {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  available: boolean;
  comingSoon?: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectIntegration: (type: string) => void;
}

export const AddIntegrationModal: React.FC<Props> = ({ isOpen, onClose, onSelectIntegration }) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const integrationTypes: IntegrationType[] = [
    {
      id: 'dhl_de',
      name: t('integrations.types.dhl_de', 'DHL DE'),
      description: t('integrations.types.dhl_de_desc', 'Broker kurierski DHL dla Niemiec'),
      icon: <Truck className="w-6 h-6 text-red-500" />,
      available: true,
    },
    {
      id: 'gls_de',
      name: t('integrations.types.gls_de', 'GLS DE'),
      description: t('integrations.types.gls_de_desc', 'Broker kurierski GLS dla Niemiec'),
      icon: <Truck className="w-6 h-6 text-blue-800" />,
      available: true,
    },
    {
      id: 'google_sheets',
      name: t('integrations.types.google_sheets', 'Google Sheets'),
      description: t('integrations.types.google_sheets_desc', 'Import zamówień z arkuszy Google'),
      icon: <Table className="w-6 h-6 text-green-500" />,
      available: true,
    },
    {
      id: 'fulfillment_gepard',
      name: 'Fulfillment GEPARD (BaseLinker)',
      description: 'Dwukierunkowa integracja dla klientów 3PL (Automatyzacja pakowania WMS)',
      icon: <Package className="w-6 h-6 text-orange-600" />,
      available: true,
    },
    {
      id: 'baselinker',
      name: t('integrations.types.baselinker', 'BaseLinker'),
      description: t('integrations.types.baselinker_desc', 'Synchronizacja z platformą BaseLinker (Jednokierunkowa)'),
      icon: <Link className="w-6 h-6 text-blue-500" />,
      available: true,
    },
    {
      id: 'allegro',
      name: t('integrations.types.allegro', 'Allegro'),
      description: t('integrations.types.allegro_desc', 'Marketplace Allegro - zamówienia i produkty'),
      icon: <ShoppingCart className="w-6 h-6 text-orange-500" />,
      available: true,
    },
    {
      id: 'apilo',
      name: 'Apilo (Shoper)',
      description: 'Zarządzanie zamówieniami i synchronizacja z Apilo / Shoper',
      icon: <ShoppingCart className="w-6 h-6 text-purple-600" />,
      available: true,
    },
    {
      id: 'inpost',
      name: t('integrations.types.inpost', 'InPost'),
      description: t('integrations.types.inpost_desc', 'Broker kurierski InPost'),
      icon: <Package className="w-6 h-6 text-yellow-500" />,
      available: false,
      comingSoon: true,
    },
    {
      id: 'dpd',
      name: t('integrations.types.dpd', 'DPD'),
      description: t('integrations.types.dpd_desc', 'Broker kurierski DPD'),
      icon: <Truck className="w-6 h-6 text-red-700" />,
      available: false,
      comingSoon: true,
    },
    {
      id: 'amazon',
      name: t('integrations.types.amazon', 'Amazon'),
      description: t('integrations.types.amazon_desc', 'Marketplace Amazon'),
      icon: <ShoppingBag className="w-6 h-6 text-orange-400" />,
      available: false,
      comingSoon: true,
    },
    {
      id: 'shoper',
      name: 'Shoper',
      description: 'Zarządzanie zamówieniami i synchronizacja z Shoper REST API',
      icon: <ShoppingCart className="w-5 h-5 text-black" />,
      available: true
    }
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-xl font-semibold">{t('integrations.selectIntegration', 'Wybierz integrację')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Lista integracji */}
        <div className="p-4 overflow-y-auto">
          <div className="space-y-2">
            {integrationTypes.map((type) => (
              <button
                key={type.id}
                onClick={() => type.available && onSelectIntegration(type.id)}
                disabled={!type.available}
                className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-colors text-left
                  ${type.available 
                    ? 'border-gray-200 hover:border-blue-300 hover:bg-blue-50 cursor-pointer' 
                    : 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-60'
                  }`}
              >
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                  {type.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{type.name}</span>
                    {type.comingSoon && (
                      <span className="px-2 py-0.5 text-xs bg-gray-200 text-gray-600 rounded-full">
                        {t('integrations.comingSoon', 'Wkrótce')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500">{type.description}</p>
                </div>
                {type.available && (
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
