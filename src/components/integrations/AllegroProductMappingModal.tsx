import { useState, useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase/config";
import { useTranslation } from "react-i18next";
import { X, Search, Check, Loader2, Package, Unlink } from "lucide-react";
import type { ProductMapping, CrmProduct } from "../../types/allegro";

interface AllegroProductMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  mapping: ProductMapping;
  companyId: string;
  onMappingUpdated: () => void;
}

export default function AllegroProductMappingModal({
  isOpen,
  onClose,
  mapping,
  companyId,
  onMappingUpdated,
}: AllegroProductMappingModalProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CrmProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<CrmProduct | null>(null);

  useEffect(() => {
    if (mapping.crmProductId) {
      setSelectedProduct({
        id: mapping.crmProductId,
        sku: mapping.crmProductSku || "",
        name: mapping.crmProductName || "",
      });
    } else {
      setSelectedProduct(null);
    }
  }, [mapping]);

  useEffect(() => {
    const delaySearch = setTimeout(async () => {
      if (searchQuery.length >= 2) {
        setSearching(true);
        try {
          const searchCrmProducts = httpsCallable(functions, "searchCrmProducts");
          const result = await searchCrmProducts({
            companyId,
            query: searchQuery,
            limit: 20,
          });
          const data = result.data as { products: CrmProduct[] };
          setSearchResults(data.products);
        } catch (error) {
          console.error("Search error:", error);
        } finally {
          setSearching(false);
        }
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(delaySearch);
  }, [searchQuery, companyId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updateAllegroMapping = httpsCallable(functions, "updateAllegroMapping");
      await updateAllegroMapping({
        companyId,
        mappingId: mapping.id,
        crmProductId: selectedProduct?.id || null,
      });
      onMappingUpdated();
      onClose();
    } catch (error) {
      console.error("Save mapping error:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleUnlink = async () => {
    setSaving(true);
    try {
      const updateAllegroMapping = httpsCallable(functions, "updateAllegroMapping");
      await updateAllegroMapping({
        companyId,
        mappingId: mapping.id,
        crmProductId: null,
      });
      setSelectedProduct(null);
      onMappingUpdated();
      onClose();
    } catch (error) {
      console.error("Unlink error:", error);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b shrink-0 bg-white">
          <h2 className="text-lg font-semibold">
            {t("integrations.allegro.mapProduct", "Mapuj produkt")}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-gray-50/50">
          {/* Allegro Product Info */}
          <div className="p-4 bg-orange-50 border-b border-orange-100">
            <div className="flex items-center gap-4">
              {mapping.externalImageUrl ? (
                <img
                  src={mapping.externalImageUrl}
                  alt={mapping.externalOfferName}
                  className="w-16 h-16 object-cover rounded shadow-sm border border-orange-200"
                />
              ) : (
                <div className="w-16 h-16 bg-white rounded shadow-sm border border-orange-200 flex items-center justify-center">
                  <Package className="w-8 h-8 text-orange-200" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate text-gray-900">{mapping.externalOfferName}</p>
                <div className="text-sm text-gray-600 mt-1 flex flex-wrap gap-x-2 gap-y-1">
                  {mapping.externalSku && <span className="inline-flex items-center px-2 py-0.5 rounded bg-white border border-gray-200 text-xs font-mono shadow-sm">SKU: {mapping.externalSku}</span>}
                  {mapping.externalEan && <span className="inline-flex items-center px-2 py-0.5 rounded bg-white border border-gray-200 text-xs font-mono shadow-sm">EAN: {mapping.externalEan}</span>}
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-orange-100 border border-orange-200 text-orange-800 text-xs font-bold shadow-sm">{mapping.externalPrice.toFixed(2)} PLN</span>
                </div>
              </div>
            </div>
          </div>

          {/* Current Mapping */}
          {selectedProduct && (
            <div className="p-4 bg-emerald-50 border-b border-emerald-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white p-1 rounded-full shadow-sm"><Check className="w-4 h-4 text-emerald-600" /></div>
                  <div>
                    <p className="font-medium text-emerald-800 text-xs uppercase tracking-wider mb-0.5">
                      {t("integrations.allegro.mappedTo", "Zmapowano do")}:
                    </p>
                    <p className="text-sm font-semibold text-emerald-900 flex items-center gap-2">
                       <span className="font-mono bg-white px-1.5 py-0.5 rounded text-xs border border-emerald-200">{selectedProduct.sku}</span>
                       <span className="truncate">{selectedProduct.name}</span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleUnlink}
                  disabled={saving}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 hover:bg-red-50 hover:text-red-700 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  {t("integrations.allegro.unlink", "Rozłącz")}
                </button>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="p-4">
            <div className="relative shadow-sm rounded-lg">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("integrations.allegro.searchProducts", "Szukaj produktu...")}
                className="w-full pl-10 pr-10 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none text-sm transition-shadow"
              />
              {searching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                   <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />
                </div>
              )}
            </div>
          </div>

          {/* Search Results */}
          <div className="px-4 pb-4">
            {searchResults.length > 0 ? (
              <div className="grid grid-cols-1 gap-2">
                {searchResults.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => setSelectedProduct(product)}
                    className={`w-full p-3 rounded-lg border text-left transition-all ${
                      selectedProduct?.id === product.id
                        ? "border-orange-500 bg-orange-50 ring-1 ring-orange-500 shadow-sm"
                        : "border-gray-200 bg-white hover:border-orange-300 hover:shadow-md"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                       <div className="min-w-0">
                          <p className="font-bold text-gray-900 text-sm mb-0.5">{product.sku}</p>
                          <p className="text-sm text-gray-500 truncate">{product.name}</p>
                          {product.ean && (
                            <p className="text-xs text-gray-400 mt-1 font-mono">EAN: {product.ean}</p>
                          )}
                       </div>
                       {selectedProduct?.id === product.id && (
                          <Check className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                       )}
                    </div>
                  </button>
                ))}
              </div>
            ) : searchQuery.length >= 2 && !searching ? (
              <div className="text-center bg-white border border-dashed border-gray-300 rounded-lg py-8">
                <Search className="w-8 h-8 text-gray-300 mx-auto mb-2"/>
                <p className="text-gray-500 text-sm">{t("integrations.allegro.noProductsFound", "Nic nie znaleziono")}</p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t bg-white shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg border border-gray-300 shadow-sm transition-colors"
          >
            {t("common.cancel", "Anuluj")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !selectedProduct}
            className="px-6 py-2 text-sm font-bold bg-orange-500 hover:bg-orange-600 text-white rounded-lg disabled:opacity-50 flex items-center gap-2 shadow-sm transition-colors"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {t("common.save", "Zapisz mapowanie")}
          </button>
        </div>
      </div>
    </div>
  );
}
