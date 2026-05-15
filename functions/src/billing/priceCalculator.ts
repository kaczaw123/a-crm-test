import type {
  CarrierContract,
  CarrierPriceList,
  PriceListEntry,
  PriceListService,
} from '../../../src/types/billing';
import { getSurchargesForCalculation } from './surchargeFetcher';

export interface ProviderCostInput {
  contract: CarrierContract;
  priceList: CarrierPriceList;
  carrierId: string;
  destCountry: string;
  destPostalCode?: string;
  weight: number;
  parcelType?: 'standard' | 'bulky';
  date: Date;
  serviceCode?: string;
  optionalServices?: string[];
  isB2B?: boolean;
}

export interface CostBreakdownItem {
  step: 1 | 2 | 3 | 4;
  code: string;
  label: string;
  amount: number;
  note?: string;
}

export interface ProviderCostResult {
  breakdown: CostBreakdownItem[];
  total: number;
  currency: string;
}

// Map for caching the zones JSON
import zonesData from '../../../data/carriers/dhl-at-2026-zones.json';

const dhlAtZonesCache = zonesData as Record<string, string[] | string>;

function applyMode(amount: number, mode: string, value: number): number {
  if (mode === 'cost_plus_percent') {
    return amount + (amount * value) / 100;
  }
  if (mode === 'cost_plus_fixed') {
    return amount + value;
  }
  if (mode === 'absolute_fixed') {
    return value;
  }
  if (mode === 'no_markup') {
    return amount;
  }
  return amount;
}

export function applyMarkup(
  cost: ProviderCostResult,
  priceListPricing: any | null,
  fallbackShipping: { mode: string; value?: number } | null
): { total: number; markup: number; mode: string; currency: string; breakdownWithMarkup: any[] } {
  
  if (priceListPricing) {
    // New granular logic (per-line)
    const baseMode = priceListPricing.baseMode;
    const baseValue = priceListPricing.baseValue;
    const surchargesMode = priceListPricing.surchargesMode || baseMode;
    const surchargesValue = priceListPricing.surchargesValue ?? baseValue;

    let totalClientPrice = 0;
    const breakdownWithMarkup = cost.breakdown.map(item => {
      let itemMode = item.code.startsWith('BASE') ? baseMode : surchargesMode;
      let itemValue = item.code.startsWith('BASE') ? baseValue : surchargesValue;

      if (priceListPricing.serviceOverrides?.[item.code]) {
        itemMode = priceListPricing.serviceOverrides[item.code].mode;
        itemValue = priceListPricing.serviceOverrides[item.code].value;
      }

      if (itemMode === 'absolute_table') {
        throw new Error('absolute_table mode not implemented');
      }

      const clientAmount = applyMode(item.amount, itemMode, itemValue);
      totalClientPrice += clientAmount;

      return {
        ...item,
        clientAmount: round2(clientAmount),
        markupMode: itemMode,
        markupValue: itemValue
      };
    });

    const total = round2(totalClientPrice);
    const markup = round2(total - cost.total);

    return {
      total,
      markup,
      mode: 'priceList_granular',
      currency: cost.currency,
      breakdownWithMarkup
    };
  }

  // Fallback logic (per-total, backwards compatible)
  if (!fallbackShipping) {
    return { 
      total: cost.total, 
      markup: 0, 
      mode: 'no_markup', 
      currency: cost.currency,
      breakdownWithMarkup: cost.breakdown.map(b => ({ ...b, clientAmount: b.amount, markupMode: 'no_markup', markupValue: 0 }))
    };
  }

  let priceToClient: number;
  let markupAmount: number;

  switch (fallbackShipping.mode) {
    case 'cost_plus_percent':
      markupAmount = (cost.total * (fallbackShipping.value || 0)) / 100;
      priceToClient = cost.total + markupAmount;
      break;
    case 'cost_plus_fixed':
      markupAmount = fallbackShipping.value || 0;
      priceToClient = cost.total + markupAmount;
      break;
    case 'absolute_table':
      throw new Error('absolute_table mode not implemented');
    default:
      priceToClient = cost.total;
      markupAmount = 0;
  }

  return {
    total: round2(priceToClient),
    markup: round2(markupAmount),
    mode: fallbackShipping.mode,
    currency: cost.currency,
    breakdownWithMarkup: cost.breakdown.map(b => ({ ...b, clientAmount: b.amount, markupMode: fallbackShipping.mode, markupValue: fallbackShipping.value || 0 })) // for fallback, just returning amount as clientAmount for breakdown
  };
}

