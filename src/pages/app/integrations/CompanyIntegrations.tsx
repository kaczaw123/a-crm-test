import React, { useEffect, useState } from 'react';
import { useAuth } from '../../../auth/useAuth';
import { db } from '../../../firebase/config';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { type Integration, saveIntegrationCallable, testIntegrationCallable, deleteIntegrationCallable, saveGoogleSheetsIntegrationCallable, testGoogleSheetsIntegrationCallable, triggerGoogleSheetsSyncCallable, saveDhlIntegrationCallable, testDhlIntegrationCallable, saveGlsIntegrationCallable, testGlsIntegrationCallable, saveApiloIntegrationCallable, testApiloIntegrationCallable, syncApiloOrdersCallable, saveShoperIntegrationCallable, testShoperIntegrationCallable, syncShoperOrdersCallable, syncShoperProductsCallable, manualSyncBaselinkerOrdersCallable, triggerProductSyncCallable } from '../../../data/integrations';
import { getDocs } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import AllegroIntegrationCard from "../../../components/integrations/AllegroIntegrationCard";
import type { AllegroIntegration } from "../../../types/allegro";
import { Plus } from 'lucide-react';
import { ApiloIntegrationModal } from "../../../components/integrations/ApiloIntegrationModal";
import { ShoperIntegrationModal } from "../../../components/integrations/ShoperIntegrationModal";
import { AddIntegrationModal } from "../../../components/integrations/AddIntegrationModal";
import { IntegrationCard } from "../../../components/integrations/IntegrationCard";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../../firebase/config";

