import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { doc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../firebase/config";
import { useTranslation } from "react-i18next";
import { Package, Tag, Settings, Unplug, Loader2, CheckCircle, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { pl } from "date-fns/locale";

interface AllegroIntegrationCardProps {
  integration: {
    id: string;
    allegroUserLogin: string;
    status: "active" | "inactive" | "error";
    lastSyncAt: Date | null;
    lastError: string | null;
    settings: {
      sandboxMode: boolean;
      syncStockToAllegro?: boolean;
    };
    stats?: {
      totalOrdersImported: number;
      totalProductsMapped: number;
      totalTrackingSent: number;
    };
  };
  companyId: string;
  onDisconnect: () => void;
}

type DateRange = "today" | "7days" | "30days";

export default function AllegroIntegrationCard({
  integration,
  companyId,
  onDisconnect,
}: AllegroIntegrationCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loadingImport, setLoadingImport] = useState<DateRange | null>(null);
  const [loadingStock, setLoadingStock] = useState(false);
  const [loadingWebhook, setLoadingWebhook] = useState(false);
  const [syncResult, setSyncResult] = useState<{type: "success" | "warning" | "error", message: string} | string | null>(null);
  const [webhookStatus, setWebhookStatus] = useState<{
    subscriptionId: string | null;
    webhookUrl: string | null;
    status: string;
    recentLogs: any[];
  } | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  useEffect(() => {
    fetchWebhookStatus();
  }, []);

  const fetchWebhookStatus = async () => {
    try {
      const getStatus = httpsCallable(functions, "getAllegroWebhookStatus");
      const result = await getStatus({
        companyId,
        integrationId: integration.id,
      });
      setWebhookStatus(result.data as any);
    } catch (error) {
      console.error("Failed to get webhook status:", error);
    }
  };

  const handleToggleWebhook = async () => {
    setLoadingWebhook(true);
    try {
      if (webhookStatus?.status === "active") {
        const unregister = httpsCallable(functions, "unregisterAllegroWebhook");
        await unregister({ companyId, integrationId: integration.id });
        setSyncResult({ type: "success", message: t("integrations.allegro.webhookDisabled") as string });
      } else {
        const register = httpsCallable(functions, "registerAllegroWebhook");
        await register({ companyId, integrationId: integration.id });
        setSyncResult({ type: "success", message: t("integrations.allegro.webhookEnabled") as string });
      }
      await fetchWebhookStatus();
    } catch (error) {
      console.error("Webhook toggle error:", error);
      setSyncResult({ type: "error", message: t("integrations.allegro.webhookError") as string });
    } finally {
      setLoadingWebhook(false);
    }
  };

  const handleUpdateSettings = async (newSettings: Partial<NonNullable<AllegroIntegrationCardProps["integration"]["settings"]>>) => {
    try {
      const integrationRef = doc(db, "companies", companyId, "integrations", integration.id);
      await updateDoc(integrationRef, {
        settings: { ...integration.settings, ...newSettings }
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleDisconnect = async () => {
    const confirmed = window.confirm(
      'Czy na pewno chcesz rozłączyć integrację z Allegro? Ta operacja jest nieodwracalna.'
    );
    
    if (!confirmed) return;
    
    setIsDisconnecting(true);
    
    try {
      const disconnectAllegro = httpsCallable(functions, 'disconnectAllegro');
      await disconnectAllegro({ 
        companyId,
        integrationId: integration.id 
      });
      
      onDisconnect(); 
    } catch (error: any) {
      console.error('Disconnect error:', error);
      alert(error.message || 'Nie udało się rozłączyć integracji');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleSyncStock = async () => {
    setLoadingStock(true);
    setSyncResult(null);

    try {
      const syncAllStockToAllegro = httpsCallable(functions, "syncAllStockToAllegro");
      const result = await syncAllStockToAllegro({
        companyId,
        integrationId: integration.id,
      });

      const data = result.data as { synced: number; failed: number };
      setSyncResult({
        type: data.failed === 0 ? "success" : "warning",
        message: t("integrations.allegro.stockSynced", {
          synced: data.synced,
          failed: data.failed,
        }),
      });
    } catch (error) {
      console.error("Sync stock error:", error);
      setSyncResult({
        type: "error",
        message: t("integrations.allegro.stockSyncFailed", "Nie udało się zsynchronizować stanów"),
      });
    } finally {
      setLoadingStock(false);
    }
  };

  const handleImport = async (range: DateRange) => {
    setLoadingImport(range);
    setSyncResult(null);

    const daysBack = range === "today" ? 1 : range === "7days" ? 7 : 30;

    try {
      const importFn = httpsCallable(functions, "importAllegroData");
      const result = await importFn({
        companyId,
        integrationId: integration.id,
        days: daysBack,
      });

      const data = result.data as { message: string };
      setSyncResult({ type: "success", message: data.message });
    } catch (error) {
      console.error("Import error:", error);
      setSyncResult({ type: "error", message: t("integrations.allegro.ordersFailed", "Błąd importu") });
    } finally {
      setLoadingImport(null);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
            <span className="text-xl font-bold text-orange-600">A</span>
          </div>
          <div>
            <h3 className="font-semibold text-lg">Allegro</h3>
            <p className="text-sm text-gray-500">{integration.allegroUserLogin}</p>
          </div>
        </div>
        <span
          className={`px-2 py-1 rounded-full text-xs font-medium ${
            integration.status === "active"
              ? "bg-green-100 text-green-700"
              : integration.status === "error"
              ? "bg-red-100 text-red-700"
              : "bg-gray-100 text-gray-700"
          }`}
        >
          {integration.status === "active" && "✓ Aktywna"}
          {integration.status === "error" && "⚠ Błąd"}
          {integration.status === "inactive" && "Nieaktywna"}
        </span>
      </div>

      {/* Sandbox badge */}
      {integration.settings.sandboxMode && (
        <div className="mb-4 px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded inline-block">
          🧪 Tryb Sandbox
        </div>
      )}

      {/* Last sync */}
      {integration.lastSyncAt && (
        <p className="text-sm text-gray-500 mb-4">
          {t("integrations.allegro.lastSync")}:{" "}
          {(() => {
             try {
                let d: any = integration.lastSyncAt;
                if (d?.toDate) d = d.toDate();
                else if (d?.seconds !== undefined && typeof d.seconds === 'number') d = new Date(d.seconds * 1000);
                else d = new Date(d as string);
                
                if (isNaN(d.getTime())) return '-';
                return formatDistanceToNow(d, { addSuffix: true, locale: pl });
             } catch(e) {
                return '-';
             }
          })()}
        </p>
      )}

      {/* Error message */}
      {integration.lastError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {integration.lastError}
        </div>
      )}

      {/* Sync result message */}
      {syncResult && (
        <div className={`mb-4 p-3 rounded-md text-sm flex items-center gap-2 ${
           typeof syncResult === 'string' || syncResult.type === 'success' ? 'bg-blue-50 border border-blue-200 text-blue-700' :
           syncResult.type === 'warning' ? 'bg-yellow-50 border border-yellow-200 text-yellow-700' :
           'bg-red-50 border border-red-200 text-red-700'
        }`}>
          <CheckCircle className="w-4 h-4" />
          {typeof syncResult === 'string' ? syncResult : syncResult.message}
        </div>
      )}

      {/* Fetch Orders Section */}
      <div className="mb-4 p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-2 mb-3">
          <Package className="w-5 h-5 text-gray-600" />
          <span className="font-medium">{t("integrations.allegro.fetchOrders")}</span>
        </div>
        <div className="flex gap-2">
          {(["today", "7days", "30days"] as DateRange[]).map((range) => (
            <button
              key={range}
              onClick={() => handleImport(range)}
              disabled={loadingImport !== null}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                loadingImport === range
                  ? "bg-orange-500 text-white"
                  : "bg-white border border-gray-300 hover:border-orange-500 hover:text-orange-600"
              }`}
            >
              {loadingImport === range ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                t(`integrations.allegro.range.${range}`)
              )}
            </button>
          ))}
        </div>
      </div>



      {/* Sync Stock Section */}
      <div className="mb-4 p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-medium text-gray-800">{t("integrations.allegro.syncStock", "Zarządzaj stanami")}</p>
            <p className="text-xs text-gray-500">
              {t("integrations.allegro.syncStockDesc", "Automatycznie aktualizuj stany w Allegro gdy zmieni się magazyn")}
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={integration.settings?.syncStockToAllegro || false}
              onChange={(e) => handleUpdateSettings({ syncStockToAllegro: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-10 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-orange-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500"></div>
          </label>
        </div>
        
        <div className="flex items-center justify-between border-t border-gray-200 pt-3">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-gray-600" />
            <span className="font-medium">{t("integrations.allegro.syncStockNow", "Synchronizuj stany teraz")}</span>
          </div>
          <button
            onClick={handleSyncStock}
            disabled={loadingStock || !integration.settings?.syncStockToAllegro}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-md text-sm font-bold transition-colors disabled:opacity-50"
          >
            {loadingStock ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              t("integrations.allegro.syncAll", "Uruchom")
            )}
          </button>
        </div>
        {!integration.settings?.syncStockToAllegro && (
          <p className="mt-2 text-xs text-gray-400">
            {t("integrations.allegro.enableSyncFirst", "Najpierw włącz automatyczną synchronizację.")}
          </p>
        )}
      </div>

      {/* Webhook Section */}
      <div className="mb-4 p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-gray-600" />
            <div>
              <span className="font-medium text-gray-800">{t("integrations.allegro.realtimeOrders", "Zamówienia w czasie rzeczywistym")}</span>
              <p className="text-xs text-gray-500">{t("integrations.allegro.realtimeDesc", "Otrzymuj nowe zamówienia natychmiast przez webhooks")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {webhookStatus?.status === "active" && (
              <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                ✓ {t("integrations.allegro.active", "Aktywny")}
              </span>
            )}
            <button
              onClick={handleToggleWebhook}
              disabled={loadingWebhook}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                webhookStatus?.status === "active"
                  ? "bg-red-100 text-red-700 hover:bg-red-200"
                  : "bg-green-500 text-white hover:bg-green-600"
              } disabled:opacity-50`}
            >
              {loadingWebhook ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : webhookStatus?.status === "active" ? (
                t("integrations.allegro.disable", "Wyłącz")
              ) : (
                t("integrations.allegro.enable", "Włącz")
              )}
            </button>
          </div>
        </div>

        {/* Recent webhook logs */}
        {webhookStatus?.recentLogs && webhookStatus.recentLogs.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-200">
            <p className="text-xs text-gray-500 mb-2">{t("integrations.allegro.recentEvents", "Ostatnie zdarzenia")}:</p>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {webhookStatus.recentLogs.slice(0, 5).map((log: any) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="font-mono">{log.eventType}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded ${
                      log.status === "processed"
                        ? "bg-green-100 text-green-700"
                        : log.status === "failed"
                        ? "bg-red-100 text-red-700"
                        : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {log.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Statistics */}
      {integration.stats && (
        <div className="mb-4 pt-4 border-t border-gray-200">
          <p className="text-sm text-gray-500 mb-2">{t("integrations.allegro.statistics")}:</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-gray-50 rounded">
              <p className="text-lg font-semibold">{integration.stats.totalOrdersImported}</p>
              <p className="text-xs text-gray-500">{t("integrations.allegro.orders")}</p>
            </div>
            <div className="p-2 bg-gray-50 rounded">
              <p className="text-lg font-semibold">{integration.stats.totalProductsMapped}</p>
              <p className="text-xs text-gray-500">{t("integrations.allegro.products")}</p>
            </div>
            <div className="p-2 bg-gray-50 rounded">
              <p className="text-lg font-semibold">{integration.stats.totalTrackingSent}</p>
              <p className="text-xs text-gray-500">{t("integrations.allegro.tracking")}</p>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between mt-4 pt-4 border-t border-gray-100">
        <button className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800">
          <Settings className="w-4 h-4" />
          {t("integrations.allegro.settings")}
        </button>
        <button
          onClick={handleDisconnect}
          disabled={isDisconnecting}
          className="text-sm text-red-500 hover:text-red-700 flex items-center gap-1 disabled:opacity-50"
        >
          {isDisconnecting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Rozłączanie...
            </>
          ) : (
            <>
              <Unplug className="w-4 h-4" />
              Rozłącz
            </>
          )}
        </button>
      </div>
      <div className="flex justify-center pt-4 mt-2 border-t border-gray-100">
        <button
          onClick={() => navigate(`/app/settings/integrations/allegro/${integration.id}/mappings`)}
          className="flex items-center gap-2 text-sm font-bold text-orange-600 hover:text-orange-700 bg-orange-50 px-4 py-2 rounded-lg transition-colors border border-orange-100 w-full justify-center"
        >
          <Package className="w-4 h-4" />
          {t("integrations.allegro.manageMapping", "Zarządzaj mapowaniem produktów")}
        </button>
      </div>
    </div>
  );
}