function getDhlAtZone(destCountry: string): string {
  for (const [zone, countries] of Object.entries(dhlAtZonesCache)) {
    if (zone.startsWith('ZONE') && Array.isArray(countries)) {
      if (countries.includes(destCountry)) {
        return zone;
      }
    }
  }
  
  throw new Error(`Country ${destCountry} not mapped to any DHL zone — update dhl-at-2026-zones.json`);
}

export async function calculateProviderCost(input: ProviderCostInput): Promise<ProviderCostResult> {
  const breakdown: CostBreakdownItem[] = [];
  const currency = input.priceList.prices[0]?.currency || 'EUR';

  // === Krok 1: Base price ===
  const base = findBasePrice(
    input.priceList.prices,
    input.destCountry,
    input.weight,
    input.serviceCode || 'STANDARD'
  );
  breakdown.push({
    step: 1,
    code: `BASE_${base.entry.zoneCode}_${base.entry.weightTo}_${base.entry.serviceCode || 'STANDARD'}`,
    label: `Base ${input.destCountry} ${input.weight}kg ${base.zone}`,
    amount: base.basePrice,
    note: base.isRatecard ? `ratecard: ${base.formula}` : undefined,
  });

  // === Krok 2: Mandatory ===
  const mandatorySvcs = (input.priceList.services || []).filter(s => s.category === 'mandatory');
  for (const svc of mandatorySvcs) {
    if (svc.code === 'ENERGY_SURCHARGE') {
      const surcharges = await getSurchargesForCalculation(input.carrierId, input.date);
      const energyPercent = surcharges.energySurchargePercent || 0;
      const energyAmount = (base.basePrice * energyPercent) / 100;
      breakdown.push({
        step: 2,
        code: svc.code,
        label: svc.name,
        amount: round2(energyAmount),
        note: `${energyPercent}% × ${base.basePrice} = ${round2(energyAmount)} (source: ${surcharges.source === 'missing' ? 'missing (fallback 0%)' : surcharges.source})`,
      });
    } else if (svc.code === 'FUEL_SURCHARGE') {
      const surcharges = await getSurchargesForCalculation(input.carrierId, input.date);
      const fuelPercent = surcharges.fuelSurchargePercent || 0;
      const fuelAmount = (base.basePrice * fuelPercent) / 100;
      breakdown.push({
        step: 2,
        code: svc.code,
        label: svc.name,
        amount: round2(fuelAmount),
        note: `${fuelPercent}% × ${base.basePrice} = ${round2(fuelAmount)}`,
      });
    } else if (svc.type === 'flat' && svc.basePrice != null) {
      breakdown.push({ step: 2, code: svc.code, label: svc.name, amount: svc.basePrice });
    } else if (svc.type === 'percent' && svc.percent != null) {
      const amount = (base.basePrice * svc.percent) / 100;
      breakdown.push({ step: 2, code: svc.code, label: svc.name, amount: round2(amount), note: `${svc.percent}%` });
    }
  }

  // === Krok 3: Conditional ===
  const conditionalSvcs = (input.priceList.services || []).filter(s => s.category === 'conditional');
  for (const svc of conditionalSvcs) {
    if (!matchesConditions(svc, input)) continue;
    if (svc.type === 'flat' && svc.basePrice != null) {
      breakdown.push({ step: 3, code: svc.code, label: svc.name, amount: svc.basePrice });
    } else if (svc.type === 'percent' && svc.percent != null) {
      const amount = (base.basePrice * svc.percent) / 100;
      breakdown.push({ step: 3, code: svc.code, label: svc.name, amount: round2(amount), note: `${svc.percent}%` });
    }
  }

  // === Krok 4: Optional ===
  const optionalSvcs = (input.priceList.services || []).filter(
    s => s.category === 'optional' && (input.optionalServices || []).includes(s.code)
  );
  for (const svc of optionalSvcs) {
    if (svc.type === 'flat' && svc.basePrice != null) {
      breakdown.push({ step: 4, code: svc.code, label: svc.name, amount: svc.basePrice });
    } else if (svc.type === 'percent' && svc.percent != null) {
      const amount = (base.basePrice * svc.percent) / 100;
      breakdown.push({ step: 4, code: svc.code, label: svc.name, amount: round2(amount) });
    }
  }

  // Krok 5 (penalty) celowo wykluczony

  const total = round2(breakdown.reduce((sum, item) => sum + item.amount, 0));
  return { breakdown, total, currency };
}

