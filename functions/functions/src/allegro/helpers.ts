import * as crypto from "crypto";
import PQueue from "p-queue";
import { getFirestore } from "firebase-admin/firestore";

// ============================================
// URLS
// ============================================

const ALLEGRO_AUTH_URL = "https://allegro.pl/auth/oauth";
const ALLEGRO_API_URL = "https://api.allegro.pl";
const ALLEGRO_SANDBOX_AUTH_URL = "https://allegro.pl.allegrosandbox.pl/auth/oauth";
const ALLEGRO_SANDBOX_API_URL = "https://api.allegro.pl.allegrosandbox.pl";

export const getAuthUrl = (sandbox: boolean) =>
  sandbox ? ALLEGRO_SANDBOX_AUTH_URL : ALLEGRO_AUTH_URL;

export const getApiUrl = (sandbox: boolean) =>
  sandbox ? ALLEGRO_SANDBOX_API_URL : ALLEGRO_API_URL;

// ============================================
// ENCRYPTION
// ============================================

export const encrypt = (text: string, key: string, customIvHex?: string): { encrypted: string; iv: string } => {
  const iv = customIvHex ? Buffer.from(customIvHex, "hex") : crypto.randomBytes(16);
  const keyBuffer = crypto.createHash("sha256").update(key).digest();
  const cipher = crypto.createCipheriv("aes-256-cbc", keyBuffer, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return { encrypted, iv: iv.toString("hex") };
};

export const decrypt = (encrypted: string, iv: string, key: string): string => {
  const keyBuffer = crypto.createHash("sha256").update(key).digest();
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    keyBuffer,
    Buffer.from(iv, "hex")
  );
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};

// ============================================
// RATE LIMITING QUEUE
// ============================================

// Allegro limit: 9000 req/min = 150 req/s
// Używamy bezpiecznego limitu: 100 req/s
export const allegroQueue = new PQueue({
  concurrency: 10,
  interval: 1000,
  intervalCap: 100,
});

// ============================================
// FETCH WITH RETRY
// ============================================

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const allegroFetch = async (
  url: string,
  accessToken: string,
  options: RequestInit = {},
  retries = 3
): Promise<Response> => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Content-Type tylko dla POST/PUT/PATCH (gdy jest body)
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.allegro.public.v1+json",
        ...options.headers as Record<string, string>,
      };
      
      // Dodaj Content-Type tylko gdy jest body (POST/PUT/PATCH)
      if (options.body) {
        headers["Content-Type"] = "application/vnd.allegro.public.v1+json";
      }

      console.log("=== ALLEGRO FETCH DEBUG ===");
      console.log("URL:", url);
      console.log("Method:", options.method || "GET");
      console.log("Has body:", !!options.body);
      console.log("Headers:", JSON.stringify(headers));
      console.log("===========================");

      const response = await fetch(url, {
        ...options,
        headers,
      });

      // Rate limit - czekaj i ponów
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("Retry-After") || "60", 10);
        console.warn(`Allegro rate limit hit, waiting ${retryAfter}s (attempt ${attempt + 1})`);
        await sleep(retryAfter * 1000);
        continue;
      }

      // Sukces lub błąd inny niż rate limit
      return response;
    } catch (error) {
      console.error(`Allegro fetch error (attempt ${attempt + 1}):`, error);
      if (attempt === retries - 1) throw error;
      
      // Exponential backoff: 1s, 2s, 4s
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }

  throw new Error("Max retries exceeded");
};

// ============================================
// HELPER FUNCTIONS
// ============================================

export const mapAllegroStatusToCrm = (
  allegroStatus: string,
  fulfillmentStatus: string
): "new" | "processing" | "shipped" | "delivered" | "cancelled" => {
  if (allegroStatus === "CANCELLED") return "cancelled";
  
  switch (fulfillmentStatus) {
    case "SENT":
    case "PICKED_UP":
      return "shipped";
    case "PROCESSING":
    case "READY_FOR_SHIPMENT":
      return "processing";
    default:
      return "new";
  }
};

export const generateOrderNumber = (prefix: string, counter: number): string => {
  const year = new Date().getFullYear();
  const paddedCounter = String(counter).padStart(5, "0");
  return `ORD/${prefix}/${year}/${paddedCounter}`;
};

export async function getValidAllegroToken(
  companyId: string,
  integrationId: string,
  encryptionKeyVal: string,
  clientId: string,
  clientSecret: string,
  sandbox: boolean = false
): Promise<{ accessToken: string; integration: any }> {
  const db = getFirestore();
  const integrationRef = db
    .collection("companies")
    .doc(companyId)
    .collection("integrations")
    .doc(integrationId);

  const integrationSnap = await integrationRef.get();
  if (!integrationSnap.exists) {
    throw new Error("Integracja nie istnieje");
  }

  const integration = integrationSnap.data()!;
  
  // Sprawdź czy token wygasł (z 5-minutowym buforem)
  const tokenExpiresAt = integration.tokenExpiresAt?.toDate?.() || new Date(0);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 minut
  
  if (tokenExpiresAt.getTime() - bufferMs < now.getTime()) {
    console.log(`Token wygasł dla integracji ${integrationId}, odświeżam...`);
    
    // Używamy dedykowanego IV per odświeżanie, jeśli nie, bierzemy stare
    const refreshToken = decrypt(
      integration.encryptedRefreshToken,
      integration.iv,
      encryptionKeyVal
    );
    
    const authUrl = sandbox 
      ? "https://allegro.pl.allegrosandbox.pl/auth/oauth/token"
      : "https://allegro.pl/auth/oauth/token";

    console.log(`Refreshing token using: ${authUrl}`);

    const tokenResponse = await fetch(authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Błąd odświeżania tokenu:", errorText);
      throw new Error("Nie udało się odświeżyć tokenu Allegro");
    }

    const tokenData = await tokenResponse.json();
    
    const { encrypted: encryptedAccessToken, iv: accessIv } = encrypt(tokenData.access_token, encryptionKeyVal);
    const { encrypted: encryptedRefreshToken } = encrypt(tokenData.refresh_token, encryptionKeyVal, accessIv);
    
    const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
    
    await integrationRef.update({
      encryptedAccessToken,
      encryptedRefreshToken,
      iv: accessIv, // uaktualniamy IV na nowe (będą wspólne)
      tokenExpiresAt: newExpiresAt,
      updatedAt: new Date(),
    });

    console.log(`Token odświeżony, nowy wygasa: ${newExpiresAt.toISOString()}`);
    
    return {
      accessToken: tokenData.access_token,
      integration: { ...integration, tokenExpiresAt: newExpiresAt, encryptedAccessToken, encryptedRefreshToken, iv: accessIv },
    };
  }

  const accessToken = decrypt(integration.encryptedAccessToken, integration.iv, encryptionKeyVal);
  return { accessToken, integration };
}
