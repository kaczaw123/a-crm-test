import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../auth/useAuth';
import { X, Search, Plus, Save, Trash2, Check, ExternalLink, RefreshCw, PackageMinus } from 'lucide-react';
import type { ProductV2 } from '../../../data/products';
import { collection, getDocs, query, where, documentId } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { createOutboundShipmentCallable, finalizeOutboundShipmentCallable, cancelOutboundShipmentCallable, submitOutboundShipmentCallable } from '../../../data/outbound';
import type { OutboundShipment, OutboundShipmentItem } from '../../../data/outbound';


interface OutboundFormProps {
  onClose: () => void;
  existingOutbound: OutboundShipment | null;
  companyIdOverride?: string;
}

export const OutboundForm: React.FC<OutboundFormProps> = ({ onClose, existingOutbound, companyIdOverride }) => {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const contextCompanyId = companyIdOverride || (existingOutbound as any)?.orgId || profile?.activeCompanyId;
  
  const [issuedTo, setIssuedTo] = useState(existingOutbound?.issuedTo || '');
  const [notes, setNotes] = useState(existingOutbound?.notes || '');
  const [items, setItems] = useState<Partial<OutboundShipmentItem>[]>([]);
  
  const [products, setProducts] = useState<ProductV2[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchExistingItems = async () => {
      if (existingOutbound?.id && contextCompanyId) {
        const itemsRef = collection(db, `companies/${contextCompanyId}/outboundShipments/${existingOutbound.id}/items`);
        const snapshot = await getDocs(itemsRef);
        const fetchedItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as OutboundShipmentItem));
        setItems(fetchedItems);
      }
    };

    fetchExistingItems();
  }, [existingOutbound, contextCompanyId]);

  useEffect(() => {
    const fetchProducts = async () => {
      if (!contextCompanyId) return;

      try {
        const stockQuery = query(
          collection(db, `companies/${contextCompanyId}/inventoryStock`),
          where('qtyOnHand', '>', 0)
        );
        const stockSnap = await getDocs(stockQuery);

        const stockMap = new Map();
        stockSnap.docs.forEach(doc => {
            const data = doc.data() as any;
            const avail = data.qtyAvailable || data.available || 0;
            const pid = data.productId;
            if (!pid) return;

            if (!stockMap.has(pid)) {
                stockMap.set(pid, { availableQty: 0, fallbackName: data.productName, fallbackSku: data.sku, fallbackEan: data.ean });
            }
            stockMap.get(pid).availableQty += avail;
        });

        // Usunięcie tych co mają 0 na stanie dysponowanym (bo się nie da ich wydać)
        for (const [key, value] of stockMap.entries()) {
            if (value.availableQty <= 0) stockMap.delete(key);
        }

        if (stockMap.size === 0) {
            setProducts([]);
            return;
        }

        const productIds = Array.from(stockMap.keys());
        const productsList: ProductV2[] = [];

        // Chunking po 30 elementów (limity firestore 'in')
        const chunks = [];
        for (let i = 0; i < productIds.length; i += 30) {
            chunks.push(productIds.slice(i, i + 30));
        }

        for (const chunk of chunks) {
            // import { documentId } from 'firebase/firestore' musi byc na górze
            const pQuery = query(
                collection(db, `companies/${contextCompanyId}/products`),
                // @ts-ignore
                where('__name__', 'in', chunk) 
            );
            const pSnap = await getDocs(pQuery);
            pSnap.docs.forEach(doc => {
                const v = doc.data() as any;
                const stockInfo = stockMap.get(doc.id);
                if (stockInfo) {
                    productsList.push({
                        id: doc.id,
                        ...v,
                        name: v.name || stockInfo.fallbackName,
                        sku: v.sku || stockInfo.fallbackSku || '',
                        ean: v.ean || stockInfo.fallbackEan || '',
                        availableQty: stockInfo.availableQty
                    } as ProductV2);
                    stockMap.delete(doc.id); // Odznaczone jako znalezione
                }
            });
        }

        // Pozostałe w stockMap, w razie gdyby nie było ich w 'products'
        stockMap.forEach((info, pid) => {
            productsList.push({
                id: pid,
                name: info.fallbackName || 'Nieznany produkt',
                sku: info.fallbackSku || '',
                ean: info.fallbackEan || '',
                availableQty: info.availableQty
            } as ProductV2);
        });

        setProducts(productsList);
      } catch (err) {
        console.error('Błąd w pobieraniu produktów WZ:', err);
      }
    };

    fetchProducts();
  }, [profile?.activeCompanyId]);

  const handleAddItem = (product: ProductV2) => {
    if (items.some(i => i.productId === product.id)) {
      alert(t('outbound.form.errorAlreadyAdded', 'Ten produkt został już dodany do WZ.'));
      return;
    }

    if ((product.availableQty || 0) <= 0) {
        alert(t('outbound.form.errorZeroStock', 'Ten produkt ma zerowy stan dysponowany.'));
        return;
    }

    setItems([...items, {
      productId: product.id,
      sku: product.sku,
      ean: product.ean || '',
      name: product.name,
      issuedQty: 1
    }]);
    setSearchTerm('');
  };

  const updateItemQty = (index: number, newQty: number) => {
    if (newQty < 1) newQty = 1;

    // Optional Check: don't let user type more than available stock
    const productId = items[index].productId;
    const prod = products.find(p => p.id === productId);
    if (prod && newQty > (prod.availableQty || 0)) {
        alert(`${t('outbound.form.errorExceedsStock', 'Maksymalny stan do wydania dla tego SKU to')} ${prod.availableQty}`);
        newQty = prod.availableQty || 0;
    }

    const newItems = [...items];
    newItems[index].issuedQty = newQty;
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const handleSaveDraft = async () => {
    if (!profile?.activeCompanyId) return;
    if (items.length === 0) {
      alert(t('outbound.form.noItemsError', 'Musisz dodać co najmniej jeden produkt.'));
      return;
    }

    setIsSaving(true);
    try {
      await createOutboundShipmentCallable({
        companyId: contextCompanyId || profile?.activeCompanyId || '',
        issuedTo,
        notes,
        items
      });
      alert(t('outbound.form.draftSaved', 'Wersja robocza została zapisana.'));
      onClose();
    } catch (err: any) {
      console.error(err);
      alert(err?.message || t('common.error', 'Wystąpił błąd podczas zapisu.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleFinalize = async () => {
    if (!contextCompanyId || !existingOutbound?.id) return;
    
    if (window.confirm(t('outbound.form.confirmFinalize', 'Czy na pewno chcesz zatwierdzić to wydań? Zabierze to trwale produkty z systemu.'))) {
        setIsSaving(true);
        try {
            await finalizeOutboundShipmentCallable({
                companyId: contextCompanyId,
                shipmentId: existingOutbound.id
            });
            alert(t('outbound.form.finalized', 'Zatwierdzono WZ. Stany magazynowe zaktualizowane.'));
            onClose();
        } catch (err: any) {
            console.error(err);
            alert(err?.message || t('common.error', 'Błąd zatwierdzania.'));
        } finally {
            setIsSaving(false);
        }
    }
  };

  const handleSubmitPending = async () => {
    if (!contextCompanyId || !existingOutbound?.id) return;
    
    if (window.confirm(t('outbound.form.submitConfirm', 'Czy na pewno chcesz zgłosić WZ do wydania przez magazyn? Po zgłoszeniu projekt zablokuje możliwość edycji.'))) {
        setIsSaving(true);
        try {
            await submitOutboundShipmentCallable({
                companyId: contextCompanyId,
                shipmentId: existingOutbound.id
            });
            alert(t('outbound.form.submitSuccess', 'Dokument zgłoszony pomyślnie. Zmienił status na Oczekujące (Pending).'));
            onClose();
        } catch (err: any) {
            console.error(err);
            alert(err?.message || t('common.error', 'Wystąpił błąd podczas zgłoszenia na magazyn.'));
        } finally {
            setIsSaving(false);
        }
    }
  };


  const handleCancel = async () => {
    if (!contextCompanyId || !existingOutbound?.id) return;
    
    if (window.confirm(t('outbound.form.confirmCancel', 'Czy na pewno chcesz trwale usunąć/anulować ten zarys WZ?'))) {
        setIsSaving(true);
        try {
            await cancelOutboundShipmentCallable({
                companyId: contextCompanyId,
                shipmentId: existingOutbound.id
            });
            alert(t('outbound.form.canceled', 'Dokument został anulowany.'));
            onClose();
        } catch (err: any) {
            console.error(err);
            alert(err?.message || t('common.error', 'Błąd anulowania.'));
        } finally {
            setIsSaving(false);
        }
    }
  };

  const isReadOnly = existingOutbound?.status === 'completed' || existingOutbound?.status === 'canceled' || (existingOutbound?.status === 'pending' && ((profile as any)?.role || '').toLowerCase() !== 'superadmin');
  
  // Fuzzy Search
  const filteredProducts = products.filter(p => {
    const s = searchTerm.toLowerCase();
    return p.sku?.toLowerCase().includes(s) || 
           p.name?.toLowerCase().includes(s) || 
           p.ean?.toLowerCase().includes(s);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
              {existingOutbound ? existingOutbound.documentNumber : t('outbound.form.newTitle', 'Nowy Dokument WZ')}
            </h2>
            {existingOutbound && (
                <span className={`inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                  existingOutbound.status === 'completed' ? 'bg-green-100 text-green-700' :
                  existingOutbound.status === 'canceled' ? 'bg-red-100 text-red-700' :
                  'bg-orange-100 text-orange-700'
                }`}>
                  {existingOutbound.status}
                </span>
            )}
          </div>
          <button 
            onClick={onClose} 
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
            
            {/* Info Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('outbound.form.issuedTo', 'Odbiorca / Wydano Do')}
                </label>
                <input
                  type="text"
                  value={issuedTo}
                  onChange={(e) => setIssuedTo(e.target.value)}
                  disabled={isReadOnly}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
                  placeholder="Imię i nazwisko odbierającego, nazwa kuriera itp."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {t('outbound.form.notes', 'Wewnętrzne Notatki')}
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={isReadOnly}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
                  placeholder="Opcjonalny komentarz"
                />
              </div>
            </div>

            {/* Product Selector */}
            {!isReadOnly && (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-slate-900 border-b border-slate-100 pb-2">
                  {t('outbound.form.addItems', 'Dodaj pozycje do wydania')}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    placeholder={t('outbound.form.searchProduct', 'Szukaj SKU lub nazwy...')}
                    className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all shadow-sm"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  
                  {/* Dropdown Results */}
                  {searchTerm.length > 1 && (
                    <div className="absolute z-10 mt-1 w-full bg-white rounded-lg border border-slate-200 shadow-lg max-h-60 overflow-y-auto">
                      {filteredProducts.length > 0 ? (
                        <ul className="py-1">
                          {filteredProducts.map(product => (
                            <li 
                              key={product.id}
                              onClick={() => handleAddItem(product)}
                              className="px-4 py-3 hover:bg-slate-50 cursor-pointer flex justify-between items-center border-b border-slate-100 last:border-0"
                            >
                              <div>
                                <div className="font-semibold text-slate-800 flex items-center gap-2">
                                  {product.sku}
                                  {product.ean && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono border border-slate-200">EAN: {product.ean}</span>}
                                </div>
                                <div className="text-xs text-slate-500 truncate">{product.name}</div>
                              </div>
                              <div className="text-sm font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded">
                                Stok: {product.availableQty || 0}
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="py-4 text-center text-sm text-slate-500">
                          {t('outbound.form.noProductsFound', 'Nie znaleziono produktów.')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Selected Items */}
            <div className="space-y-3">
              <label className="block text-sm font-bold text-slate-700">
                {t('outbound.form.itemsList', 'Lista towarów do wydania')} ({items.length})
              </label>
              
              {items.length === 0 ? (
                <div className="text-center py-6 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
                  <PackageMinus className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">{t('outbound.form.emptyItems', 'Dodaj asortyment który chcesz wydać')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={idx} className="flex flex-col sm:flex-row items-center justify-between p-4 border border-slate-200 rounded-xl bg-white shadow-sm">
                      <div className="flex-1 w-full truncate">
                        <div className="font-semibold text-slate-900">{item.sku}</div>
                        <div className="text-sm text-slate-500 truncate mr-4">{item.name}</div>
                      </div>
                      <div className="flex items-center gap-4 mt-3 sm:mt-0 w-full sm:w-auto">
                        <div className="flex items-center bg-slate-100 rounded-lg p-1">
                          <input
                            type="number"
                            min="1"
                            value={item.issuedQty || 1}
                            onChange={(e) => updateItemQty(idx, parseInt(e.target.value) || 1)}
                            disabled={isReadOnly}
                            className="w-20 text-center font-semibold bg-transparent border-none focus:ring-0 p-1 [-moz-appearance:_textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <span className="text-xs font-semibold uppercase text-slate-400 mr-2">szt</span>
                        </div>
                        
                        {!isReadOnly && (
                          <button
                            onClick={() => removeItem(idx)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
            <div>
              {existingOutbound?.status === 'draft' && (
                  <button 
                  onClick={handleCancel}
                  disabled={isSaving}
                  className="text-red-600 hover:text-red-700 font-medium px-4 py-2 hover:bg-red-50 rounded-lg transition-colors flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  {t('outbound.form.deleteDraft', 'Usuń Projekt')}
                </button>
              )}
            </div>
            
            <div className="flex gap-3">
                <button
                onClick={onClose}
                disabled={isSaving}
                className="px-6 py-2 border border-slate-200 text-slate-700 bg-white rounded-lg hover:bg-slate-50 font-medium transition-colors"
                >
                {t('common.cancel', 'Zamknij')}
                </button>
                
                {!isReadOnly && (
                    <>
                      {!existingOutbound && (
                          <button
                          onClick={handleSaveDraft}
                          disabled={isSaving || items.length === 0}
                          className="px-6 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 font-medium transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
                          >
                          {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                          {t('outbound.form.saveAsDraft', 'Zapisz Projekt')}
                          </button>
                      )}
                      
                      {existingOutbound?.status === 'draft' && ((profile as any)?.role || '').toLowerCase() !== 'superadmin' && (
                          <button
                          onClick={handleSubmitPending}
                          disabled={isSaving || items.length === 0}
                          className="px-6 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
                          >
                          {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          {t('outbound.form.submitPending', 'Zgłoś do wydania')}
                          </button>
                      )}

                      {existingOutbound && (existingOutbound.status.toLowerCase() === 'draft' || existingOutbound.status.toLowerCase() === 'pending') && ((profile as any)?.role || '').toLowerCase() === 'superadmin' && (
                          <button
                          onClick={handleFinalize}
                          disabled={isSaving || items.length === 0}
                          className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
                          >
                          {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          Zatwierdź i Wydaj
                          </button>
                      )}
                    </>
                )}
            </div>
        </div>

      </div>
    </div>
  );
};
