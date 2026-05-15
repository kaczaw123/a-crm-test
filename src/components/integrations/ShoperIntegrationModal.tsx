import React, { useState } from 'react';
import { X, ShoppingCart, Loader2 } from 'lucide-react';
import { saveShoperIntegrationCallable } from '../../data/integrations';
import { useAuth } from '../../auth/useAuth';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const ShoperIntegrationModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { profile } = useAuth();
  
  const [customName, setCustomName] = useState('Sklep Shoper');
  const [apiUrl, setApiUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!apiUrl.trim() || !username.trim() || !password.trim()) {
      setErrorMsg('Wypełnij Adres sklepu, Login WebAPI oraz Hasło WebAPI.');
      return;
    }
    
    if (!profile?.activeCompanyId) return;

    setIsSaving(true);
    setErrorMsg('');
    try {
      await saveShoperIntegrationCallable({
        companyId: profile.activeCompanyId,
        customName,
        apiUrl: apiUrl.trim(),
        username: username.trim(),
        password: password.trim(),
        isDefault
      });
      onClose();
    } catch(err: any) {
      setErrorMsg(err.message || 'Wystąpił błąd podczas dodawania integracji Shoper.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full flex flex-col border border-gray-100/50">
        <div className="flex items-center gap-3 p-5 border-b border-gray-100 bg-gray-50/50 rounded-t-xl">
          <div className="w-10 h-10 rounded-lg bg-black/5 flex items-center justify-center">
            <ShoppingCart className="w-6 h-6 text-black" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 flex-1">Połącz z Shoper</h2>
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
                className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm focus:border-black focus:ring-4 focus:ring-black/5 outline-none transition-all shadow-sm"
                placeholder="np. Mój Sklep Shoper"
              />
            </div>

            <div className="pt-2">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Dane logowania WebAPI</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Adres sklepu (URL)</label>
                  <input
                    type="text"
                    value={apiUrl}
                    onChange={e => setApiUrl(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-black focus:ring-4 focus:ring-black/5 outline-none transition-all font-mono"
                    placeholder="np. https://mojsklep.pl"
                  />
                </div>
                
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-bold text-gray-700 mb-1">Login WebAPI</label>
                    <input
                      type="text"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-black focus:ring-4 focus:ring-black/5 outline-none transition-all font-mono"
                      placeholder="Login"
                    />
                  </div>
                  
                  <div className="flex-[2]">
                    <label className="block text-sm font-bold text-gray-700 mb-1">Hasło WebAPI</label>
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-black focus:ring-4 focus:ring-black/5 outline-none transition-all font-mono"
                      placeholder="Wprowadź hasło"
                    />
                  </div>
                </div>
              </div>
              
              <div className="mt-5 bg-blue-50/50 border border-blue-100 rounded-xl p-4">
                <h4 className="text-xs font-bold text-blue-800 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">info</span>
                  Jak uzyskać dane WebAPI?
                </h4>
                <ol className="text-[13px] text-blue-900/80 space-y-2.5 list-decimal list-inside marker:text-blue-500 marker:font-bold ml-1">
                  <li>Zaloguj się do panelu sklepu <strong className="text-blue-900 font-semibold">Shoper</strong>.</li>
                  <li>Przejdź do: <strong className="text-blue-900 font-semibold">Ustawienia &gt; Ogólne &gt; Administratorzy sklepu</strong>.</li>
                  <li>Kliknij <strong className="text-blue-900 font-semibold">Dodaj administratora</strong> (np. nazwij go "A-CMR").</li>
                  <li>W ustawieniach nowo dodanego administratora wejdź w <strong className="text-blue-900 font-semibold">Uprawnienia</strong>.</li>
                  <li>Zaznacz opcję <strong className="text-blue-900 font-semibold">Dostęp do WebAPI</strong> i upewnij się, że konto jest Aktywne.</li>
                  <li>Zapisz zmiany i wprowadź użyty login oraz hasło powyżej.</li>
                </ol>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
              <button 
                type="button" 
                onClick={() => setIsDefault(!isDefault)}
                className={`w-6 h-6 rounded-md border flex items-center justify-center transition-colors ${isDefault ? 'bg-black border-black' : 'bg-white border-gray-300'}`}
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
            disabled={isSaving || !apiUrl.trim() || !username.trim() || !password.trim()}
            className="px-6 py-2.5 bg-black hover:bg-gray-900 text-white text-sm font-bold rounded-lg shadow-sm shadow-black/10 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
            Zapisz połączenie
          </button>
        </div>
      </div>
    </div>
  );
};
