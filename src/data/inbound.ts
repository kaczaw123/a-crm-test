import { Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';

export type InboundShipmentStatus = 
  | "draft"
  | "submitted"
  | "approved"
  | "in_receiving"
  | "received_partial"
  | "received_complete"
  | "closed_with_shortage"
  | "rejected";

export type ReceiptStatus = 
  | "pending"    // Not started
  | "processing" // Currently handled by a warehouse worker
  | "partial"    // Partially processed and pending further arrivals
  | "completed"; // Fully received

export interface InboundShipment {
  id?: string;
  orgId: string;
  status: InboundShipmentStatus;

  // Arrival info
  plannedDeliveryDate?: Timestamp;
  carrier?: string;
  trackingNumber?: string;

  // Pre-calculated expectations
  totalExpectedQty: number;
  totalExpectedWeight: number; // in kg
  totalExpectedVolume: number; // in m³
  itemsCount: number;

  // Receipt progress
  totalReceivedQty: number;
  totalReceivedWeight: number;
  totalReceivedVolume: number;

  // Concurrency and processing
  receiptStatus: ReceiptStatus;
  lockedBy?: string | null;  // User ID currently scanning
  lockedAt?: Timestamp | null;
  receiptProgress: number; // Percentage 0-100%

  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface InboundShipmentItem {
  id?: string; 
  productId: string; // The Product ID (e.g. bl-1234)
  sku: string;
  ean?: string;
  name: string;

  expectedQty: number;
  receivedQty: number;

  weightPerUnit: number;
  volumePerUnit: number;
  lengthPerUnit?: number;
  widthPerUnit?: number;
  heightPerUnit?: number;

  totalExpectedWeight: number;
  totalExpectedVolume: number;

  totalReceivedWeight: number;
  totalReceivedVolume: number;

  // WMS Staging Buffer (Roboczy zapis bez wejścia na główny stan)
  draftReceivedQty?: number;
  draftCompleted?: boolean;

  draftWeightPerUnit?: number;
  draftLengthPerUnit?: number;
  draftWidthPerUnit?: number;
  draftHeightPerUnit?: number;
  draftVolumePerUnit?: number;
}

// -------------------------------------------------------------
// CLOUD FUNCTION CALLABLES (No business logic runs directly on frontend)
// -------------------------------------------------------------

export const createInboundShipmentCallable = httpsCallable<any, any>(functions, 'createInboundShipment');
export const updateInboundShipmentCallable = httpsCallable<any, any>(functions, 'updateInboundShipment');
export const forceCloseInboundShipmentCallable = httpsCallable<any, any>(functions, 'forceCloseInboundShipment');

export const startReceiptTransactionCallable = httpsCallable<{shipmentId: string, companyId: string}, any>(functions, 'startReceiptTransaction');
// STARY SPOSÓB (zależnie od wdrożenia zostawiamy do upewnienia lub kasujemy później):
export const processReceiptItemsCallable = httpsCallable<any, any>(functions, 'processReceiptItems');

// NOWY SPOSÓB WMS BUFORÓW (PER-ITEM):
export const saveInboundReceiptItemDraftCallable = httpsCallable<any, any>(functions, 'saveInboundReceiptItemDraft');
export const finalizeInboundShipmentCallable = httpsCallable<{shipmentId: string, companyId: string}, any>(functions, 'finalizeInboundShipment');
export const unlockReceiptTransactionCallable = httpsCallable<{shipmentId: string, companyId: string}, any>(functions, 'unlockReceiptTransaction');
