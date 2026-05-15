import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { calculateProviderCost } from './priceCalculator';

// Mock surcharge fetcher
vi.mock('./surchargeFetcher', () => {
  return {
    getSurchargesForCalculation: vi.fn(async (carrierId: string, date: Date) => {
      // Mocked manual values for tests based on date
      const m = date.getMonth() + 1; // 1-12
      if (m === 6) { // June
        return { energySurchargePercent: 3.25, fuelSurchargePercent: 0, applyMode: 'percent_of_base', source: 'manual' };
      }
      return { energySurchargePercent: 1.25, fuelSurchargePercent: 0, applyMode: 'percent_of_base', source: 'manual' };
    })
  };
});

// Load the JSON fixture directly using require or fs
const dhlPricelistPath = path.resolve(__dirname, '../../../data/carriers/dhl-at-2026-pricelist.json');
let priceListFixture: any = null;
if (fs.existsSync(dhlPricelistPath)) {
  priceListFixture = JSON.parse(fs.readFileSync(dhlPricelistPath, 'utf8'));
} else {
  console.warn('Fixture not found, tests might fail if they depend on it.');
}

const mockContract: any = {
  id: 'dhl_at_2026',
  originCountry: 'AT',
  carrierId: 'dhl_at',
  validFrom: new Date(),
  version: 1,
  status: 'active',
};

const allPrices = priceListFixture?.priceLists?.flatMap((pl: any) => pl.prices) || [];
const allServices = priceListFixture?.priceLists?.flatMap((pl: any) => pl.services) || [];

const classifiedServices = allServices.map((s: any) => {
  if (s.code === 'TOLL_CO2') return { ...s, category: 'mandatory', type: 'flat' };
  if (s.code === 'ENERGY_SURCHARGE') return { ...s, category: 'mandatory', type: 'percent', applyTo: 'base' };
  if (s.code === 'PEAK_SURCHARGE') return { ...s, category: 'conditional', type: 'flat', conditions: { dateRange: { fromMonth: 11, toMonth: 12 } } };
  if (s.code === 'BULKY') return { ...s, category: 'conditional', type: 'flat', conditions: { parcelType: 'bulky' } };
  if (s.code.startsWith('BREXIT')) return { ...s, category: 'conditional', type: 'flat', conditions: { countries: ['GB', 'IM', 'JE', 'GG'] } };
  if (s.code.startsWith('WEIGHT_CORR')) return { ...s, category: 'penalty', type: 'flat' };
  return { ...s, category: 'optional', type: 'flat' };
});

const uniqueServicesMap = new Map();
classifiedServices.forEach((s: any) => {
  if (!uniqueServicesMap.has(s.code) || s.basePrice != null) {
    uniqueServicesMap.set(s.code, s);
  }
});
const uniqueServices = Array.from(uniqueServicesMap.values());

const mockPriceList: any = {
  id: 'dhl_at_2026__de_international_v1',
  prices: allPrices,
  services: uniqueServices,
  validFrom: new Date(),
  version: 1,
};

