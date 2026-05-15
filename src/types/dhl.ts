import { Timestamp } from 'firebase/firestore';

export interface DhlIntegration {
  id?: string;
  type: 'dhl_de';
  customName: string;
  sandboxMode: boolean;
  status: 'active' | 'inactive' | 'error';
  isDefault: boolean;
  lastTestAt?: Timestamp;
  // reszta zakodowana w bazie
}

export interface DhlShipment {
  id?: string;
  trackingNumber: string;
  carrier: 'dhl_de';
  integrationId: string;
  sandboxMode?: boolean;
  labelStoragePath: string; // Wygenerowana etykieta do pobrania
  status: 'created' | 'cancelled' | 'delivered' | string;
  sender: {
    company: string;
    name: string;
    street: string;
    streetNumber: string;
    zip: string;
    city: string;
    country: string;
  };
  recipient: {
    company?: string;
    name: string;
    email?: string;
    phone?: string;
    street: string;
    streetNumber: string;
    zip: string;
    city: string;
    country: string;
  };
  parcel: {
    weight: number;
    width?: number;
    length?: number;
    height?: number;
  };
  reference?: string;
  searchTokens: string[];
  billing?: {
    totalClientCost: number;
    currency: string;
    pricingSource: string;
    breakdown?: Array<{
      code: string;
      label: string;
      amount: number;
    }>;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DhlShipmentRequest {
  companyId: string;
  integrationId: string;
  sender: DhlShipment['sender'];
  recipient: DhlShipment['recipient'];
  parcel: DhlShipment['parcel'];
  reference?: string;
  contents?: string;
}

export interface DhlShipmentResponse {
  success: boolean;
  trackingNumber?: string;
  labelUrl?: string;
  message?: string;
}

export interface DhlTrackingEvent {
  date: string;
  time: string;
  status: string;
  location: string;
}

export interface DhlTrackingResponse {
  success: boolean;
  trackingNumber: string;
  status: string;
  events: DhlTrackingEvent[];
}

export interface DhlAddressCheckResponse {
  valid: boolean;
  warnings?: string[];
}

export interface DhlBatchPrintRequest {
  companyId: string;
  shipmentIds: string[];
}
