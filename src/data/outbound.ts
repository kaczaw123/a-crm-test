import { Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';

export type OutboundShipmentStatus = 'draft' | 'pending' | 'completed' | 'canceled';

export interface OutboundShipment {
  id?: string;
  orgId: string;
  
  // Document context
  documentNumber: string; // e.g. WZ/2026/0001
  status: OutboundShipmentStatus;
  
  issuedTo?: string; // Who picked it up
  notes?: string;
  
  // Pre-calculated expectations
  totalIssuedQty: number;
  itemsCount: number;

  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface OutboundShipmentItem {
  id?: string; 
  productId: string; // The Product ID
  sku: string;
  ean?: string;
  name: string;

  issuedQty: number;
}

// -------------------------------------------------------------
// CLOUD FUNCTION CALLABLES (No business logic runs directly on frontend)
// -------------------------------------------------------------

export const createOutboundShipmentCallable = httpsCallable<any, any>(functions, 'createOutboundShipment');
export const finalizeOutboundShipmentCallable = httpsCallable<{shipmentId: string, companyId: string}, any>(functions, 'finalizeOutboundShipment');
export const submitOutboundShipmentCallable = httpsCallable<{shipmentId: string, companyId: string}, any>(functions, 'submitOutboundShipment');
export const cancelOutboundShipmentCallable = httpsCallable<{shipmentId: string, companyId: string}, any>(functions, 'cancelOutboundShipment');
