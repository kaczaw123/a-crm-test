import React, { useState, useEffect, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config';
import { useTranslation } from 'react-i18next';
import { X, Search, Loader2, Package, AlertCircle } from 'lucide-react';

interface SearchResult {
  id: string;
  sku?: string;
  ean?: string;
  name?: string;
  imageThumbUrl?: string;
  imageMainUrl?: string;
  inventoryStatus?: {
    onHand: number;
    reserved: number;
    available: number;
  };
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  orderItem: { id: string; ean?: string; sku?: string; name?: string; qtyOrdered?: number };
  onSuccess: () => void;
}

export function ManualMappingModal({ isOpen, onClose, companyId, orderItem, onSuccess }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const debounceRef = useRef<any>(null);

  // Pre-wypełnij EAN z zamówienia jako sugestia startowa
  useEffect(() => {
    if (isOpen) {
      setQuery(orderItem.ean || orderItem.sku || '');
      setErrorMsg('');
      setResults([]);
    }
  }, [isOpen, orderItem.ean, orderItem.sku]);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const fn = httpsCallable(functions, 'searchProducts');
        const res: any = await fn({ companyId, query: query.trim(), limitCount: 30 });
        setResults(res.data?.results || []);
      } catch (err: any) {
        console.error('[ManualMappingModal] search err:', err);
        setErrorMsg(err.message || 'Błąd wyszukiwania');
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, isOpen, companyId]);

  const handleSelect = async (product: SearchResult) => {
    setSubmitting(true);
    setErrorMsg('');
    try {
      const fn = httpsCallable(functions, 'setOrderItemMapping');
      await fn({ companyId, orderItemId: orderItem.id, productId: product.id });
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('[ManualMappingModal] submit err:', err);
      setErrorMsg(err.message || 'Błąd mapowania');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <div>
            <h3 className="text-lg font-bold text-gray-900">
              {t('orders.manualMapping.title', 'Mapuj pozycję ręcznie')}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              {t('orders.manualMapping.subtitle', 'Wybierz produkt z katalogu który ma zostać przypisany do tej pozycji zamówienia.')}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info o pozycji zamówienia */}
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 text-xs">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span><span className="text-gray-500">EAN:</span> <span className="font-mono font-semibold">{orderItem.ean || '—'}</span></span>
            <span><span className="text-gray-500">SKU:</span> <span className="font-mono font-semibold">{orderItem.sku || '—'}</span></span>
            <span><span className="text-gray-500">Nazwa:</span> <span className="font-semibold">{orderItem.name || '—'}</span></span>
            <span><span className="text-gray-500">Ilość:</span> <span className="font-bold">{orderItem.qtyOrdered ?? '—'}</span></span>
          </div>
        </div>

        {/* Search input */}
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('orders.manualMapping.searchPlaceholder', 'Szukaj po EAN, SKU lub nazwie...')}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />}
          </div>
        </div>

        {errorMsg && (
          <div className="mx-6 mt-3 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {errorMsg}
          </div>
        )}

        {/* Results list */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {results.length === 0 && !searching && query.trim().length >= 2 && (
            <div className="text-center text-sm text-gray-400 py-8">
              {t('orders.manualMapping.noResults', 'Brak wyników. Spróbuj innego zapytania.')}
            </div>
          )}
          {results.length === 0 && query.trim().length < 2 && (
            <div className="text-center text-sm text-gray-400 py-8">
              {t('orders.manualMapping.startTyping', 'Wpisz min. 2 znaki, aby wyszukać.')}
            </div>
          )}
          <ul className="divide-y divide-gray-100">
            {results.map((p) => {
              const onHand = p.inventoryStatus?.onHand ?? 0;
              const available = p.inventoryStatus?.available ?? 0;
              const stockClass = onHand === 0 
                ? 'text-gray-400 bg-gray-100' 
                : (available > 0 ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50');
              const imgUrl = p.imageThumbUrl || p.imageMainUrl;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => handleSelect(p)}
                    disabled={submitting}
                    className="w-full text-left py-3 px-2 hover:bg-blue-50 rounded transition-colors flex items-center gap-3 disabled:opacity-50"
                  >
                    <div className="w-10 h-10 rounded border border-gray-200 bg-white shrink-0 flex items-center justify-center overflow-hidden">
                      {imgUrl ? <img src={imgUrl} alt="" className="w-full h-full object-cover" /> : <Package className="w-5 h-5 text-gray-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-gray-900 truncate">{p.name || '—'}</div>
                      <div className="text-xs text-gray-500 font-mono mt-0.5 truncate">
                        SKU: {p.sku || '—'} | EAN: {p.ean || '—'}
                      </div>
                      <div className="text-[10px] font-mono text-gray-400 mt-0.5 truncate">ID: {p.id}</div>
                    </div>
                    <div className={`shrink-0 text-xs font-bold px-2 py-1 rounded ${stockClass}`}>
                      {t('orders.manualMapping.stock', 'Stan')}: {onHand}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-right">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 rounded-lg disabled:opacity-50"
          >
            {t('common.cancel', 'Anuluj')}
          </button>
        </div>
      </div>
    </div>
  );
}
