export type FulfillmentQueueStatus = 'awaiting' | 'routing' | 'picking' | 'packing' | 'packed' | 'exception';

export interface FulfillmentTaskItem {
  productId: string;
  productName: string;
  ean: string;
  sku: string;
  imageUrl?: string;
  location?: string;
  quantity: number;
  scannedQuantity: number;
}

export interface FulfillmentTask {
  id: string; // usually linked to orderId
  companyId: string;
  companyName?: string;
  suggestedBox?: any;
  orderId: string;
  referenceNumber: string; // e.g. external order ID
  status: FulfillmentQueueStatus;
  priority: 'normal' | 'high' | 'urgent'; // Based on SLA/Cut-off

  assignedToPickerId?: string | null;
  assignedToPackerId?: string | null;
  packingStationId?: string | null;

  pickWaveId?: string | null; 
  lockedAt?: number | null; // Transaction lock timestamp
  cutOffDeadline?: number | null; // Timestamp for SLA
  
  createdAt: number;
  updatedAt: number;
  
  // UI Display helpers for UI
  customerName?: string;
  customerCity?: string;
  trackingNumber?: string;
  carrier?: string;
  items?: FulfillmentTaskItem[];
}

export interface PickWave {
  id: string;
  companyId: string;
  status: 'draft' | 'active' | 'completed' | 'cancelled';
  assignedPickerId?: string | null;
  taskIds: string[]; 
  totalItems: number;
  createdAt: number;
  completedAt?: number | null;
}

export interface PackingStation {
  id: string;
  companyId: string;
  name: string; 
  status: 'active' | 'maintenance' | 'offline';
  assignedPackerId?: string | null;
}

export interface Carton {
  id: string;
  companyId: string;
  name: string; 
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
  weightLimitKg?: number;
  emptyWeightKg?: number; 
  isActive: boolean;
}

export interface InventoryException {
  id: string;
  companyId: string;
  orderId: string;
  taskId: string;
  productId: string;
  expectedQuantity: number;
  foundQuantity: number;
  reportedByUid: string;
  status: 'open' | 'investigating' | 'resolved';
  resolution?: 'stock_adjusted' | 'found' | 'cancelled_order';
  createdAt: number;
  resolvedAt?: number | null;
}
