import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { encrypt, decrypt, getAuthUrl, getApiUrl } from "./helpers";
import { AllegroTokenResponse, AllegroUserResponse } from "./types";

const allegroClientId = defineSecret("ALLEGRO_CLIENT_ID");
const allegroClientSecret = defineSecret("ALLEGRO_CLIENT_SECRET");
const encryptionKey = defineSecret("MASTER_ENCRYPTION_KEY");

// 1. Generuj URL do autoryzacji
export const getAllegroAuthUrl = onCall(
  { secrets: [allegroClientId], cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Musisz być zalogowany");
    }

    const { companyId, redirectUri, sandbox = false } = request.data;

    if (!companyId || !redirectUri) {
      throw new HttpsError("invalid-argument", "Brak companyId lub redirectUri");
    }

    const state = Buffer.from(
      JSON.stringify({
        companyId,
        sandbox,
        userId: request.auth.uid,
        timestamp: Date.now(),
      })
    ).toString("base64");

    const scope = "allegro:api:profile:read allegro:api:sale:offers:read allegro:api:orders:read allegro:api:orders:write allegro:api:shipments:read allegro:api:shipments:write";

    const authBaseUrl = getAuthUrl(sandbox);
    const authUrl = `${authBaseUrl}/authorize?` +
      `response_type=code&` +
      `client_id=${encodeURIComponent(allegroClientId.value())}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=${encodeURIComponent(scope)}&` +
      `state=${encodeURIComponent(state)}`;

    console.log("Allegro auth URL:", authUrl);
    console.log("Scope:", scope);

    return { authUrl };
  }
);

// 2. Wymień code na tokeny
export const exchangeAllegroCode = onCall(
  { secrets: [allegroClientId, allegroClientSecret, encryptionKey], cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Musisz być zalogowany");
    }

    const { code, state, redirectUri } = request.data;

    if (!code || !state || !redirectUri) {
      throw new HttpsError("invalid-argument", "Brak code, state lub redirectUri");
    }

    // Dekoduj state
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, "base64").toString());
    } catch {
      throw new HttpsError("invalid-argument", "Nieprawidłowy state");
    }

    const { companyId, sandbox } = stateData;
    const authBaseUrl = getAuthUrl(sandbox);

    // Wymień code na tokeny
    const tokenResponse = await fetch(`${authBaseUrl}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${allegroClientId.value()}:${allegroClientSecret.value()}`
        ).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error("Token exchange failed:", error);
      throw new HttpsError("internal", "Nie udało się uzyskać tokenów z Allegro");
    }

    const tokens: AllegroTokenResponse = await tokenResponse.json();

    // Pobierz dane użytkownika
    const apiUrl = getApiUrl(sandbox);
    const userResponse = await fetch(`${apiUrl}/me`, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: "application/vnd.allegro.public.v1+json",
      },
    });

    if (!userResponse.ok) {
      throw new HttpsError("internal", "Nie udało się pobrać danych użytkownika Allegro");
    }

    const userData: AllegroUserResponse = await userResponse.json();

    // Zaszyfruj tokeny
    const encKey = encryptionKey.value();
    const accessTokenEnc = encrypt(tokens.access_token, encKey);
    const refreshTokenEnc = encrypt(tokens.refresh_token, encKey, accessTokenEnc.iv);

    // Zapisz integrację
    const db = getFirestore();
    const integrationRef = db
      .collection("companies")
      .doc(companyId)
      .collection("integrations")
      .doc();

    await integrationRef.set({
      type: "allegro",
      status: "active",
      customName: `Allegro - ${userData.login}`,

      encryptedAccessToken: accessTokenEnc.encrypted,
      encryptedRefreshToken: refreshTokenEnc.encrypted,
      iv: accessTokenEnc.iv,
      keyVersion: 1,

      allegroUserId: userData.id,
      allegroUserLogin: userData.login,

      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),

      settings: {
        syncOrders: true,
        syncOffers: false,
        autoSendTracking: true,
        sandboxMode: sandbox,
      },

      stats: {
        totalOrdersImported: 0,
        totalProductsMapped: 0,
        totalTrackingSent: 0,
      },

      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastSyncAt: null,
      lastError: null,
    });

    return {
      success: true,
      integrationId: integrationRef.id,
      userLogin: userData.login,
    };
  }
);

// 3. Auto-refresh tokenów (co 11 godzin)
export const refreshAllegroTokens = onSchedule(
  {
    schedule: "every 11 hours",
    secrets: [allegroClientId, allegroClientSecret, encryptionKey],
  },
  async () => {
    const db = getFirestore();

    // Pobierz wszystkie aktywne integracje Allegro
    const integrationsSnap = await db
      .collectionGroup("integrations")
      .where("type", "==", "allegro")
      .where("status", "==", "active")
      .get();

    console.log(`Found ${integrationsSnap.size} active Allegro integrations to refresh`);

    for (const doc of integrationsSnap.docs) {
      try {
        const data = doc.data();
        const sandbox = data.settings?.sandboxMode || false;
        const authBaseUrl = getAuthUrl(sandbox);

        // Odszyfruj refresh token
        const refreshToken = decrypt(
          data.encryptedRefreshToken,
          data.iv,
          encryptionKey.value()
        );

        // Odśwież token
        const tokenResponse = await fetch(`${authBaseUrl}/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(
              `${allegroClientId.value()}:${allegroClientSecret.value()}`
            ).toString("base64")}`,
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refreshToken,
          }),
        });

        if (!tokenResponse.ok) {
          throw new Error(`Token refresh failed: ${await tokenResponse.text()}`);
        }

        const tokens: AllegroTokenResponse = await tokenResponse.json();

        // Zaszyfruj nowe tokeny
        const encKey = encryptionKey.value();
        const accessTokenEnc = encrypt(tokens.access_token, encKey);
        const refreshTokenEnc = encrypt(tokens.refresh_token, encKey, accessTokenEnc.iv);

        // Zapisz
        await doc.ref.update({
          encryptedAccessToken: accessTokenEnc.encrypted,
          encryptedRefreshToken: refreshTokenEnc.encrypted,
          iv: accessTokenEnc.iv,
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          updatedAt: FieldValue.serverTimestamp(),
          lastError: null,
        });

        console.log(`Refreshed token for integration ${doc.id}`);
      } catch (error) {
        console.error(`Failed to refresh token for ${doc.id}:`, error);
        await doc.ref.update({
          status: "error",
          lastError: `Token refresh failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  }
);

// 4. Rozłącz integrację (usuń)
export const disconnectAllegro = onCall(
  { secrets: [encryptionKey], cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Musisz być zalogowany");
    }

    const { companyId, integrationId } = request.data;

    if (!companyId || !integrationId) {
      throw new HttpsError("invalid-argument", "Brak companyId lub integrationId");
    }

    const db = getFirestore();
    await db
      .collection("companies")
      .doc(companyId)
      .collection("integrations")
      .doc(integrationId)
      .delete();

    return { success: true };
  }
);
