import { Timestamp } from 'firebase/firestore';

export interface ProductLogistics {
  // Raw values from source integrator (for audit)
  rawWeight?: string | number;
  rawLength?: string | number;
  rawWidth?: string | number;
  rawHeight?: string | number;

  // Normalized standard values: weight(kg), length/width/height(cm)
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  
  // Auto-calculated on backend: (length * width * height) / 1,000,000
  volume?: number; // (m³)

  // Packaging data
  packagingType?: "unit" | "carton" | "pallet";
  unitsPerCarton?: number;
  cartonsPerPallet?: number;

  inventoryTracking: boolean;
}

export interface ProductV2 {
  // Identify
  id?: string;
  productId: string; // The primary catalog key
  orgId: string;
  source: 'manual' | 'baselinker';
  sourceIntegrationId?: string;
  
  // Exact mapping keys for massive scale
  externalId?: string;
  externalIdExact?: string;
  
  sku?: string;
  skuExact?: string;
  skuNormalized?: string;
  
  ean?: string;
  eanExact?: string;
  eanNormalized?: string;
  
  name: string;
  nameNormalized: string;
  
  brand?: string;
  description?: string;
  
  // Media endpoints
  images: string[];
  imageThumbUrl?: string;
  imageMainUrl?: string;
  
  // Categorical bounds
  isActive: boolean;
  isArchived: boolean;
  sourceMissing: boolean; 
  
  // Lifecycle
  createdAt: Timestamp;
  updatedAt: Timestamp;
  archivedAt?: Timestamp | null;
  archivedBy?: string | null;
  
  // Logistics core
  logistics: ProductLogistics;
  
  // Future WMS mapping (Passive UI fields)
  availableQty?: number;
  reservedQty?: number;
  onHandQty?: number;
  incomingQty?: number;
  lastInventorySyncAt?: Timestamp;
}
