import React, { useEffect, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { db, functions } from '../../firebase/config';
import { collection, onSnapshot, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Plus } from 'lucide-react';

export default function AdminIntegrations() {
  const { profile } = useAuth();
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showDhlConfig, setShowDhlConfig] = useState(false);
  const [dhlName, setDhlName] = useState('');
  const [dhlLogin, setDhlLogin] = useState('');
  const [dhlPassword, setDhlPassword] = useState('');
  const [dhlEkp, setDhlEkp] = useState('');
  const [dhlEkpExport, setDhlEkpExport] = useState('');
  const [dhlSandbox, setDhlSandbox] = useState(false);

  const [showGlsConfig, setShowGlsConfig] = useState(false);
  const [glsName, setGlsName] = useState('');
  const [glsAppId, setGlsAppId] = useState('');
  const [glsLogin, setGlsLogin] = useState('');
  const [glsPassword, setGlsPassword] = useState('');
  const [glsContactId, setGlsContactId] = useState('');
  const [glsSandbox, setGlsSandbox] = useState(false);

  // Statusy
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchIntegrations = async () => {
    if (profile?.globalRole !== 'superadmin') return;
    setLoading(true);
    try {
      const listGlobal = httpsCallable(functions, 'listGlobalIntegrations');
      const res = await listGlobal();
      setIntegrations(res.data as any[]);
    } catch(err) {
      console.error('Błąd pobierania globalnych integracji:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIntegrations();
  }, [profile?.globalRole]);

  const handleSaveDhl = async () => {
    if (!dhlLogin || !dhlPassword || !dhlEkp) {
        setSaveError('Wypełnij wszystkie wymagane pola GKP i EKP.');
        return;
    }
    setIsSaving(true);
    setSaveError('');

    try {
        const saveGlobalDhlIntegration = httpsCallable(functions, 'saveGlobalDhlIntegration');
        await saveGlobalDhlIntegration({
            customName: dhlName,
            login: dhlLogin,
            password: dhlPassword,
            accountNumber: dhlEkp,
            accountNumberExport: dhlEkpExport,
            sandboxMode: dhlSandbox
        });
        setShowDhlConfig(false);
        setDhlName('');
        setDhlLogin('');
        setDhlPassword('');
        setDhlEkp('');
        setDhlEkpExport('');
        setDhlSandbox(false);
        fetchIntegrations();
    } catch(err: any) {
        setSaveError(err.message || 'Błąd zapisu integracji.');
    } finally {
        setIsSaving(false);
    }
  };

  const handleSaveGls = async () => {
    if (!glsLogin || !glsPassword || !glsContactId) {
        setSaveError('Wypełnij wszystkie wymagane pola GLS.');
        return;
    }
    setIsSaving(true);
    setSaveError('');

    try {
        const saveGlobalGlsIntegration = httpsCallable(functions, 'saveGlobalGlsIntegration');
        await saveGlobalGlsIntegration({
            customName: glsName,
            appId: glsAppId.trim(),
            login: glsLogin,
            password: glsPassword,
            contactId: glsContactId.trim(),
            sandboxMode: glsSandbox
        });
        setShowGlsConfig(false);
        setGlsName('');
        setGlsAppId('');
        setGlsLogin('');
        setGlsPassword('');
        setGlsContactId('');
        setGlsSandbox(false);
        fetchIntegrations();
    } catch(err: any) {
        setSaveError(err.message || 'Błąd zapisu integracji.');
    } finally {
        setIsSaving(false);
    }
  };

  const handleDelete = async (id: string, type: string) => {
    if (!confirm('Wyłączyć tę integrację? Klienci stracą dostęp do brokera.')) return;
    setIsDeleting(true);
    try {
        const deleteFn = type === 'gls_de' ? 'deleteGlobalGlsIntegration' : 'deleteGlobalDhlIntegration';
        const deleteGlobal = httpsCallable(functions, deleteFn);
        await deleteGlobal({ integrationId: id });
        fetchIntegrations();
    } catch (e: any) {
        alert('Błąd usuwania: ' + e.message);
    } finally {
        setIsDeleting(false);
    }
  };

  const handleEnable = async (id: string, type: string) => {
    if (!confirm('Włączyć z powrotem tę integrację? Klienci znów będą mogli z niej korzystać.')) return;
    setIsDeleting(true);
    try {
        const enableFn = type === 'gls_de' ? 'enableGlobalGlsIntegration' : 'enableGlobalDhlIntegration';
        const enableGlobal = httpsCallable(functions, enableFn);
        await enableGlobal({ integrationId: id });
        fetchIntegrations();
    } catch (e: any) {
        alert('Błąd aktywacji: ' + e.message);
    } finally {
        setIsDeleting(false);
    }
  };

  const handleTest = async (id: string, type: string) => {
    try {
        const testFn = type === 'gls_de' ? 'testGlobalGlsIntegration' : 'testGlobalDhlIntegration';
        const testGlobal = httpsCallable(functions, testFn);
        const res: any = await testGlobal({ integrationId: id });
        if (res.data.success) {
            alert('Połączenie OK: ' + res.data.message);
        } else {
            alert('Błąd połączenia: ' + res.data.message);
        }
    } catch (e: any) {
        alert('Błąd wywołania testu: ' + e.message);
    }
  };

  if (profile?.globalRole !== 'superadmin') {
     return <div className="p-8 text-center text-red-500 font-bold">Brak dostępu. Wymagane uprawnienia superadmina.</div>;
  }

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-black italic tracking-wide text-[#1A202C]">GLOBALNE INTEGRACJE</h1>
          <p className="text-[#4A5568] mt-1 text-sm font-medium">Zarządzaj wspólnymi połączeniami dla wszystkich klientów (Brokerzy).</p>
        </div>
        <div className="flex gap-2">
            <button 
              onClick={() => setShowDhlConfig(true)}
              className="flex items-center gap-2 bg-[#1A202C] text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-gray-200 hover:bg-[#2D3748] hover:shadow-xl hover:-translate-y-0.5 transition-all"
            >
              <Plus className="w-5 h-5" />
              Dodaj DHL DE
            </button>
            <button 
              onClick={() => setShowGlsConfig(true)}
              className="flex items-center gap-2 bg-blue-800 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-blue-200 hover:bg-blue-900 hover:shadow-xl hover:-translate-y-0.5 transition-all"
            >
              <Plus className="w-5 h-5" />
              Dodaj GLS DE
            </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
           <span className="material-symbols-outlined animate-spin text-4xl text-gray-400">refresh</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {integrations.map(int => (
            <div key={int.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col hover:border-gray-200 transition-colors relative group">
              <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                   onClick={() => handleTest(int.id, int.type)}
                   className="text-gray-300 hover:text-blue-500"
                   title="Testuj połączenie"
                >
                   <span className="material-symbols-outlined">bolt</span>
                </button>
                {int.status === 'active' ? (
                   <button 
                      onClick={() => handleDelete(int.id, int.type)}
                      disabled={isDeleting}
                      className="text-gray-300 hover:text-red-500 disabled:opacity-50"
                      title="Wyłącz integrację"
                   >
                      <span className="material-symbols-outlined">power_settings_new</span>
                   </button>
                ) : (
                   <button 
                      onClick={() => handleEnable(int.id, int.type)}
                      disabled={isDeleting}
                      className="text-gray-300 hover:text-green-500 disabled:opacity-50"
                      title="Włącz integrację"
                   >
                      <span className="material-symbols-outlined">power_settings_new</span>
                   </button>
                )}
              </div>

              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-yellow-50 rounded-xl flex items-center justify-center text-yellow-500 shrink-0">
                  <span className="material-symbols-outlined text-2xl">local_shipping</span>
                </div>
                <div>
                  <h3 className="font-bold text-[#1A202C] text-lg leading-tight">{int.label}</h3>
                  {int.customName && <p className="text-sm text-gray-500 font-medium">{int.customName}</p>}
                </div>
              </div>
              <div className="mt-auto pt-4 border-t border-gray-50 flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${int.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                </span>
                <span className={`text-xs font-bold uppercase tracking-wide ${int.status === 'active' ? 'text-green-600' : 'text-red-600'}`}>
                  {int.status === 'active' ? 'aktywne' : 'wyłączone'}
                </span>
                {int.sandboxMode && (
                  <span className="ml-auto text-[10px] bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded uppercase font-bold">Sandbox</span>
                )}
              </div>
            </div>
          ))}
          {integrations.length === 0 && (
             <div className="col-span-full py-12 text-center text-gray-500 bg-white rounded-2xl border border-dashed border-gray-200">
                <span className="material-symbols-outlined text-4xl mb-2 opacity-50">extension_off</span>
                <p className="font-medium">Brak skonfigurowanych integracji globalnych.</p>
             </div>
          )}
        </div>
      )}

      {/* DHL Config Modal */}
      {showDhlConfig && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#b10024] p-5 flex items-center justify-between shrink-0">
              <h3 className="text-white font-bold text-lg flex items-center gap-2">
                <span className="material-symbols-outlined">local_shipping</span>
                KONFIGURACJA DHL DE (Global)
              </h3>
              <button onClick={() => setShowDhlConfig(false)} className="text-white/80 hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex flex-col gap-5">
              {saveError && (
                 <div className="bg-red-50 text-red-600 p-3 rounded-lg border border-red-100 text-sm font-medium">
                    {saveError}
                 </div>
              )}

              <div>
                <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wide">Nazwa integracji</label>
                <input type="text" value={dhlName} onChange={e=>setDhlName(e.target.value)} placeholder="np. Globalny Broker DHL" className="w-full bg-gray-50 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#b10024] outline-none transition-shadow"/>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                 <div>
                   <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wide">GKP Login</label>
                   <input type="text" value={dhlLogin} onChange={e=>setDhlLogin(e.target.value)} className="w-full bg-gray-50 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#b10024] outline-none transition-shadow"/>
                 </div>
                 <div>
                   <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wide">GKP Hasło</label>
                   <input type="password" value={dhlPassword} onChange={e=>setDhlPassword(e.target.value)} className="w-full bg-gray-50 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#b10024] outline-none transition-shadow"/>
                 </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wide">Numer Rozliczeniowy EKP</label>
                <input type="text" value={dhlEkp} onChange={e=>setDhlEkp(e.target.value)} placeholder="14 cyfr np. 12345678900101" className="w-full bg-gray-50 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#b10024] outline-none transition-shadow"/>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wide">Numer Rozliczeniowy EKP (Export) / Opcjonalnie</label>
                <input type="text" value={dhlEkpExport} onChange={e=>setDhlEkpExport(e.target.value)} placeholder="14 cyfr np. 12345678900101" className="w-full bg-gray-50 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[#b10024] outline-none transition-shadow"/>
              </div>

              <div className="pt-2">
                 <button 
                    onClick={handleSaveDhl}
                    disabled={isSaving}
                    className="w-full bg-[#b10024] text-white font-bold text-sm py-3 rounded-xl hover:bg-[#90001d] transition-colors shadow-lg shadow-red-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                 >
                    {isSaving ? <span className="material-symbols-outlined animate-spin text-lg">refresh</span> : null}
                    ZAPISZ DHL DE GLOBAL
                 </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GLS Config Modal */}
      {showGlsConfig && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-blue-800 p-5 flex items-center justify-between shrink-0">
              <h3 className="text-white font-bold text-lg flex items-center gap-2">
                <span className="material-symbols-outlined">local_shipping</span>
                KONFIGURACJA GLS DE (Global)
              </h3>
              <button onClick={() => setShowGlsConfig(false)} className="text-white/80 hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex flex-col gap-5">
              {saveError && (
                 <div className="bg-red-50 text-red-600 p-3 rounded-lg border border-red-100 text-sm font-medium">
                    {saveError}
                 </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wide">Nazwa integracji</label>
                    <input type="text" value={glsName} onChange={e=>setGlsName(e.target.value)} placeholder="np. Globalny Broker GLS" className="w-full bg-gray-50 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-800 outline-none transition-shadow"/>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wide">ID aplikacji (App ID)</label>
                    <input type="text" value={glsAppId} onChange={e=>setGlsAppId(e.target.value)} placeholder="np. 0cbda3ef-4f6f-..." className="w-full bg-gray-50 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-800 outline-none transition-shadow"/>
                  </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                 <div>
                   <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wide">Login (Client ID)</label>
                   <input type="text" value={glsLogin} onChange={e=>setGlsLogin(e.target.value)} className="w-full bg-gray-50 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-800 outline-none transition-shadow"/>
                 </div>
                 <div>
                   <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wide">Hasło (Secret)</label>
                   <input type="password" value={glsPassword} onChange={e=>setGlsPassword(e.target.value)} className="w-full bg-gray-50 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-800 outline-none transition-shadow"/>
                 </div>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 mb-1.5 block uppercase tracking-wide">Contact ID</label>
                <input type="text" value={glsContactId} onChange={e=>setGlsContactId(e.target.value)} placeholder="Contact ID" className="w-full bg-gray-50 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-800 outline-none transition-shadow"/>
              </div>

              <div className="flex justify-end gap-4">
                  <label className="flex items-center gap-3 cursor-pointer group">
                     <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${glsSandbox ? 'bg-yellow-500 border-yellow-500' : 'border-gray-300 bg-white group-hover:border-yellow-500'}`}>
                        {glsSandbox && <span className="material-symbols-outlined text-white text-[16px]">check</span>}
                     </div>
                     <input type="checkbox" className="hidden" checked={glsSandbox} onChange={e => setGlsSandbox(e.target.checked)} />
                     <span className="text-[14px] font-medium text-gray-800">Tryb Sandbox</span>
                  </label>
              </div>

              <div className="pt-2">
                 <button 
                    onClick={handleSaveGls}
                    disabled={isSaving}
                    className="w-full bg-blue-800 text-white font-bold text-sm py-3 rounded-xl hover:bg-blue-900 transition-colors shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2"
                 >
                    {isSaving ? <span className="material-symbols-outlined animate-spin text-lg">refresh</span> : null}
                    ZAPISZ GLS DE GLOBAL
                 </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
