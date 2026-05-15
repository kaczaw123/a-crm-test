export interface ProductMapping {
  id: string;
  source: "ALLEGRO";
  
  externalOfferId: string;
  externalOfferName: string;
  externalSku: string | null;
  externalEan: string | null;
  externalImageUrl: string | null;
  externalPrice: number;
  externalStock: number;
  
  crmProductId: string | null;
  crmProductSku: string | null;
  crmProductName: string | null;
  
  status: "mapped" | "unmapped" | "auto_mapped";
  mappedAt: Date | null;
  mappedBy: string | null;
  
  syncStockToAllegro: boolean;
  lastStockSyncAt: Date | null;
  
  companyId: string;
  integrationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CrmProduct {
  id: string;
  sku: string;
  name: string;
  ean?: string;
  imageUrl?: string;
}

export interface AllegroIntegration {
  id: string;
  type: "allegro";
  status: "active" | "inactive" | "error";
  customName: string;
  
  encryptedAccessToken?: string;
  encryptedRefreshToken?: string;
  iv?: string;
  
  allegroUserId: string;
  allegroUserLogin: string;
  
  settings: {
    syncOrders: boolean;
    syncOffers: boolean;
    autoSendTracking: boolean;
    sandboxMode: boolean;
    syncStockToAllegro?: boolean;
  };
  
  stats?: {
    totalOrdersImported: number;
    totalProductsMapped: number;
    totalTrackingSent: number;
  };
  
  tokenExpiresAt?: Date;
  lastSyncAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}