export default function CompanyIntegrations() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);

  const allegroIntegrations = integrations.filter(i => i.type === 'allegro') as unknown as AllegroIntegration[];
  const standardIntegrations = integrations.filter(i => i.type !== 'allegro');

  // Modals Flow
  const [showAddModal, setShowAddModal] = useState(false);
  const [showApiloConfig, setShowApiloConfig] = useState(false);
  const [showShoperConfig, setShowShoperConfig] = useState(false);
  const [showBlConfig, setShowBlConfig] = useState(false);
  const [integrationToDelete, setIntegrationToDelete] = useState<Integration | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [newName, setNewName] = useState('');
  const [newToken, setNewToken] = useState('');
  const [blImportStatusId, setBlImportStatusId] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  // Google Sheets Flow
  const [showGsConfig, setShowGsConfig] = useState(false);
  const [gsName, setGsName] = useState('');
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetName, setSheetName] = useState('');

  // DHL Flow
  const [showDhlConfig, setShowDhlConfig] = useState(false);
  const [dhlName, setDhlName] = useState('');
  const [dhlLogin, setDhlLogin] = useState('');
  const [dhlPassword, setDhlPassword] = useState('');
  const [dhlEkp, setDhlEkp] = useState('');
  const [dhlEkpExport, setDhlEkpExport] = useState('');
  const [dhlSandbox, setDhlSandbox] = useState(false);

  // GLS Flow
  const [showGlsConfig, setShowGlsConfig] = useState(false);
  const [glsName, setGlsName] = useState('');
  const [glsAppId, setGlsAppId] = useState('');
  const [glsLogin, setGlsLogin] = useState('');
  const [glsPassword, setGlsPassword] = useState('');
  const [glsContactId, setGlsContactId] = useState('');
  const [glsSandbox, setGlsSandbox] = useState(false);

  // Fulfillment Gepard Flow
  const [showFgConfig, setShowFgConfig] = useState(false);
  const [fgName, setFgName] = useState('');
  const [fgToken, setFgToken] = useState('');
  const [fgImportStatus, setFgImportStatus] = useState('');
  const [fgExportStatus, setFgExportStatus] = useState('');

  // Statusy akcji API
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [testState, setTestState] = useState<Record<string, { loading: boolean, error?: string, success?: string }>>({});

  // Pobranie integracji BaseLinker
  useEffect(() => {
    if (!profile?.activeCompanyId) return;
    
    const q = query(
      collection(db, 'companies', profile.activeCompanyId, 'integrations'),
      orderBy('createdAt', 'desc')
    );
    
    const unsub = onSnapshot(q, (snapshot) => {
      const data: Integration[] = [];
      snapshot.forEach(doc => {
         data.push({ id: doc.id, ...doc.data() } as Integration);
      });
      setIntegrations(data);
      setLoading(false);
    }, (error) => {
      console.error('Błąd pobierania integracji:', error);
      setLoading(false); // Usuwa infinite loading przy braku uprawnień/indeksów
    });
    
    return () => unsub();
  }, [profile?.activeCompanyId]);

  const handleSelectIntegration = async (type: string) => {
    setShowAddModal(false);
    
    switch (type) {
      case 'apilo':
        setShowApiloConfig(true);
        break;
      case 'shoper':
        setShowShoperConfig(true);
        break;
      case 'dhl_de':
        setShowDhlConfig(true);
        break;
      case 'gls_de':
        setShowGlsConfig(true);
        break;
      case 'google_sheets':
        setShowGsConfig(true);
        break;
      case 'baselinker':
        setShowBlConfig(true);
        break;
      case 'fulfillment_gepard':
        setShowFgConfig(true);
        break;
      case 'allegro':
        if (!profile?.activeCompanyId) return;
        try {
          const getAllegroAuthUrl = httpsCallable(functions, "getAllegroAuthUrl");
          const result = await getAllegroAuthUrl({
            companyId: profile.activeCompanyId,
            redirectUri: `${window.location.origin}/app/integrations/allegro/callback`,
            sandbox: false,
          });
          const data = result.data as { authUrl: string };
          window.location.href = data.authUrl;
        } catch (error) {
          console.error("Get auth URL error:", error);
          alert(t('integrations.allegro.authUrlFailed', 'Nie udało się uzyskać linku autoryzacji'));
        }
        break;
      default:
        break;
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!profile?.activeCompanyId || !newName.trim() || !newToken.trim()) return;
    
    setIsSaving(true);
    setSaveError('');
    try {
      const integrationId = `bl-${Date.now().toString(36)}`;
      await saveIntegrationCallable({
        companyId: profile.activeCompanyId,
        integrationId,
        customName: newName,
        token: newToken,
        importStatusId: blImportStatusId || null,
        isDefault
      });
      
      closeAllModals();
    } catch(err: any) {
      setSaveError(err.message || t('integrations.messages.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveGs = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!profile?.activeCompanyId || !gsName.trim() || !spreadsheetId.trim() || !sheetName.trim()) return;
    
    setIsSaving(true);
    setSaveError('');
    try {
      const integrationId = `gs-${Date.now().toString(36)}`;
      const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
      const docRef = doc(db, 'companies', profile.activeCompanyId, 'integrations', integrationId);
      
      await setDoc(docRef, {
        orgId: profile.activeCompanyId,
        type: 'google_sheets',
        customName: gsName,
        spreadsheetId: spreadsheetId.trim(),
        sheetName: sheetName.trim(),
        status: 'active',
        isDefault: true,
        syncStatus: 'idle',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: profile?.uid || ''
      }, { merge: true });
      
      closeAllModals();
    } catch(err: any) {
      setSaveError(err.message || t('integrations.messages.gsSaveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveFulfillmentGepard = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!profile?.activeCompanyId || !fgName.trim() || !fgToken.trim() || !fgImportStatus.trim() || !fgExportStatus.trim()) return;
    
    setIsSaving(true);
    setSaveError('');
    try {
      const integrationId = `fg-${Date.now().toString(36)}`;
      await saveIntegrationCallable({
        companyId: profile.activeCompanyId,
        integrationId,
        customName: fgName,
        token: fgToken,
        integrationType: 'fulfillment_gepard',
        importStatusId: fgImportStatus.trim(),
        exportStatusId: fgExportStatus.trim(),
        isDefault
      });
      
      closeAllModals();
    } catch(err: any) {
      setSaveError(err.message || t('integrations.messages.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestInModal = async () => {
    if (!profile?.activeCompanyId || !newName.trim() || !newToken.trim()) {
      setTestState(prev => ({ ...prev, modal: { loading: false, error: t('integrations.messages.fillToken') } }));
      return;
    }
    
    setTestState(prev => ({ ...prev, modal: { loading: true, error: '', success: '' } }));
    
    try {
      const result: any = await testIntegrationCallable({
        companyId: profile.activeCompanyId,
        token: newToken.trim()
      });
      
      if (result.data.success) {
        setTestState(prev => ({ ...prev, modal: { loading: false, success: t('integrations.messages.blConnectSuccess', 'Połączono pomyślnie z BaseLinkerem') } }));
      } else {
        setTestState(prev => ({ ...prev, modal: { loading: false, error: result.data.error || t('integrations.messages.blConnectError', 'Błąd połączenia') } }));
      }
    } catch(err: any) {
      setTestState(prev => ({ ...prev, modal: { loading: false, error: err.message } }));
    }
  };

  const handleSaveDhl = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!profile?.activeCompanyId || !dhlName.trim() || !dhlLogin.trim() || !dhlPassword || !dhlEkp.trim()) return;
    
    setIsSaving(true);
    setSaveError('');
    try {
      await saveDhlIntegrationCallable({
        companyId: profile.activeCompanyId,
        customName: dhlName,
        login: dhlLogin.trim(),
        password: dhlPassword,
        accountNumber: dhlEkp.trim(),
        accountNumberExport: dhlEkpExport.trim(),
        sandboxMode: dhlSandbox,
        isDefault
      });
      closeAllModals();
    } catch(err: any) {
      setSaveError(err.message || t('integrations.dhl.errors.save'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestDhlIntegration = async (integrationId: string) => {
    if (!profile?.activeCompanyId) return;
    setTestState(prev => ({ ...prev, [integrationId]: { loading: true, error: '', success: '' } }));
    try {
      const result: any = await testDhlIntegrationCallable({
        companyId: profile.activeCompanyId,
        integrationId
      });
      if (result.data.success) {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, success: result.data.message || t('integrations.dhl.errors.loginSuccess') } }));
        setTimeout(() => setTestState(prev => ({ ...prev, [integrationId]: { loading: false } })), 4000);
      } else {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: result.data.message || t('integrations.dhl.errors.apiError') } }));
      }
    } catch(err: any) {
      setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: err.message } }));
    }
  };

  const handleSaveGls = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!profile?.activeCompanyId || !glsName.trim() || !glsLogin.trim() || !glsPassword || !glsContactId.trim()) return;
    
    setIsSaving(true);
    setSaveError('');
    try {
      await saveGlsIntegrationCallable({
        companyId: profile.activeCompanyId,
        customName: glsName,
        appId: glsAppId.trim(),
        login: glsLogin.trim(),
        password: glsPassword,
        contactId: glsContactId.trim(),
        sandboxMode: glsSandbox,
        isDefault
      });
      closeAllModals();
    } catch(err: any) {
      setSaveError(err.message || 'Błąd zapisu GLS');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestGlsIntegration = async (integrationId: string) => {
    if (!profile?.activeCompanyId) return;
    setTestState(prev => ({ ...prev, [integrationId]: { loading: true, error: '', success: '' } }));
    try {
      const result: any = await testGlsIntegrationCallable({
        companyId: profile.activeCompanyId,
        integrationId
      });
      if (result.data.success) {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, success: result.data.message || 'Zalogowano do GLS' } }));
        setTimeout(() => setTestState(prev => ({ ...prev, [integrationId]: { loading: false } })), 4000);
      } else {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: result.data.message || 'Błąd GLS' } }));
      }
    } catch(err: any) {
      setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: err.message } }));
    }
  };

  const handleTestApiloIntegration = async (integrationId: string) => {
    if (!profile?.activeCompanyId) return;
    setTestState(prev => ({ ...prev, [integrationId]: { loading: true, error: '', success: '' } }));
    try {
      const result: any = await testApiloIntegrationCallable({
        companyId: profile.activeCompanyId,
        integrationId
      });
      if (result.data.success) {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, success: result.data.message || 'Pomyślnie połączono z Apilo!' } }));
        setTimeout(() => setTestState(prev => ({ ...prev, [integrationId]: { loading: false } })), 4000);
      } else {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: result.data.error || 'Błąd autoryzacji Apilo.' } }));
      }
    } catch(err: any) {
      setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: err.message } }));
    }
  };

  const handleSyncApiloOrders = async (integrationId: string) => {
    if (!profile?.activeCompanyId) return;
    setTestState(prev => ({ ...prev, [integrationId]: { loading: true, error: '', success: '' } }));
    try {
      const result: any = await syncApiloOrdersCallable({
        companyId: profile.activeCompanyId,
        integrationId
      });
      if (result.data.success) {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, success: `Pobrano zamówień: ${result.data.count}` } }));
      } else {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: 'Błąd synchronizacji' } }));
      }
    } catch(err: any) {
      setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: err.message } }));
    }
  };

  const handleTestShoperIntegration = async (integrationId: string) => {
    if (!profile?.activeCompanyId) return;
    setTestState(prev => ({ ...prev, [integrationId]: { loading: true, success: '', error: '' } }));
    try {
      const result: any = await testShoperIntegrationCallable({
        companyId: profile.activeCompanyId,
        integrationId
      });
      if (result.data.success) {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, success: result.data.message || 'Pomyślnie połączono z Shoper REST API!' } }));
        setTimeout(() => setTestState(prev => ({ ...prev, [integrationId]: { loading: false } })), 4000);
      } else {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: result.data.error || 'Błąd autoryzacji Shoper.' } }));
      }
    } catch (err: any) {
      setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: err.message || 'Wystąpił nieoczekiwany błąd.' } }));
    }
  };

  const handleSyncShoperOrders = async (integrationId: string) => {
    if (!profile?.activeCompanyId) return;
    setTestState(prev => ({ ...prev, [integrationId]: { loading: true, success: '', error: '' } }));
    try {
      const result: any = await syncShoperOrdersCallable({
        companyId: profile.activeCompanyId,
        integrationId
      });
      if (result.data.success) {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, success: `Pobrano zamówień: ${result.data.imported || result.data.fetched}` } }));
      } else {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: 'Błąd synchronizacji' } }));
      }
    } catch(err: any) {
      setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: err.message } }));
    }
  };

  const handleSyncShoperProducts = async (integrationId: string) => {
    if (!profile?.activeCompanyId) return;
    setTestState(prev => ({ ...prev, [integrationId]: { loading: true, success: '', error: '' } }));
    try {
      const result: any = await syncShoperProductsCallable({
        companyId: profile.activeCompanyId,
        integrationId
      });
      if (result.data.success) {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, success: `Pobrano produktów: ${result.data.imported || result.data.fetched}` } }));
      } else {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: 'Błąd synchronizacji produktów' } }));
      }
    } catch(err: any) {
      setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: err.message } }));
    }
  };

  const handleTestSavedIntegration = async (integrationId: string) => {
    if (!profile?.activeCompanyId) return;
    
    setTestState(prev => ({ ...prev, [integrationId]: { loading: true, error: '', success: '' } }));
    try {
      const result: any = await testIntegrationCallable({
        companyId: profile.activeCompanyId,
        integrationId
      });
      
      if (result.data.success) {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, success: t('integrations.messages.shopConnectSuccess') } }));
        setTimeout(() => setTestState(prev => ({ ...prev, [integrationId]: { loading: false } })), 4000);
      } else {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: result.data.error || t('integrations.messages.shopConnectError') } }));
      }
    } catch(err: any) {
      setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: err.message } }));
    }
  };

  const updateCardState = (id: string, state: any) => {
    setTestState(prev => ({ ...prev, [id]: state }));
  };

  const handleSyncBaselinkerOrders = async (integrationId: string) => {
    if (!profile?.activeCompanyId) return;
    setTestState(prev => ({ ...prev, [integrationId]: { loading: true, error: '', success: '' } }));
    try {
      const result: any = await manualSyncBaselinkerOrdersCallable({
        companyId: profile.activeCompanyId,
        integrationId
      });
      if (result.data.success) {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, success: `Pobrano zamówień: ${result.data.imported || 0}` } }));
      } else {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: 'Błąd synchronizacji' } }));
      }
    } catch(err: any) {
      setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: err.message } }));
    }
  };

  const handleSyncBaselinkerProducts = async (integrationId: string) => {
    if (!profile?.activeCompanyId) return;
    setTestState(prev => ({ ...prev, [integrationId]: { loading: true, error: '', success: '' } }));
    try {
      const result: any = await triggerProductSyncCallable({
        companyId: profile.activeCompanyId,
        integrationId
      });
      if (result.data.success) {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, success: `Rozpoczęto synchronizację produktów` } }));
      } else {
        setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: 'Błąd synchronizacji' } }));
      }
    } catch(err: any) {
      setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: err.message } }));
    }
  };

  const handleSyncGoogleSheets = async (integrationId: string) => {
    if (!profile?.activeCompanyId) return;
    setTestState(prev => ({ ...prev, [integrationId]: { loading: true, error: '', success: '' } }));
    try {
      const { doc, setDoc, serverTimestamp, onSnapshot } = await import('firebase/firestore');
      const jobId = `job_${Date.now()}`;
      const docRef = doc(db, 'companies', profile.activeCompanyId, 'syncJobs', jobId);
      
      await setDoc(docRef, {
         orgId: profile.activeCompanyId,
         integrationId: integrationId,
         type: 'google_sheets_sync',
         status: 'running',
         startedAt: serverTimestamp()
      });
      
      const unsub = onSnapshot(docRef, (snap) => {
         const data = snap.data();
         if (!data) return;
         if (data.status === 'completed') {
            setTestState(prev => ({ ...prev, [integrationId]: { loading: false, success: t('integrations.messages.gsSyncSuccess', { new: data.metrics?.new || 0, skipped: data.metrics?.skipped || 0 }) } }));
            unsub();
         } else if (data.status === 'error' || data.status === 'failed') {
            setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: data.errorMessage || t('integrations.messages.gsSyncError') } }));
            unsub();
         }
      });
    } catch(err: any) {
       setTestState(prev => ({ ...prev, [integrationId]: { loading: false, error: err.message } }));
    }
  };

  const closeAllModals = () => {
    setShowApiloConfig(false);
    setShowShoperConfig(false);
    setShowBlConfig(false);
    setShowGsConfig(false);
    setShowDhlConfig(false);
    setShowGlsConfig(false);
    setIntegrationToDelete(null);
    setIsDeleting(false);
    setDeleteError('');
    setNewName('');
    setNewToken('');
    setBlImportStatusId('');
    setGsName('');
    setSpreadsheetId('');
    setSheetName('');
    
    setDhlName('');
    setDhlLogin('');
    setDhlPassword('');
    setDhlEkp('');
    setDhlEkpExport('');
    setDhlSandbox(false);
    
    setGlsName('');
    setGlsAppId('');
    setGlsLogin('');
    setGlsPassword('');
    setGlsContactId('');
    setGlsSandbox(false);
    
    setShowFgConfig(false);
    setFgName('');
    setFgToken('');
    setFgImportStatus('');
    setFgExportStatus('');
    
    setIsDefault(false);
    setSaveError('');
    setTestState({});
  };

  const handleDeleteIntegration = async (force: boolean = false) => {
    if (!profile?.activeCompanyId || !integrationToDelete?.id) return;
    
    setIsDeleting(true);
    setDeleteError('');
    try {
      if (!force) {
        // Weryfikacja aktywnych operacji importu (zabezpieczenie)
        const jobsRef = collection(db, 'companies', profile.activeCompanyId, 'syncJobs');
        const jobsQuery = query(jobsRef);
        const jobsSnap = await getDocs(jobsQuery);
        
        const hasActiveJob = jobsSnap.docs.some(doc => {
          const data = doc.data();
          return data.integrationId === integrationToDelete.id && (data.status === 'running' || data.status === 'partial');
        });

        if (hasActiveJob) {
          setDeleteError(t('integrations.messages.syncActiveError'));
          setIsDeleting(false);
          return;
        }
      }

      await deleteIntegrationCallable({
        companyId: profile.activeCompanyId,
        integrationId: integrationToDelete.id
      });
      
      closeAllModals();
    } catch(err: any) {
      setDeleteError(err.message || t('integrations.messages.deleteError'));
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-black italic tracking-wide text-[#1A202C]">{t('integrations.title')}</h1>
          <p className="text-gray-500 mt-1">
            {t('integrations.subtitle')}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 font-medium transition-colors shadow-sm"
        >
          <Plus className="w-5 h-5" />
          {t('integrations.addIntegration', 'Dodaj integrację')}
        </button>
      </div>

      {/* Grid Integracji */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        
        {/* Dynamiczne karty BaseLinkera, DHL, Sheets */}
        {standardIntegrations.map((integration) => (
          <IntegrationCard 
            key={integration.id} 
            integration={integration}
            testState={testState[integration.id!]}
            onDisconnect={() => setIntegrationToDelete(integration)}
            onTest={
              integration.type === 'google_sheets' ? undefined :
              () => {
              if (integration.type === 'dhl_de') {
                 handleTestDhlIntegration(integration.id!);
              } else if (integration.type === 'gls_de') {
                 handleTestGlsIntegration(integration.id!);
              } else if (integration.type === 'apilo') {
                 handleTestApiloIntegration(integration.id!);
              } else if (integration.type === 'shoper') {
                 handleTestShoperIntegration(integration.id!);
              } else {
                 handleTestSavedIntegration(integration.id!);
              }
            }}
            onSync={() => {
              if (integration.type === 'apilo') handleSyncApiloOrders(integration.id!);
              if (integration.type === 'shoper') handleSyncShoperOrders(integration.id!);
              if (integration.type === 'google_sheets') handleSyncGoogleSheets(integration.id!);
              if (integration.type === 'baselinker' || integration.type === 'fulfillment_gepard') handleSyncBaselinkerOrders(integration.id!);
            }}
            onSyncProducts={
              integration.type === 'shoper' ? () => handleSyncShoperProducts(integration.id!) :
              (integration.type === 'baselinker' || integration.type === 'fulfillment_gepard') ? () => handleSyncBaselinkerProducts(integration.id!) : undefined
            }
            onUpdateSettings={async (autoSync, syncInterval) => {
              if (!profile?.activeCompanyId || !integration.id) return;
              try {
                const { doc, updateDoc } = await import('firebase/firestore');
                await updateDoc(doc(db, 'companies', profile.activeCompanyId, 'integrations', integration.id), {
                  autoSync,
                  syncInterval
                });
              } catch (err) {
                console.error("Błąd aktualizacji ustawień:", err);
              }
            }}
          />
        ))}

        {/* Dynamiczne karty Allegro */}
        {allegroIntegrations.map((integration) => (
          <div key={integration.id} className="col-span-1 md:col-span-2 lg:col-span-2 xl:col-span-2">
            <AllegroIntegrationCard
              integration={integration}
              companyId={profile?.activeCompanyId || ''}
              onDisconnect={() => setIntegrationToDelete(integration as unknown as Integration)}
            />
          </div>
        ))}
      </div>

      {integrations.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-dashed border-gray-200">
          <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-blue-600 text-[32px]">extension</span>
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">{t('integrations.noIntegrations', 'Nie masz jeszcze żadnych integracji')}</h3>
          <p className="text-gray-500 mb-6 max-w-md mx-auto">
            {t('integrations.emptyState.desc', 'Podłącz swój pierwszy system zewnętrzny, aby móc synchronizować dane.')}
          </p>
          <button 
             onClick={() => setShowAddModal(true)} 
             className="text-blue-600 hover:text-blue-800 font-medium hover:underline inline-flex items-center gap-1"
          >
             <Plus className="w-4 h-4" />
             {t('integrations.addFirst', 'Dodaj pierwszą integrację')}
          </button>
        </div>
      )}

      <ApiloIntegrationModal 
        isOpen={showApiloConfig} 
        onClose={closeAllModals} 
      />

      <ShoperIntegrationModal
        isOpen={showShoperConfig}
        onClose={closeAllModals}
      />

      <AddIntegrationModal 
        isOpen={showAddModal} 
        onClose={() => setShowAddModal(false)}
        onSelectIntegration={handleSelectIntegration}
      />

      {/* MODAL 1B: Fulfillment Gepard (3PL) */}
      {showFgConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={closeAllModals} />
           <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-[480px]">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-orange-50 rounded-t-2xl">
                 <h3 className="text-[17px] font-bold text-orange-900">Fulfillment GEPARD</h3>
                 <button onClick={closeAllModals} className="text-orange-700 hover:text-orange-900">
                    <span className="material-symbols-outlined">close</span>
                 </button>
              </div>
              
              <form autoComplete="off" onSubmit={handleSaveFulfillmentGepard} className="p-6 space-y-5">
                 <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                       Nazwa integracji
                    </label>
                    <input 
                       type="text" 
                       value={fgName}
                       onChange={e => setFgName(e.target.value)}
                       placeholder="np. BaseLinker GEPARD"
                       className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 rounded-xl px-4 py-3 text-[14px] text-gray-900 transition-colors placeholder:text-gray-400 outline-none"
                    />
                 </div>
                 
                 <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex justify-between">
                       <span>Token BaseLinker</span>
                    </label>
                    <input 
                       type="password"
                       autoComplete="new-password"
                       value={fgToken}
                       onChange={e => setFgToken(e.target.value)}
                       placeholder="Token API"
                       className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 rounded-xl px-4 py-3 text-[14px] font-mono text-gray-900 transition-colors placeholder:text-gray-400 outline-none"
                    />
                 </div>

                 <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2" title="ID statusu w BaseLinker, z którego pobierać zamówienia">
                           Import Status ID
                        </label>
                        <input 
                           type="text" 
                           value={fgImportStatus}
                           onChange={e => setFgImportStatus(e.target.value)}
                           placeholder="np. 12345"
                           className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 rounded-xl px-4 py-3 text-[14px] text-gray-900 transition-colors outline-none"
                        />
                     </div>
                     <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2" title="ID statusu w BaseLinker, do którego przenieść po pakowaniu">
                           Export Status ID
                        </label>
                        <input 
                           type="text"
                           value={fgExportStatus}
                           onChange={e => setFgExportStatus(e.target.value)}
                           placeholder="np. 67890"
                           className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-orange-500 focus:ring-1 focus:ring-orange-500 rounded-xl px-4 py-3 text-[14px] text-gray-900 transition-colors outline-none"
                        />
                     </div>
                 </div>

                 <div className="bg-orange-50 text-orange-800 p-3 rounded-lg text-xs leading-relaxed mt-2 border border-orange-100">
                   <strong>Ważne:</strong> Zapisanie tej integracji zautomatyzuje procesy logistyczne dla tego klienta, ustawiając moment zdjęcia stocku na <em>"Po zebraniu towaru ze stoku"</em>.
                 </div>

                 {saveError && <div className="text-red-600 text-xs font-bold bg-red-50 p-2 rounded">{saveError}</div>}
              </form>

              <div className="p-6 pt-0 flex gap-3">
                 <button 
                   type="button"
                   onClick={handleSaveFulfillmentGepard}
                   disabled={isSaving}
                   className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-bold text-[13px] tracking-wide uppercase py-3.5 rounded-xl transition-colors disabled:opacity-50"
                 >
                   {isSaving ? t('integrations.modals.buttons.saving') : t('integrations.modals.buttons.save')}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* MODAL 2: Konfiguracja BaseLinker */}
      {showBlConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={closeAllModals} />
           <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-[480px]">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                 <h3 className="text-[17px] font-bold text-gray-900">{t('integrations.modals.blConfigTitle')}</h3>
                 <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                    <span className="material-symbols-outlined">close</span>
                 </button>
              </div>
              
              <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); handleSave(); }} className="p-6 space-y-5">
                 <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                       {t('integrations.modals.integrationName')}
                    </label>
                    <input 
                       type="text" 
                       id="integration_custom_name"
                       name="integration_custom_name"
                       autoComplete="off"
                       data-lpignore="true"
                       value={newName}
                       onChange={e => setNewName(e.target.value)}
                       placeholder={t('integrations.modals.integrationNamePlaceholder')}
                       className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-4 py-3 text-[14px] text-gray-900 transition-colors placeholder:text-gray-400 outline-none"
                    />
                 </div>
                 
                 <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex justify-between">
                       <span>{t('integrations.modals.blToken')}</span>
                       <span className="text-[10px] text-blue-500 font-normal lowercase cursor-help" title="Gdzie znaleźć klucz? Zaloguj się do BaseLinkera -> Moje konto -> API">{t('integrations.modals.whereToFind')}</span>
                    </label>
                    <input 
                       type="password" /* Bezpieczne wejście, uniemożliwia podgląd całkowicie */
                       id="baselinker_api_token"
                       name="baselinker_api_token"
                       autoComplete="new-password"
                       data-lpignore="true"
                       value={newToken}
                       onChange={e => setNewToken(e.target.value)}
                       placeholder={t('integrations.modals.blTokenPlaceholder')}
                       className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-4 py-3 text-[14px] font-mono text-gray-900 transition-colors placeholder:text-gray-400 outline-none placeholder:font-sans"
                    />
                 </div>

                 <label className="flex items-center gap-3 cursor-pointer group">
                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isDefault ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white group-hover:border-blue-500'}`}>
                       {isDefault && <span className="material-symbols-outlined text-white text-[16px]">check</span>}
                    </div>
                    <input type="checkbox" className="hidden" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
                    <span className="text-[14px] font-medium text-gray-800">{t('integrations.modals.setAsDefault')}</span>
                 </label>

                 {saveError && <div className="text-red-600 text-xs font-bold bg-red-50 p-2 rounded">{saveError}</div>}
                 
                 {testState.modal?.success && <div className="text-green-600 text-xs font-bold bg-green-50 p-2 rounded flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">check_circle</span> {testState.modal.success}</div>}
                 {testState.modal?.error && <div className="text-red-600 text-xs font-bold bg-red-50 p-2 rounded flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">error</span> {testState.modal.error}</div>}
              </form>

              <div className="p-6 pt-0 flex gap-3">
                 <button 
                   type="button"
                   onClick={handleSave}
                   disabled={isSaving}
                   className="flex-1 bg-[#202B3E] hover:bg-[#151D2A] text-white font-bold text-[13px] tracking-wide uppercase py-3.5 rounded-xl transition-colors disabled:opacity-50"
                 >
                   {isSaving ? t('integrations.modals.buttons.saving') : t('integrations.modals.buttons.save')}
                 </button>
                 <button 
                   type="button"
                   onClick={handleTestInModal}
                   className="flex-1 bg-white border border-[#E2E8F0] hover:bg-gray-50 text-[#64748B] font-bold text-[13px] tracking-wide uppercase py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2"
                 >
                   {testState.modal?.loading && <span className="material-symbols-outlined animate-spin text-[16px]">refresh</span>}
                   {t('integrations.modals.buttons.test')}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* MODAL 2B: Konfiguracja Google Sheets */}
      {showGsConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={closeAllModals} />
           <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-[480px]">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                 <h3 className="text-[17px] font-bold text-gray-900">{t('integrations.modals.gsConfigTitle')}</h3>
                 <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                    <span className="material-symbols-outlined">close</span>
                 </button>
              </div>
              
              <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); handleSaveGs(); }} className="p-6 space-y-5">
                 <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                       {t('integrations.modals.integrationName')}
                    </label>
                    <input 
                       type="text" 
                       value={gsName}
                       onChange={e => setGsName(e.target.value)}
                       placeholder="np. Zamówienia 7S"
                       className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-green-500 focus:ring-1 focus:ring-green-500 rounded-xl px-4 py-3 text-[14px] text-gray-900 transition-colors placeholder:text-gray-400 outline-none"
                       required
                    />
                 </div>
                 
                 <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex justify-between">
                       <span>{t('integrations.modals.gsSpreadsheetId')}</span>
                    </label>
                    <input 
                       type="text" 
                       value={spreadsheetId}
                       onChange={e => setSpreadsheetId(e.target.value)}
                       placeholder={t('integrations.modals.gsSpreadsheetPlaceholder')}
                       className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-green-500 focus:ring-1 focus:ring-green-500 rounded-xl px-4 py-3 text-[14px] font-mono text-gray-900 transition-colors placeholder:text-gray-400 outline-none"
                       required
                    />
                 </div>

                 <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex justify-between">
                       <span>{t('integrations.modals.gsSheetName')}</span>
                    </label>
                    <input 
                       type="text" 
                       value={sheetName}
                       onChange={e => setSheetName(e.target.value)}
                       placeholder={t('integrations.modals.gsSheetPlaceholder')}
                       className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-green-500 focus:ring-1 focus:ring-green-500 rounded-xl px-4 py-3 text-[14px] font-mono text-gray-900 transition-colors placeholder:text-gray-400 outline-none"
                       required
                    />
                 </div>

                 {saveError && <div className="text-red-600 text-xs font-bold bg-red-50 p-2 rounded">{saveError}</div>}
                 
                 <div className="bg-yellow-50 text-yellow-800 p-3 rounded-lg text-xs leading-relaxed">
                   <strong>{t('integrations.modals.gsAuthRequired')}</strong> {t('integrations.modals.gsAuthDesc')}
                 </div>
              </form>

              <div className="p-6 pt-0 flex gap-3">
                 <button 
                   type="button"
                   onClick={(e) => handleSaveGs(e)}
                   disabled={isSaving}
                   className="flex-1 bg-[#15803d] hover:bg-[#166534] text-white font-bold text-[13px] tracking-wide uppercase py-3.5 rounded-xl transition-colors disabled:opacity-50"
                 >
                   {isSaving ? t('integrations.modals.buttons.saving') : t('integrations.modals.buttons.saveGs')}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* MODAL 2C: DHL DE Config */}
      {showDhlConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={closeAllModals} />
           <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-[480px]">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-[#b10024] rounded-t-2xl">
                 <h3 className="text-[17px] font-bold text-white uppercase tracking-wider">{t('integrations.dhl.modalTitle')}</h3>
                 <button onClick={closeAllModals} className="text-white hover:text-red-200">
                    <span className="material-symbols-outlined">close</span>
                 </button>
              </div>
              
              <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); handleSaveDhl(e); }} className="p-6 space-y-5">
                 <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                       {t('integrations.dhl.integrationName')}
                    </label>
                    <input 
                       type="text" 
                       value={dhlName}
                       onChange={e => setDhlName(e.target.value)}
                       placeholder={t('integrations.dhl.namePlaceholder')}
                       className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-red-500 focus:ring-1 focus:ring-red-500 rounded-xl px-4 py-3 text-[14px] text-gray-900 transition-colors placeholder:text-gray-400 outline-none"
                    />
                 </div>
                 
                 <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                           {t('integrations.dhl.gkpLogin')}
                        </label>
                        <input 
                           type="text" 
                           value={dhlLogin}
                           onChange={e => setDhlLogin(e.target.value)}
                           className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-red-500 focus:ring-1 focus:ring-red-500 rounded-xl px-4 py-3 text-[14px] text-gray-900 transition-colors outline-none"
                        />
                     </div>
                     <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                           {t('integrations.dhl.gkpPassword')}
                        </label>
                        <input 
                           type="password"
                           autoComplete="new-password"
                           value={dhlPassword}
                           onChange={e => setDhlPassword(e.target.value)}
                           className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-red-500 focus:ring-1 focus:ring-red-500 rounded-xl px-4 py-3 text-[14px] font-mono text-gray-900 transition-colors outline-none"
                        />
                     </div>
                 </div>

                 <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                       {t('integrations.dhl.ekpNumber')}
                    </label>
                    <input 
                       type="text" 
                       value={dhlEkp}
                       onChange={e => setDhlEkp(e.target.value)}
                       placeholder={t('integrations.dhl.ekpPlaceholder')}
                       className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-red-500 focus:ring-1 focus:ring-red-500 rounded-xl px-4 py-3 text-[14px] font-mono text-gray-900 transition-colors outline-none"
                    />
                 </div>

                 <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                       {t('integrations.dhl.ekpExportNumber')}
                    </label>
                    <input 
                       type="text" 
                       value={dhlEkpExport}
                       onChange={e => setDhlEkpExport(e.target.value)}
                       placeholder={t('integrations.dhl.ekpPlaceholder')}
                       className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-red-500 focus:ring-1 focus:ring-red-500 rounded-xl px-4 py-3 text-[14px] font-mono text-gray-900 transition-colors outline-none"
                    />
                 </div>

                 <div className="flex justify-end">
                     <label className="flex items-center gap-3 cursor-pointer group">
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isDefault ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white group-hover:border-blue-500'}`}>
                           {isDefault && <span className="material-symbols-outlined text-white text-[16px]">check</span>}
                        </div>
                        <input type="checkbox" className="hidden" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
                        <span className="text-[14px] font-medium text-gray-800">{t('integrations.dhl.setDefaultToggle')}</span>
                     </label>
                 </div>

                 {saveError && <div className="text-red-600 text-xs font-bold bg-red-50 p-2 rounded">{saveError}</div>}
              </form>

              <div className="p-6 pt-0 flex gap-3">
                 <button 
                   type="button"
                   onClick={(e) => handleSaveDhl(e)}
                   disabled={isSaving}
                   className="flex-1 bg-[#b10024] hover:bg-[#86001b] text-white font-bold text-[13px] tracking-wide uppercase py-3.5 rounded-xl transition-colors disabled:opacity-50"
                 >
                   {isSaving ? t('integrations.dhl.savingBtn') : t('integrations.dhl.saveBtn')}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* MODAL 2D: GLS DE Config */}
      {showGlsConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={closeAllModals} />
           <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-[480px]">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-blue-800 rounded-t-2xl">
                 <h3 className="text-[17px] font-bold text-white uppercase tracking-wider">Nowa Integracja GLS DE</h3>
                 <button onClick={closeAllModals} className="text-white hover:text-blue-200">
                    <span className="material-symbols-outlined">close</span>
                 </button>
              </div>
              
              <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); handleSaveGls(e); }} className="p-6 space-y-5">
                 <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                           Nazwa integracji
                        </label>
                        <input 
                           type="text" 
                           value={glsName}
                           onChange={e => setGlsName(e.target.value)}
                           placeholder="np. GLS Główny"
                           className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-4 py-3 text-[14px] text-gray-900 transition-colors placeholder:text-gray-400 outline-none"
                        />
                     </div>
                     <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                           ID aplikacji (App ID)
                        </label>
                        <input 
                           type="text" 
                           value={glsAppId}
                           onChange={e => setGlsAppId(e.target.value)}
                           placeholder="np. 0cbda3ef-4f6f-..."
                           className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-4 py-3 text-[14px] text-gray-900 transition-colors outline-none"
                        />
                     </div>
                 </div>
                 
                 <div className="grid grid-cols-2 gap-4">
                     <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                           Login (Client ID)
                        </label>
                        <input 
                           type="text" 
                           value={glsLogin}
                           onChange={e => setGlsLogin(e.target.value)}
                           className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-4 py-3 text-[14px] text-gray-900 transition-colors outline-none"
                        />
                     </div>
                     <div>
                        <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                           Hasło (Secret)
                        </label>
                        <input 
                           type="password"
                           autoComplete="new-password"
                           value={glsPassword}
                           onChange={e => setGlsPassword(e.target.value)}
                           className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-4 py-3 text-[14px] font-mono text-gray-900 transition-colors outline-none"
                        />
                     </div>
                 </div>

                 <div>
                    <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">
                       Contact ID
                    </label>
                    <input 
                       type="text" 
                       value={glsContactId}
                       onChange={e => setGlsContactId(e.target.value)}
                       placeholder="Twój Contact ID w GLS"
                       className="w-full bg-gray-50 border border-transparent hover:border-gray-200 focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl px-4 py-3 text-[14px] font-mono text-gray-900 transition-colors outline-none"
                    />
                 </div>

                 <div className="flex justify-end gap-4">
                     <label className="flex items-center gap-3 cursor-pointer group">
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${glsSandbox ? 'bg-yellow-500 border-yellow-500' : 'border-gray-300 bg-white group-hover:border-yellow-500'}`}>
                           {glsSandbox && <span className="material-symbols-outlined text-white text-[16px]">check</span>}
                        </div>
                        <input type="checkbox" className="hidden" checked={glsSandbox} onChange={e => setGlsSandbox(e.target.checked)} />
                        <span className="text-[14px] font-medium text-gray-800">Tryb Sandbox</span>
                     </label>
                     <label className="flex items-center gap-3 cursor-pointer group">
                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isDefault ? 'bg-blue-600 border-blue-600' : 'border-gray-300 bg-white group-hover:border-blue-500'}`}>
                           {isDefault && <span className="material-symbols-outlined text-white text-[16px]">check</span>}
                        </div>
                        <input type="checkbox" className="hidden" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
                        <span className="text-[14px] font-medium text-gray-800">Domyślny</span>
                     </label>
                 </div>

                 {saveError && <div className="text-red-600 text-xs font-bold bg-red-50 p-2 rounded">{saveError}</div>}
              </form>

              <div className="p-6 pt-0 flex gap-3">
                 <button 
                   type="button"
                   onClick={(e) => handleSaveGls(e)}
                   disabled={isSaving}
                   className="flex-1 bg-blue-800 hover:bg-blue-900 text-white font-bold text-[13px] tracking-wide uppercase py-3.5 rounded-xl transition-colors disabled:opacity-50"
                 >
                   {isSaving ? 'Zapisywanie...' : 'Zapisz Integrację GLS'}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* MODAL 3: Usuwanie Integracji (Potwierdzenie) */}
      {integrationToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={closeAllModals} />
           <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-[400px]">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                 <h3 className="text-[17px] font-bold text-gray-900">{t('integrations.modals.deleteTitle')}</h3>
                 <button onClick={closeAllModals} className="text-gray-400 hover:text-gray-600">
                    <span className="material-symbols-outlined">close</span>
                 </button>
              </div>
              <div className="p-6">
                <p className="text-sm text-gray-600 mb-4">
                  {t('integrations.modals.deleteConfirm')} <strong>{integrationToDelete.customName}</strong>? <br/><br/>{t('integrations.modals.deleteWarning')}
                </p>
                {deleteError && (
                  <div className="mb-4 text-red-600 text-xs font-bold bg-red-50 p-3 rounded">
                    {deleteError}
                  </div>
                )}
                <div className="flex gap-3 mt-6">
                  <button 
                    onClick={closeAllModals}
                    disabled={isDeleting}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-[13px] py-3 rounded-xl transition-colors"
                  >
                    {t('integrations.modals.buttons.cancel')}
                  </button>
                  <button 
                    onClick={() => handleDeleteIntegration(deleteError === t('integrations.messages.syncActiveError'))}
                    disabled={isDeleting}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold text-[13px] py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    {isDeleting ? <span className="material-symbols-outlined animate-spin text-[16px]">refresh</span> : (deleteError === t('integrations.messages.syncActiveError') ? 'Wymuś usunięcie' : t('integrations.modals.buttons.deletePermanently'))}
                  </button>
                </div>
              </div>
           </div>
        </div>
      )}

    </div>
  );
}
