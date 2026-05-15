import React from 'react';
import { Truck, Table, Link, Plug, ShoppingCart, Wifi, Download, Package, Unplug, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { safeFormatDate } from '../../utils/dateHelpers';

const IconBtn: React.FC<{
  onClick?: () => void;
  disabled?: boolean;
  label: string;
  icon: React.ReactNode;
  colorClass: string;
}> = ({ onClick, disabled, label, icon, colorClass }) => (
  <div className="relative group">
    <button
      onClick={onClick}
      disabled={disabled}
      className={`p-2 rounded-lg transition-colors disabled:opacity-40 ${colorClass}`}
      aria-label={label}
    >
      {icon}
    </button>
    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-[11px] font-medium bg-gray-800 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-lg">
      {label}
    </span>
  </div>
);

interface Props {
  integration: any;
  onDisconnect: () => void;
  onTest?: () => void;
  onSync?: () => void;
  onSyncProducts?: () => void;
  onUpdateSettings?: (autoSync: boolean, syncInterval: number) => void;
  testState?: { loading?: boolean; error?: string; success?: string };
}

export const IntegrationCard: React.FC<Props> = ({ integration, onDisconnect, onTest, onSync, onSyncProducts, onUpdateSettings, testState }) => {
  const { t } = useTranslation();

  const getIcon = () => {
    switch (integration.type) {
      case 'dhl_de': return <Truck className="w-6 h-6 text-red-500" />;
      case 'gls_de': return <Truck className="w-6 h-6 text-blue-800" />;
      case 'google_sheets': return <Table className="w-6 h-6 text-green-500" />;
      case 'baselinker': return <Link className="w-6 h-6 text-blue-500" />;
      case 'fulfillment_gepard': return <Package className="w-6 h-6 text-orange-500" />;
      case 'allegro': return <span className="text-xl font-bold text-orange-500">A</span>;
      case 'apilo': return <ShoppingCart className="w-6 h-6 text-purple-600" />;
      case 'shoper': return <ShoppingCart className="w-6 h-6 text-black" />;
      default: return <Plug className="w-6 h-6 text-gray-500" />;
    }
  };

  const getTypeName = () => {
    switch (integration.type) {
      case 'dhl_de': return 'DHL DE';
      case 'gls_de': return 'GLS DE';
      case 'google_sheets': return 'Google Sheets';
      case 'baselinker': return 'BaseLinker';
      case 'fulfillment_gepard': return 'Fulfillment GEPARD';
      case 'allegro': return 'Allegro';
      case 'apilo': return 'Apilo';
      case 'shoper': return 'Shoper';
      default: return integration.type || t('integrations.labels.unknown');
    }
  };

  return (
    <div className="bg-white rounded-[24px] shadow-sm p-6 border border-gray-100 flex flex-col h-full ring-1 ring-black/5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gray-50 rounded-lg flex items-center justify-center shrink-0">
            {getIcon()}
          </div>
          <div>
            <h3 className="font-semibold text-lg text-gray-900 leading-tight">{integration.customName || getTypeName()}</h3>
            <p className="text-sm text-gray-500 uppercase tracking-wide mt-1 font-medium">{getTypeName()}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
           <div className="relative group">
             <span className="inline-flex items-center p-1.5 bg-green-100 text-green-600 rounded-full cursor-default select-none">
               <CheckCircle2 className="w-4 h-4" />
             </span>
             <span className="pointer-events-none absolute top-full right-0 mt-1.5 px-2.5 py-1.5 text-[11px] font-medium bg-gray-800 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 shadow-lg">
               Integracja aktywna i połączona
             </span>
           </div>
           {(integration.type === 'dhl_de' || integration.type === 'gls_de') && integration.sandboxMode && (
              <span className="px-2 py-0.5 text-[10px] font-bold bg-yellow-100 text-yellow-800 rounded uppercase tracking-wider">Sandbox</span>
           )}
        </div>
      </div>

      <div className="space-y-4 mb-6 flex-1 flex flex-col justify-end">
         {onUpdateSettings && !['dhl_de', 'gls_de'].includes(integration.type) && (
            <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 flex flex-col gap-2">
               <label className="flex items-center gap-2 cursor-pointer">
                  <input 
                     type="checkbox" 
                     className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                     checked={integration.autoSync ?? false}
                     onChange={(e) => onUpdateSettings(e.target.checked, integration.syncInterval || 5)}
                  />
                  <span className="text-sm text-gray-700 font-medium">Autopobieranie zamówień</span>
               </label>
               {integration.autoSync && (
                  <div className="flex items-center gap-2 pl-6">
                     <span className="text-xs text-gray-500">Częstotliwość:</span>
                     <select 
                        className="text-xs border-gray-200 rounded-md py-1 px-2 pr-8 focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
                        value={integration.syncInterval || 5}
                        onChange={(e) => onUpdateSettings(integration.autoSync || false, parseInt(e.target.value))}
                     >
                        <option value={1}>1 min</option>
                        <option value={5}>5 min</option>
                        <option value={30}>30 min</option>
                        <option value={60}>1 h</option>
                        <option value={360}>6 h</option>
                        <option value={720}>12 h</option>
                     </select>
                  </div>
               )}
            </div>
         )}
         <p className="text-sm text-gray-600">
            {t('integrations.labels.lastTest')} {integration.lastTestAt ? safeFormatDate(integration.lastTestAt, 'pl-PL') : t('integrations.labels.noTest')}
         </p>
         
         {(testState?.loading || testState?.success || testState?.error) && (
            <div className="flex flex-col gap-1 min-h-[20px]">
               {testState?.loading && <span className="text-xs text-blue-500 animate-pulse">{t('integrations.labels.checkingApi')}</span>}
               {testState?.success && <span className="text-xs text-green-600 font-medium flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">check_circle</span> {testState.success}</span>}
               {testState?.error && <span className="text-xs text-red-600 font-medium flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">error</span> {testState.error}</span>}
            </div>
         )}
      </div>

      <div className="flex justify-between items-center pt-4 border-t border-gray-100">
        <div className="flex gap-1">
          {onTest && (
            <IconBtn
              onClick={onTest}
              disabled={testState?.loading}
              label={t('integrations.labels.testConnection', 'Testuj połączenie')}
              icon={<Wifi className="w-4 h-4" />}
              colorClass="text-blue-600 hover:bg-blue-50 hover:text-blue-800"
            />
          )}
          {onSync && integration.status === 'active' && (
            <IconBtn
              onClick={onSync}
              disabled={testState?.loading}
              label="Pobierz dane"
              icon={<Download className="w-4 h-4" />}
              colorClass="text-purple-600 hover:bg-purple-50 hover:text-purple-800"
            />
          )}
          {onSyncProducts && integration.status === 'active' && (
            <IconBtn
              onClick={onSyncProducts}
              disabled={testState?.loading}
              label="Pobierz produkty"
              icon={<Package className="w-4 h-4" />}
              colorClass="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-800"
            />
          )}
        </div>
        <IconBtn
          onClick={onDisconnect}
          label="Rozłącz"
          icon={<Unplug className="w-4 h-4" />}
          colorClass="text-red-500 hover:bg-red-50 hover:text-red-700"
        />
      </div>
    
    {(integration as any).debugOutput && ((integration as any).debugOutput as string[]).length > 0 && (
      <div className="bg-gray-100 text-xs font-mono p-2 mt-2 rounded overflow-y-auto max-h-32">
        <div className="font-bold mb-1">Debug Output:</div>
        {((integration as any).debugOutput as string[]).map((d, i) => <div key={i}>{d}</div>)}
      </div>
    )}
  </div>
  );
};
