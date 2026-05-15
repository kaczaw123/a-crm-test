import { Timestamp } from "firebase-admin/firestore";

export interface AllegroTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  allegro_api: boolean;
  jti: string;
}

export interface AllegroUserResponse {
  id: string;
  login: string;
  firstName?: string;
  lastName?: string;
  company?: {
    name: string;
    taxId: string;
  };
  baseMarketplace: {
    id: string;
  };
}

export interface AllegroIntegration {
  type: "allegro";
  status: "active" | "inactive" | "error";
  customName: string;
  
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  iv: string;
  keyVersion: number;
  
  allegroUserId: string;
  allegroUserLogin: string;
  
  tokenExpiresAt: Timestamp;
  
  settings: {
    syncOrders: boolean;
    syncOffers: boolean;
    autoSendTracking: boolean;
    sandboxMode: boolean;
  };
  
  stats: {
    totalOrdersImported: number;
    totalProductsMapped: number;
    totalTrackingSent: number;
  };
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastSyncAt: Timestamp | null;
  lastError: string | null;
}

// ============================================
// ZAMÓWIENIA ALLEGRO
// ============================================

export interface AllegroCheckoutForm {
  id: string;
  messageToSeller: string | null;
  buyer: {
    id: string;
    email: string;
    login: string;
    firstName: string;
    lastName: string;
    companyName?: string;
    guest: boolean;
    personalIdentity?: string;
    phoneNumber?: string;
    preferences?: {
      language: string;
    };
    address?: {
      street: string;
      city: string;
      postCode: string;
      countryCode: string;
    };
  };
  payment: {
    id: string;
    type: string;
    provider: string | null;
    finishedAt: string | null;
    paidAmount: {
      amount: string;
      currency: string;
    };
    reconciliation: {
      amount: string;
      currency: string;
    } | null;
  };
  status: "BOUGHT" | "FILLED_IN" | "READY_FOR_PROCESSING" | "CANCELLED";
  fulfillment: {
    status: "NEW" | "PROCESSING" | "READY_FOR_SHIPMENT" | "SENT" | "PICKED_UP" | "CANCELLED";
    shipmentSummary: {
      lineItemsSent: "NONE" | "SOME" | "ALL";
    };
  };
  delivery: {
    address: {
      firstName: string;
      lastName: string;
      street: string;
      city: string;
      zipCode: string;
      countryCode: string;
      companyName?: string;
      phoneNumber?: string;
    };
    method: {
      id: string;
      name: string;
    };
    cost: {
      amount: string;
      currency: string;
    } | null;
    time: {
      from: string;
      to: string;
    } | null;
    smart: boolean;
    calculatedNumberOfPackages: number | null;
  };
  invoice: {
    required: boolean;
    address?: {
      street: string;
      city: string;
      zipCode: string;
      countryCode: string;
      company?: {
        name: string;
        taxId?: string;
      };
      naturalPerson?: {
        firstName: string;
        lastName: string;
      };
    };
  } | null;
  lineItems: AllegroLineItem[];
  surcharges: Array<{
    id: string;
    type: string;
    provider: string | null;
    finishedAt: string | null;
    paidAmount: {
      amount: string;
      currency: string;
    };
  }>;
  discounts: Array<{
    type: string;
  }>;
  summary: {
    totalToPay: {
      amount: string;
      currency: string;
    };
  };
  updatedAt: string;
  revision: string;
}

export interface AllegroLineItem {
  id: string;
  offer: {
    id: string;
    name: string;
    external?: {
      id: string;
    };
  };
  quantity: number;
  originalPrice: {
    amount: string;
    currency: string;
  };
  price: {
    amount: string;
    currency: string;
  };
  reconciliation: {
    value: {
      amount: string;
      currency: string;
    };
    type: string;
    quantity: number;
  } | null;
  selectedAdditionalServices: Array<{
    definitionId: string;
    name: string;
    price: {
      amount: string;
      currency: string;
    };
    quantity: number;
  }>;
  vouchers: Array<{
    code: string;
    type: string;
    value: {
      amount: string;
      currency: string;
    } | null;
  }>;
  boughtAt: string;
}

