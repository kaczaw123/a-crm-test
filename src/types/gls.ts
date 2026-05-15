import { Timestamp } from 'firebase/firestore';

export interface GlsIntegration {
  id?: string;
  type: 'gls_de';
  customName: string;
  sandboxMode: boolean;
  status: 'active' | 'inactive' | 'error';
  isDefault: boolean;
  lastTestAt?: Timestamp;
}

export interface GlsShipment {
  id?: string;
  trackingNumber: string;
  carrier: 'gls_de';
  integrationId: string;
  sandboxMode?: boolean;
  labelStoragePath: string;
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
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
