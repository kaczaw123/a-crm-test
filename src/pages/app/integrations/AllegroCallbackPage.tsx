import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../../firebase/config";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function AllegroCallbackPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
      setStatus("error");
      setMessage(t("integrations.allegro.authCancelled"));
      return;
    }

    if (code && state) {
      handleExchangeCode(code, state);
    } else {
      setStatus("error");
      setMessage(t("integrations.allegro.invalidCallback"));
    }
  }, [searchParams]);

  const handleExchangeCode = async (code: string, state: string) => {
    try {
      const exchangeAllegroCode = httpsCallable(functions, "exchangeAllegroCode");
      const result = await exchangeAllegroCode({
        code,
        state,
        redirectUri: `${window.location.origin}/app/integrations/allegro/callback`,
      });

      const data = result.data as { success: boolean; userLogin: string };
      
      setStatus("success");
      setMessage(t("integrations.allegro.connected", { login: data.userLogin }));

      setTimeout(() => {
        navigate("/app/integrations");
      }, 2000);
    } catch (error) {
      console.error("Exchange code error:", error);
      setStatus("error");
      setMessage(t("integrations.allegro.connectionFailed"));
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center p-8 bg-white rounded-lg shadow-md max-w-md">
        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 animate-spin mx-auto text-orange-500" />
            <p className="mt-4 text-gray-600">{t("integrations.allegro.connecting")}</p>
          </>
        )}
        {status === "success" && (
          <>
            <CheckCircle className="w-12 h-12 mx-auto text-green-500" />
            <p className="mt-4 text-green-600 font-medium">{message}</p>
            <p className="mt-2 text-gray-500 text-sm">
              {t("integrations.allegro.redirecting")}
            </p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 mx-auto text-red-500" />
            <p className="mt-4 text-red-600 font-medium">{message}</p>
            <button
              onClick={() => navigate("/app/integrations")}
              className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              {t("common.back")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
