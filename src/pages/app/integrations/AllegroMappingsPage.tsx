import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../../firebase/config";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Check,
  AlertCircle,
  Loader2,
  Package,
  RefreshCw,
  Filter,
} from "lucide-react";
import type { ProductMapping } from "../../../types/allegro";
import AllegroProductMappingModal from "../../../components/integrations/AllegroProductMappingModal";
import { useAuth } from "../../../auth/useAuth";

type FilterStatus = "all" | "mapped" | "unmapped" | "auto_mapped";

export default function AllegroMappingsPage() {
  const { t } = useTranslation();
  const { integrationId } = useParams<{ integrationId: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const activeCompanyId = (profile as any)?.activeCompanyId || (profile as any)?.companyId;

  const [mappings, setMappings] = useState<ProductMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [selectedMapping, setSelectedMapping] = useState<ProductMapping | null>(null);

  const fetchMappings = async () => {
    if (!activeCompanyId) return;
    
    setLoading(true);
    try {
      const getAllegroMappings = httpsCallable(functions, "getAllegroMappings");
      const result = await getAllegroMappings({
        companyId: activeCompanyId,
        integrationId: integrationId,
        status: filterStatus === "all" ? undefined : filterStatus,
        limit: 200,
      });
      const data = result.data as { mappings: ProductMapping[] };
      setMappings(data.mappings);
    } catch (error) {
      console.error("Fetch mappings error:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMappings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompanyId, integrationId, filterStatus]);

  const handleSync = async () => {
    if (!activeCompanyId || !integrationId) return;
    
    setSyncing(true);
    try {
      const fetchAllegroOffers = httpsCallable(functions, "fetchAllegroOffers");
      await fetchAllegroOffers({
        companyId: activeCompanyId,
        integrationId: integrationId,
      });
      await fetchMappings();
    } catch (error) {
      console.error("Sync error:", error);
      alert("Błąd podczas synchronizacji ofert z Allegro");
    } finally {
      setSyncing(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "mapped":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border-emerald-200">
            <Check className="w-3.5 h-3.5" />
            {t("integrations.allegro.statusMapped", "Zmapowany")}
          </span>
        );
      case "auto_mapped":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border-blue-200">
            <Check className="w-3.5 h-3.5" />
            {t("integrations.allegro.statusAutoMapped", "Auto")}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-bold uppercase tracking-wider bg-yellow-50 text-yellow-700 border-yellow-200">
            <AlertCircle className="w-3.5 h-3.5" />
            {t("integrations.allegro.statusUnmapped", "Niezmapowany")}
          </span>
        );
    }
  };

  const stats = {
    total: mappings.length,
    mapped: mappings.filter((m) => m.status === "mapped" || m.status === "auto_mapped").length,
    unmapped: mappings.filter((m) => m.status === "unmapped").length,
  };

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <button
              onClick={() => navigate("/app/settings/integrations")}
              className="p-2 -ml-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <Package className="w-6 h-6 text-orange-500" />
                {t("integrations.allegro.productMappings", "Mapowanie produktów")}
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                {t("integrations.allegro.mappingsDescription", "Połącz oferty Allegro z produktami w magazynie by umożliwić synchronizację stanów i wydań.")}
              </p>
            </div>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg disabled:opacity-50 shadow-sm transition-colors"
          >
            {syncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {t("integrations.allegro.syncOffers", "Pobierz oferty z Allegro")}
          </button>
        </div>
      </div>

      {/* Stats & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow-sm border border-gray-200 text-sm font-medium">
            <span className="text-gray-500">{t("integrations.allegro.total", "Razem")}:</span>
            <span className="text-gray-900 font-bold">{stats.total}</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 rounded-lg shadow-sm border border-emerald-100 text-sm font-medium">
            <span className="text-emerald-700">{t("integrations.allegro.mapped", "Zmapowane")}:</span>
            <span className="text-emerald-800 font-bold">{stats.mapped}</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 rounded-lg shadow-sm border border-amber-100 text-sm font-medium">
            <span className="text-amber-700">{t("integrations.allegro.unmapped", "Brak powiązania")}:</span>
            <span className="text-amber-800 font-bold">{stats.unmapped}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-white rounded-lg p-1.5 shadow-sm border border-gray-200">
          <div className="pl-2 pr-1"><Filter className="w-4 h-4 text-gray-400" /></div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
            className="bg-transparent border-none focus:ring-0 text-sm font-medium text-gray-700 outline-none pr-4 cursor-pointer"
          >
            <option value="all">{t("integrations.allegro.filterAll", "Wszystkie")}</option>
            <option value="mapped">{t("integrations.allegro.filterMapped", "Tylko zmapowane")}</option>
            <option value="unmapped">{t("integrations.allegro.filterUnmapped", "Niezmapowane")}</option>
            <option value="auto_mapped">{t("integrations.allegro.filterAutoMapped", "Auto-zmapowane")}</option>
          </select>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white rounded-xl shadow-sm border border-gray-100">
          <Loader2 className="w-10 h-10 animate-spin text-orange-500 mb-4" />
          <p className="text-gray-500 font-medium">Wczytywanie mapowań z bazy CRM...</p>
        </div>
      ) : mappings.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-xl shadow-sm border border-gray-100">
          <Package className="w-16 h-16 mx-auto text-gray-300 mb-6" />
          <h3 className="text-lg font-bold text-gray-900 mb-2">Brak zaimportowanych ofert</h3>
          <p className="text-gray-500 max-w-sm mx-auto mb-6">{t("integrations.allegro.noMappings", "Nie pobrano jeszcze żadnych ofert Allegro do mapowania. Zainicjuj synchronizację.")}</p>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-6 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-bold shadow-sm inline-flex items-center gap-2"
          >
             {syncing ? <Loader2 className="w-4 h-4 animate-spin"/> : <RefreshCw className="w-4 h-4"/>}
            {t("integrations.allegro.fetchProducts", "Pobierz oferty do mapowania")}
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                    {t("integrations.allegro.allegroOffer", "Oferta na Allegro")}
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Referencja (SKU / EAN)
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">
                    {t("integrations.allegro.crmProduct", "Produkt w CRM (A-CMR)")}
                  </th>
                  <th className="px-4 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    {t("integrations.allegro.status", "Status")}
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">
                    {t("common.actions", "Akcje")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {mappings.map((mapping) => (
                  <tr key={mapping.id} className="hover:bg-orange-50/20 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-start gap-4">
                        {mapping.externalImageUrl ? (
                          <div className="w-12 h-12 rounded bg-gray-100 border border-gray-200 overflow-hidden shrink-0 shadow-sm">
                              <img
                                src={mapping.externalImageUrl}
                                alt=""
                                className="w-full h-full object-cover"
                              />
                          </div>
                        ) : (
                          <div className="w-12 h-12 bg-gray-50 border border-gray-200 rounded flex items-center justify-center shrink-0 shadow-sm">
                            <Package className="w-5 h-5 text-gray-300" />
                          </div>
                        )}
                        <div className="min-w-0 pr-4">
                          <p className="font-bold text-gray-900 text-sm leading-tight mb-1 truncate" title={mapping.externalOfferName}>
                            {mapping.externalOfferName}
                          </p>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-orange-100 text-orange-800 text-[11px] font-bold">
                             {mapping.externalPrice.toFixed(2)} PLN
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top pt-5">
                       <div className="space-y-1">
                          {mapping.externalSku ? (
                             <div className="flex items-center gap-1.5 text-sm font-medium text-gray-800"><span className="text-[10px] text-gray-400 border border-gray-200 rounded px-1">SKU</span> {mapping.externalSku}</div>
                          ) : <span className="text-sm text-gray-400 italic">Brak SKU</span>}
                          
                          {mapping.externalEan && (
                             <div className="flex items-center gap-1.5 text-xs text-gray-500"><span className="text-[10px] text-gray-400 border border-gray-200 rounded px-1">EAN</span> {mapping.externalEan}</div>
                          )}
                       </div>
                    </td>
                    <td className="px-4 py-4 align-top pt-5">
                      {mapping.crmProductId ? (
                        <div className="bg-emerald-50/50 p-2 rounded-lg border border-emerald-100/50 shadow-sm">
                          <p className="text-sm font-bold text-gray-900 mb-0.5 font-mono">{mapping.crmProductSku}</p>
                          <p className="text-xs text-gray-600 truncate max-w-[200px]" title={mapping.crmProductName || ''}>
                            {mapping.crmProductName}
                          </p>
                        </div>
                      ) : (
                        <div className="text-sm font-medium text-gray-400 italic bg-gray-50 p-2 rounded-lg border border-gray-100 inline-block">Brak powiązanego produktu</div>
                      )}
                    </td>
                    <td className="px-4 py-4 align-top pt-6">{getStatusBadge(mapping.status)}</td>
                    <td className="px-6 py-4 align-top pt-6 text-right">
                      <button
                        onClick={() => setSelectedMapping(mapping)}
                        className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-lg transition-colors border shadow-sm ${
                           mapping.crmProductId 
                             ? 'text-gray-700 bg-white border-gray-300 hover:bg-gray-50' 
                             : 'text-orange-700 bg-orange-50 border-orange-200 hover:bg-orange-100'
                        }`}
                      >
                        {mapping.crmProductId
                          ? t("integrations.allegro.changeMapping", "Zmień")
                          : t("integrations.allegro.mapNow", "Połącz")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mapping Modal */}
      {selectedMapping && activeCompanyId && (
        <AllegroProductMappingModal
          isOpen={!!selectedMapping}
          onClose={() => setSelectedMapping(null)}
          mapping={selectedMapping}
          companyId={activeCompanyId}
          onMappingUpdated={fetchMappings}
        />
      )}
    </div>
  );
}
