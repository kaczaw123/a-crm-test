import React from 'react';
import type { CarrierPriceList } from '../../../types/billing';
import type { PriceListPricing, MarkupMode } from '../../../types/clientPricing';

interface Props {
  priceListId: string;
  priceList: CarrierPriceList;
  pricing: PriceListPricing | undefined;
  onChange: (pricing: PriceListPricing) => void;
}

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

export const ClientPriceListCard: React.FC<Props> = ({ priceListId, priceList, pricing, onChange }) => {
  const baseMode = pricing?.baseMode || 'cost_plus_percent';
  const baseValue = pricing?.baseValue ?? 0;
  
  const surchargesMode = pricing?.surchargesMode || baseMode;
  const surchargesValue = pricing?.surchargesValue ?? baseValue;

  const overrides = pricing?.serviceOverrides || {};

  const handleBaseChange = (mode: MarkupMode, value: number) => {
    onChange({
      baseMode: mode,
      baseValue: value,
      surchargesMode,
      surchargesValue,
      serviceOverrides: overrides
    });
  };

  const handleSurchargesBaseChange = (mode: MarkupMode, value: number) => {
    onChange({
      baseMode,
      baseValue,
      surchargesMode: mode,
      surchargesValue: value,
      serviceOverrides: overrides
    });
  };

  const handleOverrideChange = (code: string, mode: MarkupMode, value: number) => {
    const newOverrides = { ...overrides };
    newOverrides[code] = { mode, value };
    onChange({ baseMode, baseValue, surchargesMode, surchargesValue, serviceOverrides: newOverrides });
  };

  const handleRemoveOverride = (code: string) => {
    const newOverrides = { ...overrides };
    delete newOverrides[code];
    onChange({ baseMode, baseValue, surchargesMode, surchargesValue, serviceOverrides: newOverrides });
  };

  const handleDirectClientPriceChange = (code: string, valStr: string) => {
    if (valStr === '') {
      handleRemoveOverride(code);
      return;
    }
    const val = parseFloat(valStr);
    if (!isNaN(val)) {
      handleOverrideChange(code, 'absolute_fixed', val);
    }
  };

  return (
    <div className="bg-white shadow rounded-lg border border-gray-200 overflow-hidden mb-6">
      <div className="bg-gray-50 border-b border-gray-200 p-4">
        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <span className="material-symbols-outlined text-indigo-600">local_shipping</span>
          {priceList.name || priceListId}
        </h3>
        <p className="text-xs text-gray-500 uppercase tracking-widest mt-1">ID: {priceListId}</p>
      </div>

      <div className="p-4 border-b border-gray-100 bg-blue-50/30 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row items-center gap-4">
          <div className="w-full md:w-1/3">
            <h4 className="font-semibold text-gray-800 mb-1 text-sm">Główny narzut (Ceny Bazowe)</h4>
            <select
              className="w-full border-gray-300 rounded-md shadow-sm text-sm"
              value={baseMode}
              onChange={(e) => handleBaseChange(e.target.value as MarkupMode, baseValue)}
            >
              <option value="cost_plus_percent">Procentowy (+X%)</option>
              <option value="cost_plus_fixed">Stała kwota (+X EUR)</option>
              <option value="no_markup">Brak marży (0%)</option>
            </select>
          </div>
          <div className="w-full md:w-2/3 flex items-center gap-4 md:mt-6">
            {baseMode === 'cost_plus_percent' && (
              <input type="range" min="0" max="100" className="flex-1" value={baseValue} onChange={(e) => handleBaseChange(baseMode, parseFloat(e.target.value))} />
            )}
            <input type="number" step="0.01" className="w-24 border-gray-300 rounded-md shadow-sm text-sm" value={baseValue} onChange={(e) => handleBaseChange(baseMode, parseFloat(e.target.value))} disabled={baseMode === 'no_markup'} />
            <span className="text-sm font-medium text-gray-600">{baseMode === 'cost_plus_percent' ? '%' : baseMode === 'cost_plus_fixed' ? priceList.prices[0]?.currency || 'EUR' : ''}</span>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-4 border-t border-blue-100 pt-4">
          <div className="w-full md:w-1/3">
            <h4 className="font-semibold text-gray-800 mb-1 text-sm">Narzut (Opłaty Dodatkowe)</h4>
            <select
              className="w-full border-gray-300 rounded-md shadow-sm text-sm"
              value={surchargesMode}
              onChange={(e) => handleSurchargesBaseChange(e.target.value as MarkupMode, surchargesValue)}
            >
              <option value="cost_plus_percent">Procentowy (+X%)</option>
              <option value="cost_plus_fixed">Stała kwota (+X EUR)</option>
              <option value="no_markup">Brak marży (0%)</option>
            </select>
          </div>
          <div className="w-full md:w-2/3 flex items-center gap-4 md:mt-6">
            {surchargesMode === 'cost_plus_percent' && (
              <input type="range" min="0" max="100" className="flex-1" value={surchargesValue} onChange={(e) => handleSurchargesBaseChange(surchargesMode, parseFloat(e.target.value))} />
            )}
            <input type="number" step="0.01" className="w-24 border-gray-300 rounded-md shadow-sm text-sm" value={surchargesValue} onChange={(e) => handleSurchargesBaseChange(surchargesMode, parseFloat(e.target.value))} disabled={surchargesMode === 'no_markup'} />
            <span className="text-sm font-medium text-gray-600">{surchargesMode === 'cost_plus_percent' ? '%' : surchargesMode === 'cost_plus_fixed' ? priceList.prices[0]?.currency || 'EUR' : ''}</span>
          </div>
        </div>
      </div>

      <div className="p-4">
        <h4 className="font-semibold text-gray-800 mb-3 text-sm">Ceny Bazowe (Wagi)</h4>
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Waga paczki / Strefa</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Cena Netto (Koszty)</th>
                <th className="px-4 py-2 text-center font-medium text-indigo-700 w-64">Indywidualna marża (Override)</th>
                <th className="px-4 py-2 text-right font-medium text-indigo-700 w-32">Cena Klienta</th>
                <th className="px-4 py-2 text-right font-medium text-green-600 bg-green-50/50 w-24">Zysk</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {priceList.prices.map((p, idx) => {
                const code = `BASE_${p.zoneCode}_${p.weightTo}_${p.serviceCode || 'STANDARD'}`;
                const override = overrides[code];
                const activeMode = override ? override.mode : baseMode;
                const activeValue = override ? override.value : baseValue;

                const clientPrice = applyMode(p.basePrice, activeMode, activeValue);
                const profit = clientPrice - p.basePrice;
                return (
                  <tr key={idx} className={`hover:bg-gray-50 ${override ? 'bg-yellow-50/30' : ''}`}>
                    <td className="px-4 py-2 text-gray-900 font-medium">
                      Do {p.weightTo} kg <span className="text-gray-400 font-normal text-xs ml-1">({p.zoneCode})</span>
                      {p.serviceCode !== 'STANDARD' && <span className="text-xs text-gray-400 ml-1">[{p.serviceCode}]</span>}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">
                      {p.basePrice.toFixed(2)} {p.currency}
                      {p.pricePerKg ? <span className="text-xs ml-1">+ {p.pricePerKg}/kg</span> : ''}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-1">
                        <div className="flex gap-1">
                          <select
                            className="w-1/2 border-gray-300 rounded text-xs py-1 px-2"
                            value={override ? override.mode : 'inherit'}
                            onChange={(e) => {
                              if (e.target.value === 'inherit') handleRemoveOverride(code);
                              else handleOverrideChange(code, e.target.value as MarkupMode, override?.value || 0);
                            }}
                          >
                            <option value="inherit">Dziedzicz z sekcji</option>
                            <option value="absolute_fixed">Stała Cena</option>
                            <option value="no_markup">Bez marży</option>
                            <option value="cost_plus_percent">Procent (+X%)</option>
                            <option value="cost_plus_fixed">Narzut (+X)</option>
                          </select>
                          {override && override.mode !== 'no_markup' && (
                            <input
                              type="number"
                              step="0.01"
                              className="w-1/2 border-gray-300 rounded text-xs py-1 px-2"
                              value={override.value}
                              onChange={(e) => handleOverrideChange(code, override.mode, parseFloat(e.target.value))}
                            />
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end">
                        <input
                          type="number"
                          step="0.01"
                          className={`w-20 text-right border-gray-300 rounded text-sm py-1 px-2 font-bold ${override ? 'text-indigo-600 bg-indigo-50 border-indigo-300' : 'text-gray-900'}`}
                          value={clientPrice.toFixed(2)}
                          onChange={(e) => handleDirectClientPriceChange(code, e.target.value)}
                          title="Możesz wpisać nową cenę dla klienta"
                        />
                        <span className="text-xs ml-1 text-gray-500">{p.currency}</span>
                      </div>
                      {p.pricePerKg ? <div className="text-xs text-gray-500 mt-1 mr-8">+ {applyMode(p.pricePerKg, activeMode, activeValue).toFixed(2)}/kg</div> : ''}
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-green-600 bg-green-50/20">
                      {profit.toFixed(2)} {p.currency}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="p-4 pt-0">
        <h4 className="font-semibold text-gray-800 mb-3 text-sm">Opłaty Stałe i Dodatkowe (Surcharges)</h4>
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Nazwa usługi</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Koszty netto</th>
                <th className="px-4 py-2 text-center font-medium text-indigo-700 w-64">Indywidualna marża (Override)</th>
                <th className="px-4 py-2 text-right font-medium text-indigo-700 w-32">Cena Klienta</th>
                <th className="px-4 py-2 text-right font-medium text-green-600 bg-green-50/50 w-24">Zysk</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {priceList.services?.filter(svc => svc.category !== 'base').map((svc, idx) => {
                const override = overrides[svc.code];
                const activeMode = override ? override.mode : surchargesMode;
                const activeValue = override ? override.value : surchargesValue;
                
                let providerVal = 0;
                let isPercent = false;
                if (svc.type === 'flat' && svc.basePrice != null) { providerVal = svc.basePrice; }
                else if (svc.type === 'percent' && svc.percent != null) { providerVal = svc.percent; isPercent = true; }

                const clientVal = applyMode(providerVal, activeMode, activeValue);
                const profit = clientVal - providerVal;

                return (
                  <tr key={idx} className={`hover:bg-gray-50 ${override ? 'bg-yellow-50/30' : ''}`}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-900">{svc.name}</div>
                      <div className="text-xs text-gray-500">{svc.code}</div>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">
                      {providerVal > 0 ? (isPercent ? `${providerVal}%` : `${providerVal.toFixed(2)} EUR`) : 'Zmienne'}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-col gap-1">
                        <div className="flex gap-1">
                          <select
                            className="w-1/2 border-gray-300 rounded text-xs py-1 px-2"
                            value={override ? override.mode : 'inherit'}
                            onChange={(e) => {
                              if (e.target.value === 'inherit') handleRemoveOverride(svc.code);
                              else handleOverrideChange(svc.code, e.target.value as MarkupMode, override?.value || 0);
                            }}
                          >
                            <option value="inherit">Dziedzicz z sekcji</option>
                            <option value="absolute_fixed">Stała Cena</option>
                            <option value="no_markup">Bez marży</option>
                            <option value="cost_plus_percent">Procent (+X%)</option>
                            <option value="cost_plus_fixed">Narzut (+X)</option>
                          </select>
                          {override && override.mode !== 'no_markup' && (
                            <input
                              type="number"
                              step="0.01"
                              className="w-1/2 border-gray-300 rounded text-xs py-1 px-2"
                              value={override.value}
                              onChange={(e) => handleOverrideChange(svc.code, override.mode, parseFloat(e.target.value))}
                            />
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {providerVal > 0 || override ? (
                        <div className="flex items-center justify-end">
                          <input
                            type="number"
                            step="0.01"
                            className={`w-20 text-right border-gray-300 rounded text-sm py-1 px-2 font-bold ${override ? 'text-indigo-600 bg-indigo-50 border-indigo-300' : 'text-gray-900'}`}
                            value={clientVal.toFixed(2)}
                            onChange={(e) => handleDirectClientPriceChange(svc.code, e.target.value)}
                            title="Możesz wpisać nową cenę dla klienta"
                          />
                          <span className="text-xs ml-1 text-gray-500">{isPercent ? '%' : 'EUR'}</span>
                        </div>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-medium text-green-600 bg-green-50/20">
                      {(providerVal > 0 || override) ? `${profit.toFixed(2)} ${isPercent ? '%' : 'EUR'}` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
