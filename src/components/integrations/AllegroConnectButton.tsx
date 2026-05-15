import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../firebase/config";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

interface AllegroConnectButtonProps {
  companyId: string;
  sandbox?: boolean;
}

export default function AllegroConnectButton({
  companyId,
  sandbox = false,
}: AllegroConnectButtonProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const getAllegroAuthUrl = httpsCallable(functions, "getAllegroAuthUrl");
      const result = await getAllegroAuthUrl({
        companyId,
        redirectUri: `${window.location.origin}/app/integrations/allegro/callback`,
        sandbox,
      });

      const data = result.data as { authUrl: string };
      window.location.href = data.authUrl;
    } catch (error) {
      console.error("Get auth URL error:", error);
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleConnect}
      disabled={loading}
      className="flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
    >
      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin" />
      ) : (
        <span className="text-xl">🟠</span>
      )}
      {t("integrations.allegro.connect")}
    </button>
  );
}