export interface AllegroCheckoutFormsResponse {
  checkoutForms: AllegroCheckoutForm[];
  count: number;
  totalCount: number;
}

// Zamówienie w formacie A-CMR
export interface CrmOrder {
  source: "ALLEGRO" | "BASELINKER" | "MANUAL" | string;
  externalId?: string; // made optional
  externalOrderNumber?: string; // made optional
  
  orderNumber: string;
  status: string;
  
  recipient?: {
    firstName: string;
    lastName: string;
    companyName: string;
    email: string;
    phone: string;
    address: {
      street: string;
      city: string;
      zipCode: string;
      countryCode?: string;
      country?: string;
    };
  };
  
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    price: number;
    currency: string;
    vat?: number;
    weight?: number;
    imageUrl?: string;
    ean?: string;
    allegroOfferId?: string;
    allegroLineItemId?: string;
    crmProductId?: string | null;
  }>;

  buyer?: {
    id: string;
    login: string;
    email: string;
    phone: string;
    firstName: string;
    lastName: string;
    companyName: string | null;
    isGuest: boolean;
  };
  
  payment?: {
    type: string;
    provider: string;
    status: string;
    paidAmount: number;
    totalAmount: number;
    currency: string;
    finishedAt: string | null;
  };
  
  delivery?: {
    method: string;
    methodId: string;
    cost: number;
    currency: string;
    smart: boolean;
    pickupPoint: {
      id: string;
      name: string;
      address: string;
      city: string;
      zipCode: string;
      countryCode: string;
    } | null;
  };

  invoice?: {
    required: boolean;
    companyName?: string;
    taxId?: string;
    address?: {
      street: string;
      city: string;
      zipCode: string;
      countryCode: string;
    };
  };

  pickupPoint?: {
    id: string;
    name: string;
    address: string;
    city: string;
    zipCode: string;
    countryCode: string;
  } | null;

  countryCode?: string;
  currency?: string;
  
  allegroData?: {
    checkoutFormId: string;
    buyerId?: string;
    buyerLogin?: string;
    messageToSeller: string | null;
    revision: string;
    marketplaceId?: string;
    fulfillmentStatus?: string | null;
  };
  
  shipping?: {
    trackingNumber: string | null;
    carrier: string | null;
    labelUrl: string | null;
    shippedAt: Date | null;
    trackingSentToAllegro: boolean;
  };
  
  companyId: string;
  integrationId: string;
  
  createdAt: FirebaseFirestore.FieldValue | Date;
  updatedAt: FirebaseFirestore.FieldValue | Date;
  importedAt?: FirebaseFirestore.FieldValue | Date;
  orderedAt?: Date | null;
  allegroCreatedAt?: Date | null;
  allegroBoughtAt?: Date | null;
}

// ============================================
// SHIPMENTS / TRACKING
// ============================================

export interface AllegroShipmentRequest {
  carrierId: string;
  carrierName?: string;
  waybill: string;
  lineItemIds: string[];
}

export interface AllegroCarrier {
  id: string;
  name: string;
}

// Mapowanie kurierów A-CMR → Allegro carrier ID
export const CARRIER_MAPPING: Record<string, { id: string; name: string }> = {
  DHL: { id: "DHL", name: "DHL" },
  "DHL_DE": { id: "DHL", name: "DHL" },
  INPOST: { id: "INPOST", name: "InPost" },
  DPD: { id: "DPD", name: "DPD" },
  GLS: { id: "GLS", name: "GLS" },
  UPS: { id: "UPS", name: "UPS" },
  FEDEX: { id: "FEDEX", name: "FedEx" },
  POCZTA_POLSKA: { id: "POCZTA_POLSKA", name: "Poczta Polska" },
  // Domyślny dla nieznanych
  OTHER: { id: "OTHER", name: "Inny przewoźnik" },
};