// === HELPERS ===

function findBasePrice(
  prices: PriceListEntry[],
  destCountry: string,
  weight: number,
  serviceCode: string
): { basePrice: number; zone: string; isRatecard: boolean; formula?: string; entry: PriceListEntry } {
  // Max weight check? We could determine max weight in the price list for this zone
  
  // 1. Check individual pricing (zoneCode === destCountry or 'DE')
  let matches = prices.filter(p => p.serviceCode === serviceCode && p.zoneCode === destCountry);
  
  // 2. Check ratecard zones if not found
  if (matches.length === 0) {
    const zoneName = getDhlAtZone(destCountry);
    matches = prices.filter(p => p.serviceCode === serviceCode && p.zoneCode === zoneName);
  }

  if (matches.length === 0) {
    throw new Error(`No matching price for destCountry=${destCountry}, serviceCode=${serviceCode}`);
  }

  const maxWeight = Math.max(...matches.map(p => p.weightTo));
  if (weight > maxWeight) {
    throw new Error('weight out of range');
  }

  const match = matches.find(p => {
    if (weight === 0 && p.weightFrom === 0) return true;
    return weight > p.weightFrom && weight <= p.weightTo;
  });
  if (!match) {
    throw new Error(`No matching price for weight=${weight}kg`);
  }

  return computePrice(match, weight);
}

function computePrice(p: PriceListEntry, weight: number): { basePrice: number; zone: string; isRatecard: boolean; formula?: string; entry: PriceListEntry } {
  if (p.pricePerKg != null) {
    const calc = p.basePrice + weight * p.pricePerKg;
    return {
      basePrice: round2(calc),
      zone: p.zoneCode,
      isRatecard: true,
      formula: `${p.basePrice} + ${weight}kg × ${p.pricePerKg} = ${round2(calc)}`,
      entry: p
    };
  }
  return { basePrice: p.basePrice, zone: p.zoneCode, isRatecard: false, entry: p };
}

function matchesConditions(svc: PriceListService, input: ProviderCostInput): boolean {
  const c = svc.conditions;
  if (!c) return true;

  if (c.dateRange) {
    const month = input.date.getMonth() + 1; // 1-12
    const from = c.dateRange.fromMonth;
    const to = c.dateRange.toMonth;
    if (from <= to) {
      if (month < from || month > to) return false;
    } else {
      // wrap-around
      if (month < from && month > to) return false;
    }
  }
  if (c.countries && !c.countries.includes(input.destCountry)) return false;
  if (c.excludeCountries && c.excludeCountries.includes(input.destCountry)) return false;
  
  const pType = input.parcelType || 'standard';
  if (c.parcelType && c.parcelType !== pType) return false;
  
  if (c.intlOnly && input.destCountry === input.contract.originCountry) return false;
  if (c.domesticOnly && input.destCountry !== input.contract.originCountry) return false;

  if (c.b2cOnly && input.isB2B) return false;
  if (c.b2bOnly && input.isB2B === false) return false;

  return true;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
