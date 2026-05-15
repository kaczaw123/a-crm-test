import React from 'react';

export interface ProductWithStock {
  productId: string;
  name: string;
  sku: string;
  qtyOnHand: number;
}

interface Props {
  totalCount: number;
  productsWithStock: ProductWithStock[];
  onConfirm: () => void;
  onCancel: () => void;
  isArchiving: boolean;
}

export default function ArchiveProductWarningModal({
  totalCount,
  productsWithStock,
  onConfirm,
  onCancel,
  isArchiving,
}: Props) {
  const withStockCount = productsWithStock.length;
  const withoutStockCount = totalCount - withStockCount;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div className="fixed inset-0 transition-opacity bg-gray-900/75 backdrop-blur-sm" onClick={onCancel} />
        <div className="relative inline-block w-full max-w-lg p-6 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-2xl">

          <div className="flex items-start gap-4 mb-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <span className="material-symbols-outlined text-amber-600 text-[20px]">warning</span>
            </div>
            <div>
              <h3 className="text-[16px] font-bold text-gray-900">
                Masz {totalCount} zaznaczonych {totalCount === 1 ? 'produkt' : totalCount < 5 ? 'produkty' : 'produktów'}
              </h3>
              <p className="text-[13px] text-gray-500 mt-1">
                Poniższe {withStockCount} {withStockCount === 1 ? 'produkt ma' : 'produkty mają'} stany magazynowe:
              </p>
            </div>
          </div>

          <ul className="mb-4 space-y-1 max-h-48 overflow-y-auto border border-amber-100 rounded-xl bg-amber-50 px-4 py-3">
            {productsWithStock.map(p => (
              <li key={p.productId} className="flex justify-between items-center text-[13px]">
                <span className="font-medium text-gray-800 truncate mr-2">{p.name}</span>
                <span className="text-[11px] font-bold text-gray-500 whitespace-nowrap font-mono flex-shrink-0">
                  {p.sku} — <span className="text-amber-700">{p.qtyOnHand} szt.</span>
                </span>
              </li>
            ))}
          </ul>

          {withoutStockCount > 0 && (
            <p className="text-[13px] text-gray-500 mb-4">
              Pozostałe <span className="font-bold text-gray-700">{withoutStockCount}</span> {withoutStockCount === 1 ? 'produkt nie ma stanów' : 'produkty nie mają stanów'} i zostanie zarchiwizowane bez ostrzeżenia.
            </p>
          )}

          <p className="text-[13px] text-gray-500 bg-gray-50 rounded-xl px-4 py-3 mb-6">
            Stany magazynowe pozostaną widoczne w zakładce <span className="font-bold">Magazyn</span>. Stany można wydać ręcznie (funkcja dostępna wkrótce,{' '}
            <span className="font-mono text-[11px]">GH #67</span>) lub produkty przywrócić w każdej chwili.
          </p>

          <div className="flex justify-end gap-3">
            <button
              onClick={onCancel}
              disabled={isArchiving}
              className="px-5 py-2.5 text-[13px] font-bold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Anuluj
            </button>
            <button
              onClick={onConfirm}
              disabled={isArchiving}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors disabled:opacity-50"
            >
              {isArchiving && <span className="material-symbols-outlined animate-spin text-[16px]">refresh</span>}
              Zarchiwizuj wszystkie {totalCount}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
