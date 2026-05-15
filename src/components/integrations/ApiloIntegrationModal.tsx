import React, { useState } from 'react';
import { X, ShoppingCart, Loader2 } from 'lucide-react';
import { saveApiloIntegrationCallable } from '../../data/integrations';
import { useAuth } from '../../auth/useAuth';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const ApiloIntegrationModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { profile } = useAuth();
  
  const [customName, setCustomName] = useState('Sklep Apilo');
  const [apiUrl, setApiUrl] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!apiUrl.trim() || !clientId.trim() || !clientSecret.trim() || !authCode.trim()) {
      setErrorMsg('Wypełnij Adres API, Client ID, Client Secret oraz Kod autoryzacji.');
      return;
    }
    
    if (!profile?.activeCompanyId) return;

    setIsSaving(true);
    setErrorMsg('');
    try {
      await saveApiloIntegrationCallable({
        companyId: profile.activeCompanyId,
        customName,
        apiUrl: apiUrl.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        authCode: authCode.trim(),
        isDefault
      });
      onClose();
    } catch(err: any) {
      setErrorMsg(err.message || 'Wystąpił błąd podczas dodawania integracji Apilo.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full flex flex-col border border-gray-100/50">
        <div className="flex items-center gap-3 p-5 border-b border-gray-100 bg-gray-50/50 rounded-t-xl">
          <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
            <ShoppingCart className="w-6 h-6 text-purple-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 flex-1">Połącz z Apilo</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:bg-white hover:shadow-sm rounded-lg transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          {errorMsg && (
            <div className="mb-6 bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 font-medium text-sm flex items-start gap-2">
              <span className="material-symbols-outlined text-[20px]">error</span>
              <p>{errorMsg}</p>
            </div>
          )}

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">
                Nazwa integracji <span className="text-gray-400 font-normal">(dla Ciebie)</span>
              </label>
              <input
                type="text"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm focus:border-purple-500 focus:ring-4 focus:ring-purple-500/10 outline-none transition-all shadow-sm"
                placeholder="np. Sklep Główny Apilo"
              />
            </div>

            <div className="pt-2">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Dane logowania REST API</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Adres API (endpoint)</label>
                  <input
                    type="text"
                    value={apiUrl}
                    onChange={e => setApiUrl(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-purple-500 focus:ring-4 focus:ring-purple-500/10 outline-none transition-all font-mono"
                    placeholder="np. https://sklep.apilo.com"
                  />
                </div>
                
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-bold text-gray-700 mb-1">Client ID</label>
                    <input
                      type="text"
                      value={clientId}
                      onChange={e => setClientId(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-purple-500 focus:ring-4 focus:ring-purple-500/10 outline-none transition-all font-mono"
                      placeholder="np. 1"
                    />
                  </div>
                  
                  <div className="flex-[2]">
                    <label className="block text-sm font-bold text-gray-700 mb-1">Client Secret</label>
                    <input
                      type="password"
                      value={clientSecret}
                      onChange={e => setClientSecret(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-purple-500 focus:ring-4 focus:ring-purple-500/10 outline-none transition-all font-mono"
                      placeholder="Wprowadź Client Secret"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Kod autoryzacji</label>
                  <input
                    type="text"
                    value={authCode}
                    onChange={e => setAuthCode(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-purple-500 focus:ring-4 focus:ring-purple-500/10 outline-none transition-all font-mono"
                    placeholder="Wprowadź Kod autoryzacji"
                  />
                </div>
              </div>
              
              <p className="mt-3 text-xs text-gray-500 leading-relaxed">
                Dane te wygenerujesz w panelu Apilo: <span className="font-semibold text-gray-700">Administracja &gt; REST API</span>. Skopiuj Identyfikator klienta (Client ID) oraz Sekret klienta (Client Secret).
              </p>
            </div>

            <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
              <button 
                type="button" 
                onClick={() => setIsDefault(!isDefault)}
                className={`w-6 h-6 rounded-md border flex items-center justify-center transition-colors ${isDefault ? 'bg-purple-600 border-purple-600' : 'bg-white border-gray-300'}`}
              >
                {isDefault && <span className="material-symbols-outlined text-white text-[16px]">check</span>}
              </button>
              <div>
                <p className="text-sm font-bold text-gray-900">Ustaw jako główne źródło zamówień</p>
                <p className="text-xs text-gray-500 mt-0.5">Te konto będzie wybierane domyślnie.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            disabled={isSaving}
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !apiUrl.trim() || !clientId.trim() || !clientSecret.trim() || !authCode.trim()}
            className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold rounded-lg shadow-sm shadow-purple-600/30 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
            Zapisz połączenie
          </button>
        </div>
      </div>
    </div>
  );
};
