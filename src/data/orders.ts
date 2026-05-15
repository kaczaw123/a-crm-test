import { Timestamp } from 'firebase/firestore';

export type OrderSource = 'baselinker' | 'allegro' | 'amazon' | 'ebay' | 'shop' | 'manual';
export type OrderStatus = 'new' | 'processing' | 'in_fulfillment' | 'label_created' | 'awaiting_stock' | 'ready_for_shipping' | 'cancelled' | 'shipped';
export type ReservationStatus = 'none' | 'partial' | 'full' | 'released';
export type ShipmentStatus = 'not_ready' | 'ready' | 'confirmed';

export interface OrderRecipient {
  firstName: string;
  lastName: string;
  companyName?: string;
  address: {
    street: string;
    zipCode: string;
    city: string;
    country: string;
  };
  phone: string;
  email: string;
}

export interface InvoiceDetails {
  name: string;
  companyName: string;
  vatNumber: string; // NIP
  address: {
    street: string;
    zipCode: string;
    city: string;
    country: string;
  };
}

export interface OrderInvoice {
  required: boolean;
  companyName?: string;
  taxId?: string;
  address?: {
    street: string;
    city: string;
    zipCode: string;
    countryCode: string;
  };
}

export interface PickupPoint {
  id?: string;
  name?: string;
  address?: string;
  city?: string;
  zipCode?: string;
  countryCode?: string;
}

export interface OrderBuyer {
  id?: string;
  login?: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string | null;
  isGuest?: boolean;
}

export interface OrderPayment {
  type?: string;
  provider?: string;
  status?: string;
  paidAmount?: number;
  totalAmount?: number;
  currency?: string;
  finishedAt?: string | null;
}

export interface OrderDelivery {
  method?: string;
  methodId?: string;
  cost?: number;
  currency?: string;
  smart?: boolean;
  pickupPoint?: PickupPoint | null;
}

export interface Order {
  id: string;            // Firestore doc id
  orgId: string;         // Company / Tenant ID
  source: OrderSource | string;
  integrationId?: string; // e.g. Baselinker integration ID
  externalOrderId?: string;
  orderNumber: string;   // Internal generator CRM sequence
  recipient: OrderRecipient;
  shippingMethod: string;
  courierCode: string;
  paymentMethod?: string;
  invoiceDetails?: InvoiceDetails;
  
  status: OrderStatus;
  reservationStatus: ReservationStatus;
  shipmentStatus: ShipmentStatus;
  
  notes: string;         // Note from the source or buyer
  internalNotes: string; // CRM operator notes
  
  createdBy: string;     // UID
  createdAt: Timestamp;
  updatedAt: Timestamp;
  
  // Lightweight render helpers (Denormalizacja V2 dla list operacyjnych)
  itemCount?: number;
  recipientDisplayName?: string;
  recipientCity?: string;
  shippingMethodLabel?: string;
  labelStoragePath?: string;
  trackingNumber?: string;

  // Nowa architektura — Niezależne flagi (akceptacja 2026-04-16)
  hasReservation?: boolean;
  reservedAt?: Timestamp | null;
  hasLabel?: boolean;
  inFulfillment?: boolean;
  fulfillmentQueueId?: string | null;
  fulfillmentStatus?: 'awaiting' | 'packing' | 'packed' | 'shipped' | null;
  warehouseStatus?: {
    mapping?: 'FULL' | 'PARTIAL' | 'NONE';
    reservation?: 'FULL' | 'PARTIAL' | 'NONE';
    fulfillment?: 'IN_QUEUE' | 'PENDING' | 'COMPLETED';
  };  // Nowe pola Allegro / BaseLinker
  items?: OrderItem[];
  buyer?: OrderBuyer;
  payment?: OrderPayment;
  delivery?: OrderDelivery;
  invoice?: OrderInvoice;
  pickupPoint?: PickupPoint | null;
  
  countryCode?: string;
  currency?: string;
  orderedAt?: Date | null;
  
  orderHelpersVersion?: number; // v2
  firstItemSource?: 'crm_product' | 'order_fallback';
  firstItemProductId?: string;
  firstItemImageUrl?: string;
  firstItemName?: string;
  firstItemSku?: string;
  firstItemEan?: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  orgId: string;
  productId: string; // mapped product PK
  sku: string;
  ean: string;
  name: string;
  
  qtyOrdered: number;
  qtyReserved: number;
  qtyPicked: number;
  qtyShipped: number;
  
  mappingStatus: 'mapped' | 'unmapped';
  crmProductSnapshot?: any; // Załadowane przez API getOrderDetails

  // Nowe pola Allegro / BaseLinker
  quantity?: number; // often mapped directly in array
  price?: number;
  currency?: string;
  vat?: number;
  weight?: number;
  imageUrl?: string;
  allegroOfferId?: string;
  allegroLineItemId?: string;
}

export interface StockReservation {
  id: string;
  orgId: string;
  orderId: string;
  itemId?: string; // if tied to specific order item
  productId: string;
  locationId?: string; // Optional: specific warehouse location reserved from
  qtyReserved: number;
  status: 'active' | 'released' | 'shipped';
  createdAt: Timestamp;
}

// -------------------------------------------------------------
// CLOUD FUNCTION CALLABLES
// -------------------------------------------------------------
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/config';

export const allocateOrderReservationsCallable = httpsCallable<{companyId: string, orderId: string}, any>(functions, 'allocateOrderReservations');

