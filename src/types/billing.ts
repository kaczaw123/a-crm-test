export interface Carrier {
  id: string;
  code: string;
  displayName: string;
  country: string;
  apiIntegrationType?: string | null;
  surchargeUrl?: string | null;
  active: boolean;
  updatedAt?: any;
  updatedBy?: string;
}
export interface CarrierContract {
  id: string;
  carrierId: string;
  validFrom: any;  // Firestore Timestamp
  validTo?: any | null;
  contractFileUrl?: string | null;
  notes?: string;
  status: 'active' | 'expired' | 'draft';
  version: number;
  originCountry?: string;     // ISO-2, kraj fizycznego nadania paczek (np. "DE")
  injectionPoint?: string;    // np. "Hub 02625 Bautzen, DE"
  contractEntity?: string;    // pełna legal entity, np. "DHL Paket (Austria) GmbH"
  contractRef?: string;       // numer kontraktu u kuriera
  ekp?: string;               // EKP / customer number
  createdAt?: any;
  createdBy?: string;
  updatedAt?: any;
  updatedBy?: string;
}
export interface PriceListEntry {
  zoneCode: string;
  weightFrom: number;
  weightTo: number;
  basePrice: number;
  currency: string;
  serviceCode: string;
  pricePerKg?: number;
}
export type ServiceCategory = 'base' | 'mandatory' | 'conditional' | 'optional' | 'penalty';
export type ServiceType = 'flat' | 'percent' | 'variable_external';

export interface ServiceConditions {
  dateRange?: { fromMonth: number; toMonth: number };  // 1-12
  countries?: string[];          // ISO-2 list (BREXIT)
  excludeCountries?: string[];
  parcelType?: 'bulky' | 'standard';
  direction?: 'outbound' | 'return' | 'undeliverable';
  intlOnly?: boolean;
  domesticOnly?: boolean;
  b2cOnly?: boolean;
  b2bOnly?: boolean;
}

export interface PriceListService {
  code: string;
  name: string;
  category?: ServiceCategory;     // default 'optional' (backwards compat)
  type?: ServiceType;             // default 'flat'
  basePrice?: number;             // dla flat
  percent?: number;               // dla percent
  applyTo?: 'base' | 'total';     // dla percent (default 'base')
  externalSource?: string;        // dla variable_external
  conditions?: ServiceConditions;
}
export interface CarrierPriceList {
  id: string;
  name?: string;
  validFrom: any;
  validTo?: any | null;
  prices: PriceListEntry[];
  services: PriceListService[];
  version: number;
  createdAt?: any;
  createdBy?: string;
}

export type SurchargeApplyMode = 'flat' | 'percent_of_base' | 'percent_of_total';

export interface CarrierSurcharge {
  id: string;                             // = effectiveMonth (yyyy-mm)
  effectiveMonth: string;
  effectiveFrom: any;                     // Timestamp 1. dnia miesiąca UTC
  effectiveTo?: any | null;               // ostatni dzień miesiąca lub null
  fuelSurchargePercent?: number | null;   // null gdy brak (DHL Paket)
  energySurchargePercent?: number | null;
  applyMode: SurchargeApplyMode;          // default 'percent_of_base'
  additionalSurcharges?: Array<{
    code: string;
    name: string;
    valueType: 'percent' | 'fixed';
    value: number;
    currency?: string;
  }>;
  source: 'auto' | 'manual';
  sourceUrl?: string;
  fetchedAt?: any;
  manualOverrideBy?: string;
  manualOverrideAt?: any;
  manualNote?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface SurchargeAlert {
  id: string;
  carrierId: string;
  effectiveMonth: string;
  oldEnergySurchargePercent?: number | null;
  newEnergySurchargePercent?: number | null;
  oldFuelSurchargePercent?: number | null;
  newFuelSurchargePercent?: number | null;
  deltaEnergyPp?: number | null;
  deltaFuelPp?: number | null;
  createdAt: any;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: any;
}
