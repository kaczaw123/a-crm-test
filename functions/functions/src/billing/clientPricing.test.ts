import { describe, it, expect } from 'vitest';
import { applyMarkup } from './priceCalculator';

describe('applyMarkup (3 modes)', () => {
  const mockCost: any = { breakdown: [{ code: 'BASE', amount: 8.26 }], total: 8.26, currency: 'EUR' };

  it('cost_plus_percent: 25% na cost 8.26 → priceToClient 10.33', () => {
    const result = applyMarkup(mockCost, null, { mode: 'cost_plus_percent', value: 25 });
    expect(result.markup).toBe(2.07);
    expect(result.total).toBe(10.33);
    expect(result.mode).toBe('cost_plus_percent');
  });

  it('cost_plus_fixed: 2.00 na cost 8.26 → priceToClient 10.26', () => {
    const result = applyMarkup(mockCost, null, { mode: 'cost_plus_fixed', value: 2.00 });
    expect(result.markup).toBe(2.00);
    expect(result.total).toBe(10.26);
    expect(result.mode).toBe('cost_plus_fixed');
  });

  it('absolute_table → throw Error', () => {
    expect(() => applyMarkup(mockCost, null, { mode: 'absolute_table' })).toThrow('absolute_table');
  });

  it('shippingPricing null → no_markup fallback', () => {
    const result = applyMarkup(mockCost, null, null);
    expect(result.markup).toBe(0);
    expect(result.total).toBe(8.26);
    expect(result.mode).toBe('no_markup');
  });
});

describe('applyMarkup - Granular per-service (new)', () => {
  const multiCost: any = { 
    breakdown: [
      { code: 'BASE', amount: 8.26 },
      { code: 'COD', amount: 2.00 },
      { code: 'ENERGY_SURCHARGE', amount: 1.00 }
    ], 
    total: 11.26, 
    currency: 'EUR' 
  };

  it('5. priceListPricing.baseMode=cost_plus_percent, baseValue=25, brak overrides', () => {
    const result = applyMarkup(multiCost, { baseMode: 'cost_plus_percent', baseValue: 25 }, null);
    // 10.325 + 2.5 + 1.25 = 14.075 -> 14.08
    expect(result.total).toBe(14.08);
    expect(result.markup).toBe(2.82); // 14.08 - 11.26 = 2.82
    expect(result.breakdownWithMarkup[0].clientAmount).toBe(10.33);
    expect(result.breakdownWithMarkup[1].clientAmount).toBe(2.50);
    expect(result.breakdownWithMarkup[2].clientAmount).toBe(1.25);
  });

  it('6. baseValue=25 + serviceOverrides[COD]={mode:no_markup, value:0}', () => {
    const result = applyMarkup(multiCost, { 
      baseMode: 'cost_plus_percent', baseValue: 25, 
      serviceOverrides: { 'COD': { mode: 'no_markup', value: 0 } } 
    }, null);
    // 10.325 + 2.0 + 1.25 = 13.575 -> 13.58
    expect(result.total).toBe(13.58);
    expect(result.markup).toBe(2.32); // 13.58 - 11.26 = 2.32
    expect(result.breakdownWithMarkup.find((b: any) => b.code === 'COD').clientAmount).toBe(2.00);
  });

  it('7. baseValue=25 + serviceOverrides[ENERGY_SURCHARGE]={mode:cost_plus_fixed, value:1.0}', () => {
    const result = applyMarkup(multiCost, { 
      baseMode: 'cost_plus_percent', baseValue: 25, 
      serviceOverrides: { 'ENERGY_SURCHARGE': { mode: 'cost_plus_fixed', value: 1.0 } } 
    }, null);
    // 10.325 + 2.5 + 2.0 = 14.825 -> 14.83
    expect(result.total).toBe(14.83);
    expect(result.markup).toBe(3.57); // 14.83 - 11.26 = 3.57
    expect(result.breakdownWithMarkup.find((b: any) => b.code === 'ENERGY_SURCHARGE').clientAmount).toBe(2.00);
  });

  it('8. priceListPricing=null + fallback {mode:cost_plus_fixed, value:2.0} -> PER-TOTAL', () => {
    const result = applyMarkup(multiCost, null, { mode: 'cost_plus_fixed', value: 2.0 });
    expect(result.total).toBe(13.26); // 11.26 + 2.0 = 13.26
    expect(result.markup).toBe(2.00);
    expect(result.mode).toBe('cost_plus_fixed');
  });
});