// ============================================
// OFERTY / PRODUKTY ALLEGRO
// ============================================

export interface AllegroOffer {
  id: string;
  name: string;
  category: {
    id: string;
  };
  primaryImage: {
    url: string;
  } | null;
  sellingMode: {
    format: "BUY_NOW" | "ADVERTISEMENT" | "AUCTION";
    price: {
      amount: string;
      currency: string;
    };
  };
  stock: {
    available: number;
    unit: string;
  };
  publication: {
    status: "ACTIVE" | "INACTIVE" | "ENDED" | "ACTIVATING";
    endingAt: string | null;
  };
  external: {
    id: string;  // SKU zewnętrzne
  } | null;
  ean: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AllegroOffersResponse {
  offers: AllegroOffer[];
  count: number;
  totalCount: number;
}

export interface ProductMapping {
  id?: string;
  source: "ALLEGRO";
  
  // Dane z Allegro
  externalOfferId: string;
  externalOfferName: string;
  externalSku: string | null;
  externalEan: string | null;
  externalImageUrl: string | null;
  externalPrice: number;
  externalStock: number;
  
  // Dane CRM
  crmProductId: string | null;
  crmProductSku: string | null;
  crmProductName: string | null;
  
  // Status
  status: "mapped" | "unmapped" | "auto_mapped";
  mappedAt: FirebaseFirestore.Timestamp | null;
  mappedBy: string | null;  // userId
  
  // Sync
  syncStockToAllegro: boolean;
  lastStockSyncAt: FirebaseFirestore.Timestamp | null;
  
  // Metadata
  companyId: string;
  integrationId: string;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

export interface CachedAllegroOffer {
  id: string;
  name: string;
  sku: string | null;
  ean: string | null;
  imageUrl: string | null;
  price: number;
  stock: number;
  status: "ACTIVE" | "INACTIVE" | "ENDED";
  
  companyId: string;
  integrationId: string;
  lastFetchedAt: FirebaseFirestore.Timestamp;
}

// ============================================
// STOCK SYNCHRONIZATION
// ============================================

export interface AllegroStockUpdateCommand {
  id: string;
  input: {
    changeType: "FIXED";
    value: number;
  };
  offerId: string;
}

export interface AllegroStockUpdateResponse {
  id: string;
  taskCount: {
    total: number;
    success: number;
    failed: number;
  };
}

export interface StockSyncResult {
  offerId: string;
  sku: string;
  previousQty: number;
  newQty: number;
  success: boolean;
  error?: string;
}

// ============================================
// WEBHOOKS / EVENT SUBSCRIPTIONS
// ============================================

export type AllegroEventType = 
  | "ORDER_CREATED"           // Nowe zamówienie
  | "ORDER_FILLED_IN"         // Zamówienie uzupełnione (adres, płatność)
  | "ORDER_READY_FOR_PROCESSING" // Gotowe do realizacji
  | "ORDER_CANCELLED"         // Anulowane
  | "ORDER_PAYMENT_CAPTURED"  // Płatność zaksięgowana
  | "ORDER_SHIPMENT_CREATED"; // Przesyłka utworzona

export interface AllegroEventPayload {
  id: string;                 // ID zdarzenia
  type: AllegroEventType;     // Typ zdarzenia
  occurredAt: string;         // ISO timestamp
  subject: {
    oid: string;              // Order ID (checkout form ID)
  };
}

export interface AllegroEventSubscription {
  id: string;
  url: string;
  eventTypes: AllegroEventType[];
  status: "ACTIVE" | "INACTIVE";
}

export interface AllegroEventBatch {
  events: AllegroEventPayload[];
}

export interface WebhookLog {
  eventId: string;
  eventType: AllegroEventType;
  checkoutFormId: string;
  receivedAt: FirebaseFirestore.Timestamp;
  processedAt: FirebaseFirestore.Timestamp | null;
  status: "received" | "processing" | "processed" | "failed";
  error: string | null;
  integrationId: string;
  companyId: string;
}
