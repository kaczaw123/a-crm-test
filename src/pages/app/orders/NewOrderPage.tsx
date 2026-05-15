import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../firebase/config';
import { useAuth } from '../../../auth/useAuth';
import { Search, Loader2, Plus, Minus, X, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OrderRecipient } from '../../../data/orders';

interface CartItem {
  productId: string;
  sku: string;
  ean: string;
  name: string;
  qtyOrdered: number;
  available: number;
  onHand: number;
}

export default function NewOrderPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { t } = useTranslation();

  // Recipient form state
  const [recipient, setRecipient] = useState<OrderRecipient>({
    firstName: '', lastName: '', companyName: '', phone: '', email: '',
    address: { street: '', zipCode: '', city: '', country: 'PL' }
  });

  const [shippingMethod, setShippingMethod] = useState('Standard');
  const [courierCode, setCourierCode] = useState('dhl');
  const [notes, setNotes] = useState('');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Cart state
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  
  // Unikalny identyfikator próby zapisu (Idempotency Key) wygenerowany przy ładowaniu koszyka.
  // Zabezpiecza przed Double-Clickiem oraz utratą sygnału po stronie klienta.
  const [requestId, setRequestId] = useState<string>(() => {
    return typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  });

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query || query.length < 3) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const searchFn = httpsCallable(functions, 'searchProducts');
      const res = await searchFn({ companyId: profile?.activeCompanyId, query, limitCount: 20 });
      setSearchResults((res.data as any).results || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const addToCart = (product: any) => {
    setCartItems(prev => {
      const existing = prev.find(i => i.productId === product.id);
      if (existing) {
        return prev.map(i => i.productId === product.id ? { ...i, qtyOrdered: i.qtyOrdered + 1 } : i);
      }
      return [...prev, {
        productId: product.id,
        sku: product.skuNormalized || product.skuExact || '',
        ean: product.eanNormalized || product.eanExact || '',
        name: product.nameNormalized || product.name || '',
        qtyOrdered: 1,
        available: product.inventoryStatus?.available || 0,
        onHand: product.inventoryStatus?.onHand || 0,
      }];
    });
    setSearchQuery('');
    setSearchResults([]);
  };

  const removeCartItem = (productId: string) => {
    setCartItems(prev => prev.filter(i => i.productId !== productId));
  };

  const changeQty = (productId: string, delta: number) => {
    setCartItems(prev => prev.map(i => {
      if (i.productId === productId) {
        const newQty = Math.max(1, i.qtyOrdered + delta);
        return { ...i, qtyOrdered: newQty };
      }
      return i;
    }));
  };

  const submitOrder = async () => {
    if (cartItems.length === 0) return setErrorMsg(t('newOrder.validation.noProducts', 'Musisz dodać, chociaż jeden produkt.'));
    if (!recipient.firstName || !recipient.lastName || !recipient.address.street) {
      return setErrorMsg(t('newOrder.validation.missingData', 'Wypełnij wymagane dane adresata (Imię, Nazwisko, Ulica).'));
    }

    setIsSubmitting(true);
    setErrorMsg('');
    try {
      const createOrderFn = httpsCallable(functions, 'createManualOrder');
      const payload = {
        requestId,       // IDEMPOTENCY KEY Z FRONTENDU
        companyId: profile?.activeCompanyId,
        recipient,
        shippingMethod,
        courierCode,
        notes,
        items: cartItems.map(i => ({
          productId: i.productId,
          qtyOrdered: i.qtyOrdered,
          sku: i.sku,
          ean: i.ean,
          name: i.name
        }))
      };

      const res = await createOrderFn(payload);
      
      if ((res.data as any).success) {
        // Wszystko udane, idziemy na listę (nawet jeśli to była bezpieczna de-duplikacja udana wcześniej)
        navigate('/app/orders');
      }
    } catch (err: any) {
      // Przepakowanie błędów dla Usera
      let displayMsg = err.message || t('newOrder.unexpectedError', 'Wystąpił nieoczekiwany błąd przy tworzeniu transakcji.');
      if (err.message?.includes('DUPLICATE_ORDER')) {
        // Przechwycenie logicznego błędu deduplikacji i potraktowanie go jako "sukces" dla UI (bo order już jest tam gdzie ma być)
        navigate('/app/orders');
        return;
      }
      setErrorMsg(displayMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 bg-gray-50/50 p-6 md:p-8 ml-0 md:ml-64 mt-16 md:mt-0 transition-all duration-300">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t('newOrder.title', 'NOWE ZAMÓWIENIE (MANUAL)')}</h1>
          <p className="text-sm text-gray-500 mt-2">{t('newOrder.subtitle', 'Zero-Trust Frontend. Logika stanu egzekwowana przez Backend Transakcyjny.')}</p>
        </div>

        {errorMsg && (
          <div className="mb-6 rounded-lg bg-red-50 p-4 border border-red-200">
            <h3 className="text-sm font-medium text-red-800">{t('newOrder.errorAuth', 'Odmowa utworzenia zamówienia')}</h3>
            <div className="mt-2 text-sm text-red-700">{errorMsg}</div>
          </div>
        )}

        <div className="space-y-6">
          {/* Adresat */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-base font-semibold leading-7 text-gray-900 mb-4 border-b border-gray-100 pb-3">{t('newOrder.step1.title', '1. Dane Odbiorcy')}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input type="text" placeholder={t('newOrder.step1.firstName', 'Imię *')} className="w-full rounded-lg border-0 py-2.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-gray-900 sm:text-sm" value={recipient.firstName} onChange={e => setRecipient({...recipient, firstName: e.target.value})} />
              <input type="text" placeholder={t('newOrder.step1.lastName', 'Nazwisko *')} className="w-full rounded-lg border-0 py-2.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-gray-900 sm:text-sm" value={recipient.lastName} onChange={e => setRecipient({...recipient, lastName: e.target.value})} />
              <input type="text" placeholder={t('newOrder.step1.company', 'Firma (opcjonalnie)')} className="w-full rounded-lg border-0 py-2.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-gray-900 sm:text-sm" value={recipient.companyName} onChange={e => setRecipient({...recipient, companyName: e.target.value})} />
              <input type="email" placeholder={t('newOrder.step1.email', 'E-mail')} className="w-full rounded-lg border-0 py-2.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-gray-900 sm:text-sm" value={recipient.email} onChange={e => setRecipient({...recipient, email: e.target.value})} />
              <input type="text" placeholder={t('newOrder.step1.phone', 'Telefon')} className="w-full rounded-lg border-0 py-2.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-gray-900 sm:text-sm" value={recipient.phone} onChange={e => setRecipient({...recipient, phone: e.target.value})} />
              <input type="text" placeholder={t('newOrder.step1.street', 'Ulica i nr bud. *')} className="w-full md:col-span-2 rounded-lg border-0 py-2.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-gray-900 sm:text-sm" value={recipient.address.street} onChange={e => setRecipient({...recipient, address: {...recipient.address, street: e.target.value}})} />
              <input type="text" placeholder={t('newOrder.step1.zipCode', 'Kod pocztowy')} className="w-full rounded-lg border-0 py-2.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-gray-900 sm:text-sm" value={recipient.address.zipCode} onChange={e => setRecipient({...recipient, address: {...recipient.address, zipCode: e.target.value}})} />
              <input type="text" placeholder={t('newOrder.step1.city', 'Miasto')} className="w-full rounded-lg border-0 py-2.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-gray-900 sm:text-sm" value={recipient.address.city} onChange={e => setRecipient({...recipient, address: {...recipient.address, city: e.target.value}})} />
            </div>
          </section>

          {/* Produkty (Live Search backendowy) */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-base font-semibold leading-7 text-gray-900 mb-4 border-b border-gray-100 pb-3">{t('newOrder.step2.title', '2. Asortyment')}</h2>
            
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                placeholder={t('newOrder.step2.searchPlaceholder', 'Szukaj po SKU, EAN, Nazwie... (bez ładowania do RAM-u)')}
                className="block w-full rounded-lg border-0 py-3 pl-10 pr-4 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-gray-900 sm:text-sm"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
              />
              {isSearching && (
                <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                </div>
              )}
            </div>

            {searchQuery.length >= 3 && searchResults.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-60 w-full md:w-auto md:max-w-2xl overflow-auto rounded-lg bg-white py-1 text-base shadow-2xl ring-1 ring-black ring-opacity-5 sm:text-sm">
                {searchResults.map((prod) => (
                  <li
                    key={prod.id}
                    className="relative cursor-pointer select-none py-3 pl-3 pr-9 hover:bg-gray-50 flex items-center justify-between"
                    onClick={() => addToCart(prod)}
                  >
                    <div className="flex flex-col">
                      <span className="font-semibold text-gray-900">{prod.skuNormalized || prod.skuExact}</span>
                      <span className="text-gray-500 text-xs">{prod.nameNormalized || prod.name}</span>
                    </div>
                    <div className="text-right ml-4">
                      <div className="text-xs font-medium text-gray-500">{t('newOrder.step2.available', 'Dostępne:')} <span className={prod.inventoryStatus?.available > 0 ? 'text-green-600 font-bold' : 'text-red-500 font-bold'}>{prod.inventoryStatus?.available || 0}</span></div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Koszyk */}
            {cartItems.length > 0 && (
              <div className="mt-8">
                <table className="w-full text-left text-sm whitespace-nowrap overflow-x-auto block">
                  <thead className="border-b border-gray-200">
                    <tr>
                      <th className="pb-3 pr-8 font-medium text-gray-900">{t('newOrder.step2.table.product', 'SKU / Towar')}</th>
                      <th className="pb-3 px-4 font-medium text-gray-900 text-center">{t('newOrder.step2.table.realStock', 'Zapasy Realne (Ava)')}</th>
                      <th className="pb-3 pl-8 font-medium text-gray-900 text-right">{t('newOrder.step2.table.qty', 'Ilość Szt.')}</th>
                      <th className="pb-3 pl-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cartItems.map(item => (
                      <tr key={item.productId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                        <td className="py-4 pr-8">
                          <div className="font-medium text-gray-900">{item.sku}</div>
                          <div className="text-xs text-gray-500 truncate max-w-[200px]">{item.name}</div>
                        </td>
                        <td className="py-4 px-4 text-center">
                          {item.available}
                        </td>
                        <td className="py-4 pl-8 text-right">
                          <div className="flex items-center justify-end gap-2">
                             <button onClick={() => changeQty(item.productId, -1)} className="p-1 hover:bg-gray-200 rounded-md bg-gray-100 text-gray-600"><Minus className="w-3 h-3"/></button>
                             <span className="w-8 text-center font-bold">{item.qtyOrdered}</span>
                             <button onClick={() => changeQty(item.productId, 1)} className="p-1 hover:bg-gray-200 rounded-md bg-gray-100 text-gray-600"><Plus className="w-3 h-3"/></button>
                          </div>
                        </td>
                        <td className="py-4 pl-4 text-right">
                          <button onClick={() => removeCartItem(item.productId)} className="text-red-500 hover:text-red-700 bg-red-50 p-2 rounded-lg transition-colors">
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Wysyłka */}
          <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
             <h2 className="text-base font-semibold leading-7 text-gray-900 mb-4 border-b border-gray-100 pb-3">{t('newOrder.step3.title', '3. Operacje Logistyczne')}</h2>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <select className="w-full rounded-lg border-0 py-2.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-gray-900 sm:text-sm" value={shippingMethod} onChange={e => setShippingMethod(e.target.value)}>
                    <option value="Standard">{t('newOrder.step3.methods.standard', 'Standardowa Wysyłka (B2C)')}</option>
                    <option value="Paleta">{t('newOrder.step3.methods.pallet', 'Paleta Przemysłowa (B2B)')}</option>
                    <option value="Punkt">{t('newOrder.step3.methods.point', 'Punkt Odbioru (Paczkomat)')}</option>
                 </select>
                 <select className="w-full rounded-lg border-0 py-2.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-gray-900 sm:text-sm" value={courierCode} onChange={e => setCourierCode(e.target.value)}>
                    <option value="inpost">{t('newOrder.step3.couriers.inpost', 'InPost')}</option>
                    <option value="dhl">{t('newOrder.step3.couriers.dhl', 'DHL')}</option>
                    <option value="dpd">{t('newOrder.step3.couriers.dpd', 'DPD')}</option>
                    <option value="ups">{t('newOrder.step3.couriers.ups', 'UPS')}</option>
                 </select>
             </div>
             <textarea 
               rows={3}
               placeholder={t('newOrder.step3.notesPlaceholder', 'Notatki do zlecenia magazynowego')}
               className="mt-4 w-full rounded-lg border-0 py-2.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-gray-900 sm:text-sm"
               value={notes}
               onChange={e => setNotes(e.target.value)}
             />
          </section>

          <div className="flex justify-end pt-4">
            <button
               onClick={submitOrder}
               disabled={isSubmitting || cartItems.length === 0}
               className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-8 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              {t('newOrder.submitBtn', 'UTWÓRZ ZLECENIE (Twarda Rezerwacja)')}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
