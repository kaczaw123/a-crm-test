import React, { useEffect, useState, useMemo } from 'react';
import { collection, query, where, getDocs, documentId, orderBy, limit } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import { useAuth } from '../../../auth/useAuth';
import { Loader2, Package, Search, PackageOpen, X, ArrowUpRight, ArrowDownRight, RefreshCcw, Hand, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../firebase/config';

// Interfaces for mapped state
interface StockItem {
  id: string; // usually {productId}_{locationId}
  productId: string;
  qtyOnHand: number;
  qtyAvailable: number;
  qtyReserved: number;
  lastMovementAt?: Date;

  // Enriched details from /products join
  sku: string;
  ean: string;
  name: string;
  imageUrl?: string;
}

const MovementHistoryPanel = ({ item, companyId, onClose }: { item: StockItem, companyId: string, onClose: () => void }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [movements, setMovements] = useState<any[]>([]);
  const [ordersMap, setOrdersMap] = useState<Record<string, string>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [releasingId, setReleasingId] = useState<string | null>(null);

  const handleReleaseReservation = async (orderId: string, productId: string, moId: string) => {
    if (!window.confirm(t('warehouse.history.confirmRelease', 'Czy na pewno chcesz zwolnić tę rezerwację?'))) return;
    try {
      setReleasingId(moId);
      const fn = httpsCallable(functions, 'releaseReservationManually');
      await fn({ orderId, productId, companyId });
      setRefreshKey(prev => prev + 1);
    } catch(err: any) {
      alert(err.message || 'Błąd zwalniania rezerwacji');
    } finally {
      setReleasingId(null);
    }
  };

  useEffect(() => {
    const fetchMoves = async () => {
      setLoading(true);
      try {
        const q = query(
          collection(db, `companies/${companyId}/inventoryMovements`),
          where('productId', '==', item.productId),
          orderBy('createdAt', 'desc'),
          limit(50)
        );
        const snap = await getDocs(q);
        const fetchedMoves = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        setMovements(fetchedMoves);

        const orderIds = new Set<string>();
        fetchedMoves.forEach(m => {
            if (m.referenceId && typeof m.referenceType === 'string' && m.referenceType.toUpperCase().includes('ORDER')) {
               orderIds.add(m.referenceId);
            }
        });

        if (orderIds.size > 0) {
            const uniqueIds = Array.from(orderIds);
            const chunks = [];
            for (let i = 0; i < uniqueIds.length; i += 30) chunks.push(uniqueIds.slice(i, i + 30));
            
            const mapping: Record<string, string> = {};
            for (const chunk of chunks) {
               try {
                   const ordersQuery = query(collection(db, `companies/${companyId}/orders`), where(documentId(), 'in', chunk));
                   const ordersSnap = await getDocs(ordersQuery);
                   ordersSnap.forEach(d => {
                      mapping[d.id] = d.data().orderNumber || d.data().id || d.id;
                   });
               } catch (e) {
                   console.error('Błąd pobierania mapowania orderów:', e);
               }
            }
            setOrdersMap(mapping);
        }
      } catch (err) {
        console.error('[HistoryPanel] Error loading movements:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchMoves();
  }, [item.productId, companyId, refreshKey]);

  const renderIcon = (type: string) => {
    if (type === 'RECEIPT' || type === 'TRANSFER_IN' || type.includes('ADJUSTMENT_PLUS')) return <ArrowDownRight className="w-4 h-4 text-emerald-600" />;
    if (type === 'ISSUE' || type === 'PICK' || type === 'TRANSFER_OUT' || type.includes('ADJUSTMENT_MINUS')) return <ArrowUpRight className="w-4 h-4 text-rose-600" />;
    if (type === 'RESERVE') return <Hand className="w-4 h-4 text-amber-600" />;
    if (type === 'RELEASE_RESERVATION') return <RefreshCcw className="w-4 h-4 text-blue-600" />;
    return <AlertTriangle className="w-4 h-4 text-gray-500" />;
  };

  return (
    <aside className="w-[380px] bg-white border border-[#E2E8F0] border-t-0 rounded-br-2xl flex flex-col overflow-hidden shrink-0 relative z-10 border-l">
      <div className="h-[52px] px-4 border-b border-[#E2E8F0] bg-gray-50 flex items-center justify-between shrink-0">
        <h3 className="font-bold text-[#0F172A] text-sm">{t('warehouse.history.title', 'Historia logistyczna')}</h3>
        <button onClick={onClose} className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      
      <div className="p-4 border-b border-[#E2E8F0] flex gap-3 items-center shrink-0 bg-white">
        <div className="w-12 h-12 rounded-lg bg-gray-50 border border-gray-100 flex-shrink-0 flex items-center justify-center overflow-hidden">
          {item.imageUrl ? <img src={item.imageUrl} alt="" className="w-full h-full object-cover" /> : <Package className="w-5 h-5 text-gray-400" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm text-[#0F172A] truncate" title={item.name}>{item.name}</div>
          <div className="text-xs text-gray-500 mt-0.5 truncate pr-2">SKU: {item.sku}</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[#F8FAFC]">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mb-2" />
            <span className="text-xs">{t('warehouse.history.loading', 'Ładowanie księgi ruchu...')}</span>
          </div>
        ) : movements.length === 0 ? (
          <div className="text-center p-6 text-sm text-gray-500">{t('warehouse.history.empty', 'Brak zanotowanych ruchów dla tego produktu.')}</div>
        ) : (
          <div className="divide-y divide-[#E2E8F0]">
            {movements.map(m => {
              let movDate = m.createdAt?.toDate ? m.createdAt.toDate() : m.createdAt?._seconds ? new Date(m.createdAt._seconds * 1000) : null;
              const displayRef = ordersMap[m.referenceId] || m.referenceId;
              
              return (
                <div key={m.id} className="p-4 bg-white hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center border border-gray-200">
                        {renderIcon(m.type)}
                      </div>
                      <div>
                        <div className="text-[12px] font-bold text-gray-900 tracking-tight flex items-center gap-2">
                            {m.type}
                            {m.type === 'RESERVE' && m.referenceType?.toUpperCase().includes('ORDER') && (
                               <button 
                                 onClick={() => handleReleaseReservation(m.referenceId, m.productId, m.id)}
                                 disabled={releasingId === m.id}
                                 className="text-red-500 hover:text-red-700 text-[10px] font-medium bg-red-50 px-1.5 py-0.5 rounded border border-red-100 disabled:opacity-50"
                                 title={t('warehouse.history.releaseTitle', 'Zwolnij tę rezerwację')}
                               >
                                 {releasingId === m.id ? '⏳' : `🔓 ${t('warehouse.history.releaseBtn', 'Zwolnij')}`}
                               </button>
                            )}
                        </div>
                        {(m.type === 'ISSUE' || m.type === 'SHIPMENT_CONFIRM') && m.referenceType === 'ORDER_SHIPMENT' ? (
                          <div className="mt-1">
                            <span className="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 uppercase ring-1 ring-inset ring-blue-600/20">
                              🚚 {t('dhlModal.history.shippedBadge', 'Wysłano')}
                            </span>
                            {m.trackingNumber && (
                              <div className="text-[10px] text-gray-500 mt-1 font-mono">
                                {t('dhlModal.history.paka', 'List:')} {m.trackingNumber}
                              </div>
                            )}
                            {m.referenceId && (
                              <Link to={`/app/orders/${m.referenceId}`} className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold mt-0.5 font-mono block mt-1 transition-colors">
                                {t('dhlModal.history.orderLink', 'Zam. ')}{m.orderNumber || displayRef}
                              </Link>
                            )}
                          </div>
                        ) : (
                          m.referenceId && (
                            (m.referenceType === 'order' || m.referenceType === 'ORDER') ? (
                               <div className="text-[10px] text-gray-500 mt-0.5 font-mono flex items-center gap-1">
                                 {t('warehouse.history.orderLabel', 'Zamówienie:')} 
                                 <Link to={`/app/orders/${m.referenceId}`} className="text-indigo-600 hover:text-indigo-800 hover:underline transition-colors font-bold">
                                   {m.orderNumber || displayRef}
                                 </Link>
                               </div>
                            ) : (
                               <div className="text-[10px] text-gray-500 mt-0.5 font-mono">ID: {displayRef}</div>
                            )
                          )
                        )}
                      </div>
                    </div>
                    
                    <div className={`font-mono font-bold text-sm ${m.quantity > 0 && (m.type === 'RECEIPT' || m.type === 'TRANSFER_IN' || m.type.includes('ADJUSTMENT_PLUS')) ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {m.quantity > 0 && (m.type === 'RECEIPT' || m.type === 'TRANSFER_IN' || m.type.includes('ADJUSTMENT_PLUS')) ? '+' : ''}{m.quantity}
                    </div>
                  </div>
                  
                  {movDate && (
                    <div className="mt-3 flex justify-between items-center text-[10px] text-gray-400 border-t border-gray-50 pt-2">
                      <span>{movDate.toLocaleDateString('pl-PL')} {movDate.toLocaleTimeString('pl-PL')}</span>
                      <span className="font-semibold text-gray-500">{t('warehouse.history.qtyAfter', 'Stan fiz. po:')} {m.onHandAfter ?? '-'}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};

const CompanyWarehouse = () => {
  const { profile } = useAuth();
  const { t } = useTranslation();
  const currentCompanyId = (profile as any)?.activeCompanyId || (profile as any)?.companyId;

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null);
  const [showZeroStock, setShowZeroStock] = useState(false);

  const loadStock = async () => {
    if (!currentCompanyId) return;
    setLoading(true);
    setErrorMsg('');

    try {
      let rawStocks: any[] = [];

      if (showZeroStock) {
        // TRYB: katalog-driven. Pobieramy WSZYSTKIE niezarchiwizowane produkty
        // i mergujemy z istniejącymi stockami.
        const productsQuery = query(
          collection(db, `companies/${currentCompanyId}/products`),
          where('isArchived', '!=', true)
        );
        const productsSnap = await getDocs(productsQuery);
        
        // Pobierz WSZYSTKIE stocki firmy do agregacji per productId
        const allStocksSnap = await getDocs(
          collection(db, `companies/${currentCompanyId}/inventoryStock`)
        );
        
        // Agregat per productId (sumujemy wszystkie lokalizacje)
        const stockByProduct = new Map<string, { qtyOnHand: number; qtyAvailable: number; qtyReserved: number; lastMovementAt?: any; firstStockId?: string }>();
        allStocksSnap.docs.forEach(d => {
          const s = d.data() as any;
          const pid = s.productId;
          if (!pid) return;
          const cur = stockByProduct.get(pid) || { qtyOnHand: 0, qtyAvailable: 0, qtyReserved: 0 };
          cur.qtyOnHand += (s.qtyOnHand || 0);
          cur.qtyAvailable += (s.qtyAvailable || 0);
          cur.qtyReserved += (s.qtyReserved || 0);
          if (!cur.firstStockId) cur.firstStockId = d.id;
          if (!cur.lastMovementAt && s.lastMovementAt) cur.lastMovementAt = s.lastMovementAt;
          stockByProduct.set(pid, cur);
        });
        
        // Zbuduj rawStocks z każdego produktu (nawet jeśli stock=0)
        rawStocks = productsSnap.docs.map(d => {
          const pData = d.data() as any;
          const agg = stockByProduct.get(d.id) || { qtyOnHand: 0, qtyAvailable: 0, qtyReserved: 0 };
          return {
            id: agg.firstStockId || `nostock-${d.id}`,
            productId: d.id,
            qtyOnHand: agg.qtyOnHand,
            qtyAvailable: agg.qtyAvailable,
            qtyReserved: agg.qtyReserved,
            lastMovementAt: agg.lastMovementAt,
            sku: pData.sku,
            ean: pData.ean,
            productName: pData.name
          };
        });
      } else {
        // TRYB DOMYŚLNY: stock-driven, qtyOnHand > 0
        const stockQuery = query(
          collection(db, `companies/${currentCompanyId}/inventoryStock`),
          where('qtyOnHand', '>', 0)
        );
        const stockSnap = await getDocs(stockQuery);
        rawStocks = stockSnap.docs.map(d => ({
          id: d.id,
          ...d.data()
        }));
      }

      // 2. Extract unique product IDs for joining with products collection
      const uniqueProductIds = [...new Set(rawStocks.map(s => s.productId).filter(Boolean))];
      const productsMap = new Map<string, any>();

      if (uniqueProductIds.length > 0) {
        try {
          // Chunk product fetching (max 30 per 'in' query)
          const chunks = [];
          for (let i = 0; i < uniqueProductIds.length; i += 30) {
            chunks.push(uniqueProductIds.slice(i, i + 30));
          }

          for (const chunk of chunks) {
            const pQuery = query(
              collection(db, `companies/${currentCompanyId}/products`),
              where(documentId(), 'in', chunk)
            );
            const pSnap = await getDocs(pQuery);
            pSnap.forEach(d => {
              productsMap.set(d.id, d.data());
            });
          }
        } catch (err) {
          console.error('[CompanyWarehouse] Graceful fail fetching CRM products:', err);
          // Allow fallback to show basic names loaded from stock document cache
        }
      }

      // 3. Map and enrich structured state
      const enrichedStocks: StockItem[] = rawStocks.map(s => {
        const productSnapshot = productsMap.get(s.productId);
        
        // Prioritize product catalog data, fallback to stock history snapshot
        const sku = productSnapshot?.sku || productSnapshot?.externalId || s.sku || '';
        const name = productSnapshot?.name || s.productName || 'Produkt nieznany';
        const ean = productSnapshot?.ean || s.ean || '';
        const imageUrl = productSnapshot?.imageThumbUrl || productSnapshot?.imageMainUrl || '';

        let lastMovDate: Date | undefined;
        if (s.lastMovementAt?.toDate) lastMovDate = s.lastMovementAt.toDate();
        else if (s.lastMovementAt?._seconds) lastMovDate = new Date(s.lastMovementAt._seconds * 1000);

        return {
          id: s.id,
          productId: s.productId,
          qtyOnHand: s.qtyOnHand || s.onHand || 0,
          qtyAvailable: s.qtyAvailable || s.available || 0,
          qtyReserved: s.qtyReserved || s.reserved || 0,
          lastMovementAt: lastMovDate,
          sku,
          ean,
          name,
          imageUrl
        };
      });

      setStockItems(enrichedStocks);
    } catch (err: any) {
      console.error(err);
      setErrorMsg('Nie udało się załadować stanów magazynowych.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStock();
  }, [currentCompanyId, showZeroStock]);

  // Client-side quick filter
  const filteredStock = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return stockItems.filter(item => 
      item.name.toLowerCase().includes(term) ||
      item.sku.toLowerCase().includes(term) ||
      item.ean.toLowerCase().includes(term)
    );
  }, [stockItems, searchTerm]);

  if (!currentCompanyId) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* HEADER */}
      <div className="mb-6 shrink-0 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">{t('layout.warehouse', 'Magazyn')}</h1>
          <p className="text-sm text-[#475569] mt-1">{t('warehouse.subtitle', 'Podgląd obecnych stanów fizycznych i rezerwacji Twoich towarów.')}</p>
        </div>
      </div>

      {/* FILTER & TOOLS AREA */}
      <div className="bg-white rounded-t-2xl border border-[#E2E8F0] border-b-0 p-4 shrink-0 flex flex-wrap gap-4 items-center justify-between">
        <div className="relative w-full md:w-[320px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={t('warehouse.search', 'Szukaj po nazwie, SKU, EAN...')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-[#E2E8F0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#4338CA] focus:border-transparent transition-all"
          />
        </div>
        <div className="text-sm text-gray-500 font-medium bg-gray-50 py-1.5 px-3 rounded-lg flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showZeroStock}
              onChange={(e) => setShowZeroStock(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            {t('warehouse.showZeroStock', 'Pokaż produkty bez stanu (qty=0)')}
          </label>
          <div>
            {t('warehouse.indexedRecords', 'Zindeksowane rekordy:')} <span className="text-gray-900 font-bold">{stockItems.length}</span>
          </div>
        </div>
      </div>

      {/* ERROR / LOADER STATES */}
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-b-2xl mb-4">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div className="flex-1 bg-white border border-[#E2E8F0] border-t-0 rounded-b-2xl p-12 flex flex-col items-center justify-center">
            <Loader2 className="w-8 h-8 text-[#4338CA] animate-spin mb-4" />
            <p className="text-[#64748B]">{t('warehouse.loadingStock', 'Wczytywanie fizycznych zasobników...')}</p>
        </div>
      ) : (
        /* TABLE CONTAINER (Structured to easily add aside-grids later) */
        <div className="flex-1 bg-white border border-[#E2E8F0] border-t-0 rounded-b-2xl overflow-hidden flex min-h-0">
          <div className="flex-1 flex flex-col overflow-hidden">
            {filteredStock.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                  <PackageOpen className="w-8 h-8 text-gray-300" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">{t('warehouse.empty.title', 'Pusty magazyn')}</h3>
                <p className="text-sm text-gray-500 max-w-sm">{t('warehouse.empty.subtitle', 'Nie znaleziono żadnych towarów spełniających kryteria na stanie.')}</p>
              </div>
            ) : (
              <div className="flex-1 overflow-auto scrollbar-thin rounded-bl-2xl">
                <table className="w-full text-left border-collapse min-w-[700px]">
                  <thead>
                    <tr className="border-b border-[#E2E8F0] bg-gray-50 text-[11px] font-bold text-[#64748B] uppercase tracking-wider sticky top-0 z-10">
                      <th className="px-5 py-3 font-semibold">{t('warehouse.table.stock', 'Zasobnik')}</th>
                      <th className="px-5 py-3 font-semibold text-center w-[120px]">{t('warehouse.ean', 'EAN')}</th>
                      <th className="px-5 py-3 font-semibold text-center w-[120px]">{t('warehouse.table.onHand', 'Całkowity (OnHand)')}</th>
                      <th className="px-5 py-3 font-semibold text-center w-[120px]">{t('warehouse.table.reserved', 'Zarezerwowane')}</th>
                      <th className="px-5 py-3 font-semibold text-center w-[120px]">{t('warehouse.table.available', 'Dostępne do wysyłki')}</th>
                      <th className="px-5 py-3 font-semibold text-right w-[160px]">{t('warehouse.table.lastMovement', 'Ostatni Ruch')}</th>
                      <th className="px-5 py-3 font-semibold text-left w-[160px]">ID Systemowe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E8F0]">
                    {filteredStock.map(item => (
                      <tr 
                        key={item.id} 
                        onClick={() => setSelectedItem(item)}
                        className={`transition-colors group cursor-pointer ${item.qtyOnHand === 0 ? 'opacity-50 bg-gray-50' : selectedItem?.id === item.id ? 'bg-[#EEF2FF]' : 'hover:bg-gray-50/50'}`}
                      >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-lg bg-gray-100 border border-gray-200 flex-shrink-0 flex items-center justify-center overflow-hidden">
                            {item.imageUrl ? (
                              <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                            ) : (
                              <Package className="w-5 h-5 text-gray-400" />
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-sm text-[#0F172A]">{item.name}</div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="inline-block px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600 font-mono text-[10px] font-semibold border border-gray-200">
                                SKU: {item.sku || '-'}
                              </span>
                              {item.ean && (
                                <span className="inline-block px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600 font-mono text-[10px] font-semibold border border-gray-200">
                                  EAN: {item.ean}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className="font-mono text-xs text-gray-500">{item.ean || '-'}</span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className="font-bold text-gray-900 text-base">{item.qtyOnHand}</span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className="font-bold text-amber-600 text-base">{item.qtyReserved}</span>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <span className="font-bold text-emerald-600 text-base">{item.qtyAvailable}</span>
                      </td>
                      <td className="px-5 py-4 text-right text-xs text-gray-500 font-medium">
                        {item.lastMovementAt ? item.lastMovementAt.toLocaleString('pl-PL', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                        }) : t('warehouse.table.noData', 'Brak danych')}
                      </td>
                      <td className="px-5 py-4 text-left text-[11px] text-gray-400 font-mono select-all">
                        {item.productId || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </div>
          
          {selectedItem && (
            <MovementHistoryPanel 
              item={selectedItem} 
              companyId={currentCompanyId} 
              onClose={() => setSelectedItem(null)} 
            />
          )}

        </div>
      )}
    </div>
  );
};

export default CompanyWarehouse;
