export type MarkupMode = 'cost_plus_percent' | 'cost_plus_fixed' | 'absolute_fixed' | 'absolute_table' | 'no_markup';

export interface ServiceMarkupOverride {
  mode: MarkupMode;
  value: number;
}

export interface PriceListPricing {
  baseMode: MarkupMode;
  baseValue: number;
  surchargesMode?: MarkupMode;
  surchargesValue?: number;
  serviceOverrides?: Record<string, ServiceMarkupOverride>;
}

export interface ShippingPricing {
  isActive?: boolean;
  mode: MarkupMode;
  value?: number;
  table?: import('./billing').PriceListEntry[];
  priceLists?: Record<string, PriceListPricing>; // Keyed by priceListId
}

export interface FulfillmentPricing {
  storageRatePerM3PerMonth: number;
  packingFeePerOrder: number;
  currency: string;
}

export interface AdditionalServicesPricing {
  returnLabelFee?: number;
  codFee?: number;
  // ... łatwo rozszerzalne
  [serviceCode: string]: number | undefined;
}

export interface ClientPricing {
  id: string;
  companyId: string;
  validFrom: any;                  // Firestore Timestamp
  validTo?: any | null;
  status: 'active' | 'draft' | 'archived';
  version: number;
  shippingPricing: Record<string, ShippingPricing>;  // per carrierId
  fulfillmentPricing: FulfillmentPricing;
  additionalServicesPricing?: AdditionalServicesPricing;
  createdBy: string;
  createdAt: any;
  notes?: string;
}
