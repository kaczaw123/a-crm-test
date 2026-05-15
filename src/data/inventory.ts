import { Timestamp } from 'firebase/firestore';

export interface WarehouseLocation {
  id?: string;
  orgId: string;
  name: string;
  type: "MAIN" | "RETURNS" | "QUARANTINE";
  isActive: boolean;
  createdAt: Timestamp;
}

export interface InventoryStock {
  id?: string; // Deterministic: productId_locationId
  productId: string;
  locationId: string;
  orgId: string;

  // Stock Core
  onHand: number;
  reserved: number;
  available: number;

  // Billing & Analytics
  totalWeight: number;
  totalVolume: number;

  lastUpdated: Timestamp;
}

export type InventoryMovementType = 
  | "RECEIPT"
  | "ISSUE"
  | "RESERVE"
  | "RELEASE_RESERVATION"
  | "ADJUSTMENT_PLUS"
  | "ADJUSTMENT_MINUS"
  | "RETURN"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "DAMAGE"
  | "QUARANTINE_IN"
  | "QUARANTINE_OUT";

export interface InventoryMovement {
  id?: string;
  orgId: string;
  productId: string;
  locationId: string;

  type: InventoryMovementType;

  // Delta (ALWAYS SET AS POSITIVE. Logics depend strictly on type)
  quantity: number; 
  weightTotal: number;
  volumeTotal: number;

  // Immutable Snapshot (State right AFTER the transaction completed)
  onHandAfter: number;
  reservedAfter: number;
  availableAfter: number;

  // Reference hooks
  referenceType?: string; 
  referenceId?: string;
  
  performedBy: string; // e.g. user ID
  note?: string;
  createdAt: Timestamp;
}