describe('calculateProviderCost (5-layer calculator)', () => {
  it('Scenariusz 1: AT->PL 2kg STANDARD kwiecien 2026 -> 8.26 EUR', async () => {
    const input = {
      contract: mockContract,
      priceList: mockPriceList,
      carrierId: 'dhl_at',
      destCountry: 'PL',
      weight: 2,
      date: new Date('2026-04-15T12:00:00Z'),
      serviceCode: 'STANDARD' as const,
    };
    const res = await calculateProviderCost(input);
    
    expect(res.breakdown.find(b => b.code === 'BASE')?.amount).toBe(7.97);
    expect(res.breakdown.find(b => b.code === 'TOLL_CO2')?.amount).toBe(0.19);
    expect(res.breakdown.find(b => b.code === 'ENERGY_SURCHARGE')?.amount).toBe(0.1);
    expect(res.breakdown.some(b => b.code.startsWith('WEIGHT_CORR'))).toBe(false);
    expect(res.total).toBe(8.26); // 7.97 + 0.19 + 0.10
  });

  it('Scenariusz 2: AT->PL 2kg STANDARD czerwiec 2026 -> 8.42 EUR (Energy 3.25%)', async () => {
    const input = {
      contract: mockContract,
      priceList: mockPriceList,
      carrierId: 'dhl_at',
      destCountry: 'PL',
      weight: 2,
      date: new Date('2026-06-15T12:00:00Z'), // June triggers 3.25% energy
      serviceCode: 'STANDARD' as const,
    };
    const res = await calculateProviderCost(input);
    const energy = res.breakdown.find(b => b.code === 'ENERGY_SURCHARGE')?.amount;
    expect(energy).toBe(0.26); // 7.97 * 3.25% = 0.259025 -> 0.26
    expect(res.total).toBe(8.42); // 7.97 + 0.19 + 0.26
  });

  it('Scenariusz 3: AT->DE 3kg STANDARD -> 3.77 + 0.19 + 0.05 (1.25%*3.77) = 4.01', async () => {
    const input = {
      contract: mockContract,
      priceList: mockPriceList,
      carrierId: 'dhl_at',
      destCountry: 'DE',
      weight: 3,
      date: new Date('2026-04-15'),
      serviceCode: 'STANDARD' as const,
    };
    const res = await calculateProviderCost(input);
    expect(res.breakdown.find(b => b.code === 'BASE')?.amount).toBe(3.77);
    expect(res.total).toBe(4.01);
  });

  it('Scenariusz 4: AT->DE 1kg + COD grudzien -> 3.72 + 0.19 + 0.05 + 0.19 (peak) + 7.49 (cod) = 11.64', async () => {
    const input = {
      contract: mockContract,
      priceList: mockPriceList,
      carrierId: 'dhl_at',
      destCountry: 'DE',
      weight: 1,
      date: new Date('2026-12-15'), // December triggers PEAK
      optionalServices: ['COD'],
      serviceCode: 'STANDARD' as const,
    };
    const res = await calculateProviderCost(input);
    expect(res.breakdown.find(b => b.code === 'BASE')?.amount).toBe(3.72);
    expect(res.breakdown.find(b => b.code === 'PEAK_SURCHARGE')?.amount).toBe(0.19);
    expect(res.breakdown.find(b => b.code === 'COD')?.amount).toBe(7.49);
    expect(res.total).toBe(11.64);
  });

  it('Scenariusz 5: USA 5kg ratecard (zone 6) -> ratecard formula', async () => {
    const input = {
      contract: mockContract,
      priceList: mockPriceList,
      carrierId: 'dhl_at',
      destCountry: 'US', // Uses ZONE_4 or placeholder
      weight: 5,
      date: new Date('2026-04-15'),
      serviceCode: 'STANDARD' as const,
    };
    const res = await calculateProviderCost(input);
    // US is in ZONE_4 (according to our placeholder). 
    // Ratecard for ZONE_4 standard is e.g. base + weight * pricePerKg.
    // Assuming priceList fixture has ratecard entries.
    const baseStep = res.breakdown.find(b => b.code === 'BASE');
    expect(baseStep?.note).toContain('ratecard:');
    // We just verify it successfully applied the ratecard
    expect(res.total).toBeGreaterThan(0);
  });

  it('Scenariusz 6: UK 1kg + Brexit -> base + 3.95 (Brexit)', async () => {
    const input = {
      contract: mockContract,
      priceList: mockPriceList,
      carrierId: 'dhl_at',
      destCountry: 'GB',
      weight: 1,
      date: new Date('2026-04-15'),
      serviceCode: 'STANDARD' as const,
    };
    const res = await calculateProviderCost(input);
    const brexit = res.breakdown.find(b => b.code.startsWith('BREXIT'));
    expect(brexit?.amount).toBe(3.95);
  });

  it('Scenariusz 7: bulky 10kg DE -> base + 21.00 (bulky)', async () => {
    const input = {
      contract: mockContract,
      priceList: mockPriceList,
      carrierId: 'dhl_at',
      destCountry: 'DE',
      weight: 10,
      parcelType: 'bulky' as const,
      date: new Date('2026-04-15'),
      serviceCode: 'STANDARD' as const,
    };
    const res = await calculateProviderCost(input);
    const bulky = res.breakdown.find(b => b.code === 'BULKY');
    expect(bulky?.amount).toBe(21.00);
  });

  it('Scenariusz 8: Penalty WEIGHT_CORR_10_20 NIE pojawia sie w breakdown', async () => {
    const input = {
      contract: mockContract,
      priceList: mockPriceList,
      carrierId: 'dhl_at',
      destCountry: 'DE',
      weight: 5,
      date: new Date('2026-04-15'),
      optionalServices: ['WEIGHT_CORR_10_20'], // Even if it was somehow in optional
      serviceCode: 'STANDARD' as const,
    };
    const res = await calculateProviderCost(input);
    expect(res.breakdown.some(b => b.code.startsWith('WEIGHT_CORR'))).toBe(false);
  });
});
