import React, { useState, useEffect } from 'react';
import { useAuth } from '../../../auth/useAuth';
import { db } from '../../../firebase/config';
import { functions } from '../../../firebase/config';
import { httpsCallable } from 'firebase/functions';
import { collection, query, orderBy, limit, startAfter, getDocs, where, onSnapshot, doc } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';
import { type ProductV2 } from '../../../data/products';
import { type Integration, triggerProductSyncCallable, getIntegrationInventoriesCallable } from '../../../data/integrations';
import CreateInboundFromProductsModal from './CreateInboundFromProductsModal';
import EditProductLogisticsModal from './EditProductLogisticsModal';
import AddProductModal from '../../../components/products/AddProductModal';
import ArchiveProductWarningModal, { type ProductWithStock } from '../../../components/products/ArchiveProductWarningModal';
import toast from 'react-hot-toast';

export default function CompanyProducts() {
  const { profile } = useAuth();
  const { t } = useTranslation();
  
  const [products, setProducts] = useState<ProductV2[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [selectedProducts, setSelectedProducts] = useState<Map<string, ProductV2>>(new Map());
  const [showInboundModal, setShowInboundModal] = useState(false);

  const handleTabChange = (tab: 'active' | 'archived') => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setCurrentPage(0);
    setPageMarkers([]);
    setSelectedProducts(new Map());
  };

  // Archive state
  const [isArchiving, setIsArchiving] = useState(false);
  const [isUnarchiving, setIsUnarchiving] = useState(false);
  const [unarchiveModal, setUnarchiveModal] = useState<{ count: number } | null>(null);
  const [archiveModal, setArchiveModal] = useState<{ productsWithStock: ProductWithStock[] } | null>(null);
  
  // Edit Logistics Modal State
  const [editingProduct, setEditingProduct] = useState<ProductV2 | null>(null);
  
  // Add Product Modal State
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  
  // Pagination
  const [pageMarkers, setPageMarkers] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [pageSize, setPageSize] = useState(50);

  // Search
  const [searchSku, setSearchSku] = useState('');
  const [searchEan, setSearchEan] = useState('');
  const [searchName, setSearchName] = useState('');

  // Sync Modal State
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState('');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<any>(null); // from syncJobs
  const [isSyncing, setIsSyncing] = useState(false);

  const [inventories, setInventories] = useState<any[]>([]);
  const [selectedInventoryId, setSelectedInventoryId] = useState<string>('');
  const [isLoadingInventories, setIsLoadingInventories] = useState(false);
  const [inventoriesError, setInventoriesError] = useState('');

  useEffect(() => {
    if (!profile?.activeCompanyId) return;
    loadProducts(true);
    // eslint-disable-next-line
  }, [profile?.activeCompanyId, currentPage, pageSize, activeTab]);

  const fetchIntegrations = async () => {
    if (!profile?.activeCompanyId) return;
    const snap = await getDocs(query(collection(db, 'companies', profile.activeCompanyId, 'integrations')));
    const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Integration));
    setIntegrations(data);
    if (data.length > 0) setSelectedIntegration(data[0].id!);
  };

  useEffect(() => {
    async function loadInventories() {
      if (!profile?.activeCompanyId || !selectedIntegration || !showSyncModal) {
        setInventories([]);
        setSelectedInventoryId('');
        return;
      }
      setIsLoadingInventories(true);
      setInventoriesError('');

      try {
        const response: any = await getIntegrationInventoriesCallable({
          companyId: profile.activeCompanyId,
          integrationId: selectedIntegration
        });
        const invList = response.data.inventories || [];
        setInventories(invList);
        
        if (invList.length > 0) {
          setSelectedInventoryId(String(invList[0].inventory_id));
        } else {
          setSelectedInventoryId('');
        }
      } catch (err: any) {
        setInventoriesError(err.message || t('products.error.fetchBaselinkerInventories'));
      } finally {
        setIsLoadingInventories(false);
      }
    }

    loadInventories();
  }, [profile?.activeCompanyId, selectedIntegration, showSyncModal]);

  const loadProducts = async (isNewQuery = false) => {
    if (!profile?.activeCompanyId) return;
    setLoading(true);

    try {
      const collRef = collection(db, 'companies', profile.activeCompanyId, 'products');
      let q = query(collRef, limit(pageSize));

      // 0. Apply Archived Filter
      if (activeTab === 'archived') {
        q = query(q, where('isArchived', '==', true));
      }

      // 1. Apply Search filters (Exact / Normalized)
      if (searchSku.trim()) {
        q = query(q, where('skuExact', '==', searchSku.trim()));
      } else if (searchEan.trim()) {
        q = query(q, where('eanExact', '==', searchEan.trim()));
      } else if (searchName.trim()) {
        const normalizedName = searchName.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
        q = query(q, where('nameNormalized', '==', normalizedName));
      } else {
        // Only apply default order if no exact filter is active to keep index requirements simple initially
        // If querying archived, we skip orderBy to avoid compound index requirement for 'isArchived' + 'updatedAt'
        if (activeTab === 'active') {
          q = query(q, orderBy('updatedAt', 'desc'));
        }
      }

      // 2. Pagination Cursors
      if (!isNewQuery && currentPage > 0 && pageMarkers[currentPage - 1]) {
        q = query(q, startAfter(pageMarkers[currentPage - 1]));
      }

      const snapshot = await getDocs(q);
      const data = snapshot.docs
        .map(d => {
          const docData = d.data();
          return { ...docData, id: d.id, productId: d.id } as ProductV2;
        });

      // Zostawiamy lokalne filtrowanie dla zakładki Aktywne, bo na starych produktach nie ma isArchived
      const finalData = activeTab === 'active' 
        ? data.filter(p => !p.isArchived)
        : data;

      setProducts(finalData);
      setHasNextPage(snapshot.docs.length === pageSize);

      // Save marker for next page
      if (snapshot.docs.length > 0) {
        setPageMarkers(prev => {
          const newMarkers = [...prev];
          newMarkers[currentPage] = snapshot.docs[snapshot.docs.length - 1];
          return newMarkers;
        });
      }
    } catch (e) {
      console.error(t('products.error.fetchProducts'), e);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(0);
    setPageMarkers([]);
    loadProducts(true);
  };

  const handleClearSearch = () => {
    setSearchSku('');
    setSearchEan('');
    setSearchName('');
    setCurrentPage(0);
    setPageMarkers([]);
    setSelectedProducts(new Map()); // Clear selection on full reset
    setTimeout(() => loadProducts(true), 100);
  };

  // Selection Logic
  const toggleSelect = (p: ProductV2) => {
    setSelectedProducts(prev => {
      const next = new Map(prev);
      if (next.has(p.productId)) next.delete(p.productId);
      else next.set(p.productId, p);
      return next;
    });
  };

  const toggleSelectAllPage = () => {
    const allSelected = products.length > 0 && products.every(p => selectedProducts.has(p.productId));
    setSelectedProducts(prev => {
      const next = new Map(prev);
      if (allSelected) {
         products.forEach(p => next.delete(p.productId));
      } else {
         products.forEach(p => next.set(p.productId, p));
      }
      return next;
    });
  };

  const handleArchiveSelectedProducts = async () => {
    if (!profile?.activeCompanyId || selectedProducts.size === 0) return;

    const companyId = profile.activeCompanyId;
    const selected = Array.from(selectedProducts.values());

    // Check inventory stock for each selected product
    const stockChecks = await Promise.all(
      selected.map(async (p) => {
        const snap = await getDocs(
          query(
            collection(db, `companies/${companyId}/inventoryStock`),
            where('productId', '==', p.productId || p.id)
          )
        );
        const qtyOnHand = snap.docs.reduce((sum, d) => sum + (d.data().qtyOnHand || 0), 0);
        return { p, qtyOnHand };
      })
    );

    const withStock: ProductWithStock[] = stockChecks
      .filter(({ qtyOnHand }) => qtyOnHand > 0)
      .map(({ p, qtyOnHand }) => ({
        productId: p.productId || p.id!,
        name: p.name || '-',
        sku: p.sku || '-',
        qtyOnHand,
      }));

    if (withStock.length > 0) {
      setArchiveModal({ productsWithStock: withStock });
      return;
    }

    await doArchive(selected, companyId);
  };

  const doArchive = async (products: ProductV2[], companyId: string) => {
    setIsArchiving(true);
    setArchiveModal(null);
    const archiveFn = httpsCallable(functions, 'archiveProduct');
    const errors: string[] = [];

    for (const p of products) {
      try {
        await archiveFn({ companyId, productId: p.productId || p.id });
      } catch (err: any) {
        errors.push(`${p.name || p.productId}: ${err.message}`);
      }
    }

    setIsArchiving(false);
    setSelectedProducts(new Map());
    setCurrentPage(0);
    setPageMarkers([]);
    loadProducts(true);

    if (errors.length > 0) {
      toast.error(`Błąd archiwizacji:\n${errors.join('\n')}`);
    } else {
      toast.success('Produkty zostały zarchiwizowane.');
    }
  };

  const doUnarchive = async (products: ProductV2[], companyId: string) => {
    setIsUnarchiving(true);
    const unarchiveFn = httpsCallable(functions, 'unarchiveProduct');
    const errors: string[] = [];

    for (const p of products) {
      try {
        await unarchiveFn({ companyId, productId: p.id });
      } catch (err: any) {
        errors.push(`${p.name || p.productId}: ${err.message}`);
      }
    }

    setIsUnarchiving(false);
    setSelectedProducts(new Map());
    setCurrentPage(0);
    setPageMarkers([]);
    loadProducts(true);

    if (errors.length > 0) {
      toast.error(`Błąd przywracania:\n${errors.join('\n')}`);
    } else {
      toast.success('Produkty zostały przywrócone.');
    }
  };

  // ------------------ SYNC JOB SYSTEM ------------------
  
  // Nasłuchuj na jobie, by renderować pasek postępu w czasie rzeczywistym
  useEffect(() => {
    if (!profile?.activeCompanyId || !activeJobId) return;
    
    const unsubscribe = onSnapshot(
      doc(db, 'companies', profile.activeCompanyId, 'syncJobs', activeJobId),
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setJobState(data);

          if (data.status === 'completed' || data.status === 'failed') {
             if (data.debugOutput && data.debugOutput.length > 0 && !(window as any).debugAlertShown) {
               (window as any).debugAlertShown = true;
               setTimeout(() => {
                 window.prompt("Skopiuj ten tekst i wyślij programiście:", data.debugOutput.join("\n"));
               }, 500);
             }

             setIsSyncing(false);
             if (data.status === 'completed') {
               // Reload table after completing
               setCurrentPage(0);
               setPageMarkers([]);
               loadProducts(true);
             }
          } else if (data.status === 'partial') {
             // Polling: Auto-continue calling the function while partial (Client Orchestration!)
             resumeSyncJob();
          }
        }
      }
    );
    return () => unsubscribe();
    // eslint-disable-next-line
  }, [profile?.activeCompanyId, activeJobId]);

  const resumeSyncJob = async () => {
    if (!profile?.activeCompanyId || !selectedIntegration || !activeJobId || !selectedInventoryId) return;
    try {
      await triggerProductSyncCallable({
        companyId: profile.activeCompanyId,
        integrationId: selectedIntegration,
        inventoryId: selectedInventoryId,
        jobId: activeJobId
      });
    } catch (e) {
      console.error("Partial resume failed", e);
    }
  };

  const startSync = async () => {
    if (!profile?.activeCompanyId || !selectedIntegration || !selectedInventoryId) return;
    setIsSyncing(true);
    setJobState(null);
    setActiveJobId(null);

    try {
      const response: any = await triggerProductSyncCallable({
        companyId: profile.activeCompanyId,
        integrationId: selectedIntegration,
        inventoryId: selectedInventoryId
      });
      if (response.data && response.data.jobId) {
        setActiveJobId(response.data.jobId);
      }
    } catch (e: any) {
      alert(`${t('products.syncModal.startError')} ${e.message}`);
      setIsSyncing(false);
    }
  };

  const openSyncModal = () => {
    fetchIntegrations();
    setShowSyncModal(true);
  };

  return (
    <div className="w-full px-4 md:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black italic tracking-wide text-[#1A202C] uppercase">{t('products.title')}</h1>
          <p className="text-[11px] font-bold text-gray-400 uppercase mt-1 tracking-wider">
            {t('products.subtitle')}
          </p>
          <div className="flex gap-2 mt-4 bg-gray-100 p-1 rounded-xl w-fit">
            <button
              onClick={() => handleTabChange('active')}
              className={`px-4 py-1.5 text-sm font-bold rounded-lg transition-colors ${activeTab === 'active' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Aktywne
            </button>
            <button
              onClick={() => handleTabChange('archived')}
              className={`px-4 py-1.5 text-sm font-bold rounded-lg transition-colors ${activeTab === 'archived' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Zarchiwizowane
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowAddProductModal(true)}
            className="inline-flex items-center justify-center px-6 py-2.5 text-sm font-bold text-white bg-[#0A3D91] hover:bg-[#083075] rounded-full shadow-sm transition-colors"
          >
            <span className="material-symbols-outlined text-[18px] mr-2">add_circle</span>
            {t('products.btn.addProduct')}
          </button>
        </div>
      </div>

      {/* Action Bar (Search & Tools) */}
      <div className="flex flex-col xl:flex-row gap-3">
        {/* Search */}
        <form onSubmit={handleSearch} className="flex-1 flex bg-white border border-gray-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 shadow-sm">
           <div className="flex items-center pl-4 text-gray-400">
             <span className="material-symbols-outlined text-[20px]">search</span>
           </div>
           <input
              type="text"
              placeholder={t('products.searchPlaceholder')}
              value={searchName || searchSku || searchEan}
              onChange={e => setSearchName(e.target.value)}
              className="flex-1 w-full text-sm px-3 py-3 font-medium text-gray-900 placeholder-gray-400 outline-none"
           />
           {(searchName || searchSku || searchEan) && (
              <button type="button" onClick={handleClearSearch} className="px-4 text-gray-400 hover:text-gray-600">
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
           )}
           <button type="submit" className="hidden">{t('products.btn.search')}</button>
        </form>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
           <button type="button" className="inline-flex items-center px-4 py-3 text-[13px] font-bold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-sm">
             <span className="material-symbols-outlined text-[18px] mr-2">filter_list</span>
             {t('products.btn.filter')}
           </button>
           <button 
             onClick={openSyncModal}
             className="inline-flex items-center px-4 py-3 text-[13px] font-bold text-[#0A3D91] bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors shadow-sm"
           >
             <span className="material-symbols-outlined text-[18px] mr-2">sync</span>
             {t('products.btn.syncBL')}
           </button>
           <button type="button" className="inline-flex items-center px-4 py-3 text-[13px] font-bold text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors shadow-sm">
             {t('products.btn.operations')}
             <span className="material-symbols-outlined text-[18px] ml-1">expand_more</span>
           </button>
           {activeTab === 'active' && (
             <button 
               type="button" 
               onClick={() => setShowInboundModal(true)}
               disabled={selectedProducts.size === 0}
               className="inline-flex items-center px-5 py-3 text-[13px] font-bold text-white bg-[#E85D04] border border-transparent rounded-xl hover:bg-[#D35400] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
             >
               <span className="material-symbols-outlined text-[18px] mr-2">local_shipping</span>
               {t('products.btn.sendToFulfillment')} ({selectedProducts.size})
             </button>
           )}
           {activeTab === 'active' ? (
             <button
               type="button"
               onClick={handleArchiveSelectedProducts}
               disabled={selectedProducts.size === 0 || isArchiving}
               className="inline-flex items-center px-5 py-3 text-[13px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
             >
               <span className="material-symbols-outlined text-[18px] mr-2">{isArchiving ? 'hourglass_empty' : 'archive'}</span>
               Archiwizuj ({selectedProducts.size})
             </button>
           ) : (
             <button
               type="button"
               onClick={() => setUnarchiveModal({ count: selectedProducts.size })}
               disabled={selectedProducts.size === 0 || isUnarchiving}
               className="inline-flex items-center px-5 py-3 text-[13px] font-bold text-green-700 bg-green-50 border border-green-200 rounded-xl hover:bg-green-100 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
             >
               <span className="material-symbols-outlined text-[18px] mr-2">{isUnarchiving ? 'hourglass_empty' : 'unarchive'}</span>
               Przywróć ({selectedProducts.size})
             </button>
           )}
        </div>
      </div>

      <div className="bg-white rounded-[24px] shadow-sm border border-gray-100 overflow-hidden">
        {/* Tabela */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-white border-b border-gray-100">
                <th className="py-4 px-6 text-[10px] font-bold text-gray-400 uppercase tracking-widest w-[40px] text-center">
                  <span 
                    onClick={toggleSelectAllPage}
                    className={`material-symbols-outlined text-[18px] cursor-pointer transition-colors ${products.length > 0 && products.every(p => selectedProducts.has(p.productId)) ? 'text-primary-600' : 'hover:text-gray-500'}`}
                  >
                    {products.length > 0 && products.every(p => selectedProducts.has(p.productId)) ? 'check_box' : 'check_box_outline_blank'}
                  </span>
                </th>
                <th className="py-4 px-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest w-[40px] text-center"><span className="material-symbols-outlined text-[16px]">star</span></th>
                <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest w-[64px]">{t('products.table.photo')}</th>
                <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('products.table.name')}</th>
                <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('products.table.sku')}</th>
                <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('products.table.ean')}</th>
                {activeTab === 'active' ? (
                  <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('products.table.logistics')}</th>
                ) : (
                  <>
                    <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Zarchiwizowano</th>
                    <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Przez</th>
                  </>
                )}
                <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">ID Systemowe</th>
                {activeTab === 'archived' && (
                  <th className="py-4 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Akcje</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-500">
                    <span className="material-symbols-outlined animate-spin text-3xl">refresh</span>
                    <p className="mt-2 text-sm font-medium">{t('products.loading')}</p>
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-500">
                    <span className="material-symbols-outlined text-4xl mb-2 text-gray-300">inventory</span>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">Brak produktów</p>
                    <p className="text-sm">Nie znaleziono pozycji w tym widoku.</p>
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr key={p.productId} className={`transition-colors group ${selectedProducts.has(p.productId) ? 'bg-blue-50/50 hover:bg-blue-50' : 'hover:bg-gray-50/50'}`}>
                    <td className="py-[2px] px-6 text-center">
                      <span 
                        onClick={() => toggleSelect(p)}
                        className={`material-symbols-outlined text-[18px] cursor-pointer transition-colors ${selectedProducts.has(p.productId) ? 'text-blue-600' : 'text-gray-300 group-hover:text-gray-400'}`}
                      >
                        {selectedProducts.has(p.productId) ? 'check_box' : 'check_box_outline_blank'}
                      </span>
                    </td>
                    <td className="py-[2px] px-2 text-center text-gray-200 group-hover:text-gray-300"><span className="material-symbols-outlined text-[18px]">star</span></td>
                    <td className="py-[2px] px-4">
                      {p.imageThumbUrl ? (
                        <img src={p.imageThumbUrl} alt="Thumb" loading="lazy" className="w-[48px] h-[48px] rounded-lg object-cover border border-gray-100 bg-white shadow-sm" />
                      ) : (
                        <div className="w-[48px] h-[48px] rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-300">
                          <span className="material-symbols-outlined text-[20px]">image_not_supported</span>
                        </div>
                      )}
                    </td>
                    <td className="py-[2px] px-4">
                      <div className="text-[13px] font-bold text-gray-900 max-w-[400px] uppercase truncate" title={p.name}>{p.name}</div>
                    </td>
                    <td className="py-[2px] px-4 text-[12px] font-bold text-[#0A3D91] font-mono tracking-wider">
                      {p.sku || p.externalId || '-'}
                    </td>
                    <td className="py-[2px] px-4 text-[12px] font-bold text-gray-500 font-mono tracking-wider">
                      {p.ean || '-'}
                    </td>
                    {activeTab === 'active' ? (
                      <td className="py-[2px] px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-[#E85D04] font-bold text-[12px]">{p.logistics?.weight || 0} kg</span>
                          <span className="bg-gray-100 text-gray-500 px-2 py-1 rounded text-[11px] font-bold tracking-widest">
                            {p.logistics?.length || 0}x{p.logistics?.width || 0}x{p.logistics?.height || 0} cm
                          </span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setEditingProduct(p); }}
                            className="ml-auto flex items-center justify-center p-1.5 rounded-lg text-gray-400 hover:text-[#0A3D91] hover:bg-blue-50 transition-colors"
                            title="Edytuj Parametry Logistyczne"
                          >
                            <span className="material-symbols-outlined text-[18px]">edit_square</span>
                          </button>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td className="py-[2px] px-4 text-[12px] text-gray-500">
                          {p.archivedAt ? p.archivedAt.toDate().toLocaleString() : '-'}
                        </td>
                        <td className="py-[2px] px-4 text-[12px] text-gray-500 font-mono">
                          {p.archivedBy || '-'}
                        </td>
                      </>
                    )}
                    <td className="py-[2px] px-4 text-[11px] text-gray-400 font-mono select-all">
                      {p.externalId || p.id || '-'}
                    </td>
                    {activeTab === 'archived' && (
                      <td className="py-[2px] px-4 text-right">
                        <button
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            if (!profile?.activeCompanyId) return;
                            doUnarchive([p], profile.activeCompanyId); 
                          }}
                          disabled={isUnarchiving}
                          className="inline-flex items-center justify-center p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                          title="Przywróć Produkt"
                        >
                          <span className="material-symbols-outlined text-[18px]">unarchive</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginacja */}
        <div className="px-4 py-3 bg-white border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between sm:px-6 gap-4">
          <div className="flex items-center gap-4">
             <p className="text-[13px] font-medium text-gray-500">
               {t('products.pagination.page')} <span className="font-bold text-gray-900">{currentPage + 1}</span> 
               {products.length > 0 && <span> • {t('products.pagination.showing', { count: products.length })}</span>}
             </p>
             <div className="flex items-center gap-2 border-l border-gray-200 pl-4 h-5">
                <span className="text-[13px] font-medium text-gray-500">{t('products.pagination.pageSize')}</span>
                <select 
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(0);
                    setPageMarkers([]);
                  }}
                  className="bg-transparent border-none text-[13px] font-bold text-gray-900 focus:ring-0 p-0 cursor-pointer outline-none"
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                  <option value={300}>300</option>
                  <option value={500}>500</option>
                  <option value={1000}>1000</option>
                  <option value={2000}>2000</option>
                  <option value={4000}>4000</option>
                  <option value={100000}>{t('products.pagination.all')}</option>
                </select>
             </div>
          </div>
          <div className="flex-1 flex justify-between sm:justify-end gap-2">
            <button
              onClick={() => { setCurrentPage(p => p - 1); setProducts([]); }}
              disabled={currentPage === 0 || loading}
              className="relative inline-flex items-center px-4 py-2 border border-gray-200 text-sm font-bold rounded-xl text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm"
            >
              {t('products.pagination.prev')}
            </button>
            <button
              onClick={() => { setCurrentPage(p => p + 1); setProducts([]); }}
              disabled={!hasNextPage || loading}
              className="relative inline-flex items-center px-4 py-2 border border-gray-200 text-sm font-bold rounded-xl text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm"
            >
              {t('products.pagination.next')}
            </button>
          </div>
        </div>
      </div>

      {/* Sync Jobs Modal */}
      {showSyncModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div className="fixed inset-0 transition-opacity bg-gray-900/75 backdrop-blur-sm" onClick={() => !isSyncing && setShowSyncModal(false)} />
            <div className="relative inline-block w-full max-w-md p-6 overflow-hidden text-left align-middle transition-all transform bg-white dark:bg-gray-800 shadow-xl rounded-2xl">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
                {t('products.syncModal.title')}
              </h3>
              
              {!activeJobId && !isSyncing ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('products.syncModal.source')}
                    </label>
                    <select
                      value={selectedIntegration}
                      onChange={(e) => setSelectedIntegration(e.target.value)}
                      className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                    >
                      {integrations.length === 0 && <option value="">{t('products.syncModal.noIntegrations')}</option>}
                      {integrations.map(int => (
                        <option key={int.id} value={int.id}>{int.customName}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('products.syncModal.inventory')}
                    </label>
                    {isLoadingInventories ? (
                      <div className="text-sm text-gray-500 flex items-center gap-2 p-2">
                        <span className="material-symbols-outlined animate-spin text-[16px]">refresh</span>
                        {t('products.syncModal.fetchingInventories')}
                      </div>
                    ) : inventoriesError ? (
                      <div className="text-sm text-red-500 bg-red-50 border border-red-200 p-2 rounded">
                        {inventoriesError}
                      </div>
                    ) : (
                      <select
                        value={selectedInventoryId}
                        onChange={(e) => setSelectedInventoryId(e.target.value)}
                        disabled={inventories.length <= 1}
                        className={`w-full px-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 ${inventories.length <= 1 ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
                      >
                        {inventories.length === 0 && <option value="">{t('products.syncModal.noInventories')}</option>}
                        {inventories.map(inv => (
                          <option key={inv.inventory_id} value={inv.inventory_id}>
                            {inv.name} (ID: {inv.inventory_id})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  
                  <div className="bg-blue-50 text-blue-800 text-xs p-3 rounded border border-blue-100">
                    <span className="font-bold">{t('products.syncModal.infoRule')}</span> {t('products.syncModal.infoDesc')}
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      onClick={() => setShowSyncModal(false)}
                      className="px-4 py-2 text-sm font-medium border rounded-lg hover:bg-gray-50"
                    >
                      {t('products.btn.close')}
                    </button>
                    <button
                      onClick={startSync}
                      disabled={!selectedIntegration || !selectedInventoryId || isLoadingInventories || !!inventoriesError}
                      className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 focus:ring-2 disabled:opacity-50 transition-colors"
                    >
                      {t('products.btn.startImport')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 text-center py-6">
                   <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-2">
                     <span className={`material-symbols-outlined text-3xl text-blue-600 ${isSyncing ? 'animate-spin' : ''}`}>
                       {jobState?.status === 'completed' ? 'download_done' : (jobState?.status === 'failed' ? 'error' : 'sync')}
                     </span>
                   </div>
                   <h4 className="text-lg font-bold text-gray-900">
                     {jobState?.status === 'running' && t('products.syncModal.state.creating')}
                     {jobState?.status === 'partial' && t('products.syncModal.state.fetching')}
                     {jobState?.status === 'completed' && t('products.syncModal.state.completed')}
                     {jobState?.status === 'failed' && t('products.syncModal.state.failed')}
                     {!jobState && t('products.syncModal.state.initializing')}
                   </h4>
                   
                   {jobState && (
                     <div className="bg-gray-50 p-4 rounded-lg text-sm text-left border space-y-2">
                       <div className="flex justify-between">
                         <span className="text-gray-500">{t('products.syncModal.processedCount')}</span>
                         <span className="font-mono font-medium">{jobState.processedCount || 0}</span>
                       </div>
                       <div className="flex justify-between">
                         <span className="text-gray-500">{t('products.syncModal.updatedCount')}</span>
                         <span className="font-mono font-medium text-green-600">{jobState.updatedCount || 0}</span>
                       </div>
                       {jobState.lastErrorMessageSafe && (
                         <div className="text-red-500 text-xs mt-2 p-2 bg-red-50 rounded">
                           {jobState.lastErrorMessageSafe}
                         </div>
                       )}
                       {jobState.debugOutput && jobState.debugOutput.length > 0 && (
                         <div className="text-[10px] text-gray-500 mt-2 p-2 bg-gray-100 rounded max-h-40 overflow-y-auto font-mono">
                           {jobState.debugOutput.map((d: string, i: number) => <div key={i}>{d}</div>)}
                         </div>
                       )}
                     </div>
                   )}

                   {(!isSyncing || jobState?.status === 'completed') && (
                     <div className="mt-6">
                       <button
                         onClick={() => setShowSyncModal(false)}
                         className="px-6 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800"
                       >
                         {t('products.syncModal.backToList')}
                       </button>
                     </div>
                   )}
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* Wyślij do Fulfillmentu Modal */}
      {showInboundModal && profile?.activeCompanyId && (
        <CreateInboundFromProductsModal
          companyId={profile.activeCompanyId}
          selectedProducts={Array.from(selectedProducts.values())}
          onClose={(clearSelection?: boolean) => {
             setShowInboundModal(false);
             if (clearSelection) setSelectedProducts(new Map());
          }}
        />
      )}

      {/* Edit Logistics Modal */}
      {editingProduct && profile?.activeCompanyId && (
        <EditProductLogisticsModal
          companyId={profile.activeCompanyId}
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSuccess={(updatedProduct) => {
            setProducts(prev => prev.map(p => p.productId === updatedProduct.productId ? updatedProduct : p));
            setEditingProduct(null);
          }}
        />
      )}

      {/* Add Product Modal */}
      {showAddProductModal && profile?.activeCompanyId && (
        <AddProductModal
          companyId={profile.activeCompanyId}
          onClose={() => setShowAddProductModal(false)}
          onSuccess={() => {
            setShowAddProductModal(false);
            setCurrentPage(0);
            setPageMarkers([]);
            loadProducts(true);
            alert(t('products.productAdded'));
          }}
        />
      )}

      {/* Archive Warning Modal */}
      {archiveModal && profile?.activeCompanyId && (
        <ArchiveProductWarningModal
          totalCount={selectedProducts.size}
          productsWithStock={archiveModal.productsWithStock}
          isArchiving={isArchiving}
          onConfirm={() => {
            if (!profile?.activeCompanyId) return;
            doArchive(Array.from(selectedProducts.values()), profile.activeCompanyId);
          }}
          onCancel={() => setArchiveModal(null)}
        />
      )}

      {/* Unarchive Batch Modal */}
      {unarchiveModal && profile?.activeCompanyId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Przywróć produkty</h3>
            <p className="text-sm text-gray-600 mb-6">
              Czy na pewno chcesz przywrócić {unarchiveModal.count} produktów?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setUnarchiveModal(null)}
                disabled={isUnarchiving}
                className="px-4 py-2 text-sm font-medium border rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Anuluj
              </button>
              <button
                onClick={() => {
                  if (!profile?.activeCompanyId) return;
                  doUnarchive(Array.from(selectedProducts.values()), profile.activeCompanyId);
                  setUnarchiveModal(null);
                }}
                disabled={isUnarchiving}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 focus:ring-2 disabled:opacity-50 flex items-center"
              >
                {isUnarchiving && <span className="material-symbols-outlined text-[16px] animate-spin mr-2">refresh</span>}
                Przywróć
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
