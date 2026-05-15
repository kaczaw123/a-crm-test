import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const seedGlsPricing = onRequest({ region: 'europe-west1' }, async (req, res) => {
  const db = admin.firestore();

  try {
    // 1. Dodaj / zaktualizuj przewoźnika GLS DE
    const carrierRef = db.collection('carriers').doc('gls_de');
    await carrierRef.set({
      id: 'gls_de',
      code: 'GLS',
      displayName: 'GLS Germany',
      country: 'DE',
      apiIntegrationType: 'gls_de',
      surchargeUrl: 'https://gls-group.com/DE/de/dieselzuschlag/',
      active: true,
      updatedAt: new Date(),
      updatedBy: 'system-seed'
    }, { merge: true });

    // 2. Kontrakt GLS
    const contractRef = carrierRef.collection('contracts').doc('default');
    await contractRef.set({
      id: 'default',
      carrierId: 'gls_de',
      validFrom: new Date('2026-01-01T00:00:00Z'),
      status: 'active',
      version: 1,
      originCountry: 'PL',
      injectionPoint: 'Hub 02827 Görlitz, DE',
      contractEntity: 'GLS Germany GmbH & Co. OHG',
      contractRef: '1-16UHLAG',
      ekp: '2760342438',
      updatedAt: new Date(),
      updatedBy: 'system-seed'
    }, { merge: true });

    // 3. Cennik GLS
    const priceListRef = contractRef.collection('priceLists').doc('2026');
    
    const prices = [
      { zoneCode: 'DE', weightFrom: 0, weightTo: 2, basePrice: 4.15, currency: 'EUR', serviceCode: 'BP' },
      { zoneCode: 'DE', weightFrom: 2.01, weightTo: 3, basePrice: 4.47, currency: 'EUR', serviceCode: 'BP' },
      { zoneCode: 'DE', weightFrom: 3.01, weightTo: 5, basePrice: 5.79, currency: 'EUR', serviceCode: 'BP' },
      { zoneCode: 'DE', weightFrom: 5.01, weightTo: 8, basePrice: 5.79, currency: 'EUR', serviceCode: 'BP' },
      { zoneCode: 'DE', weightFrom: 8.01, weightTo: 10, basePrice: 6.92, currency: 'EUR', serviceCode: 'BP' },
      { zoneCode: 'DE', weightFrom: 10.01, weightTo: 15, basePrice: 6.92, currency: 'EUR', serviceCode: 'BP' },
      { zoneCode: 'DE', weightFrom: 15.01, weightTo: 20, basePrice: 8.08, currency: 'EUR', serviceCode: 'BP' },
      { zoneCode: 'DE', weightFrom: 20.01, weightTo: 25, basePrice: 9.46, currency: 'EUR', serviceCode: 'BP' },
      { zoneCode: 'DE', weightFrom: 25.01, weightTo: 31.5, basePrice: 25.59, currency: 'EUR', serviceCode: 'BP' },
      { zoneCode: 'DE', weightFrom: 31.51, weightTo: 40, basePrice: 43.07, currency: 'EUR', serviceCode: 'BP' },
      
      // Można tutaj dodać strefy EuroBusinessParcel (AT, NL, etc.)
      { zoneCode: 'AT', weightFrom: 0, weightTo: 2, basePrice: 9.99, currency: 'EUR', serviceCode: 'EBP' },
      { zoneCode: 'AT', weightFrom: 2.01, weightTo: 5, basePrice: 10.71, currency: 'EUR', serviceCode: 'EBP' },
      { zoneCode: 'AT', weightFrom: 5.01, weightTo: 10, basePrice: 12.24, currency: 'EUR', serviceCode: 'EBP' },
    ];

    const services = [
      { code: 'BASE', name: 'Opłata Podstawowa', category: 'mandatory', type: 'flat' },
      { code: 'MAUT_DE', name: 'Maut Verkehr National', category: 'mandatory', type: 'flat', basePrice: 0.47, conditions: { domesticOnly: true } },
      { code: 'MAUT_INTL', name: 'Maut Verkehr International', category: 'mandatory', type: 'percent', percent: 6.4, applyTo: 'base', conditions: { intlOnly: true } },
      { code: 'WEIGHING', name: 'Weighing Service', category: 'mandatory', type: 'flat', basePrice: 0.54 },
      { code: 'RESIDENTIAL', name: 'Zustellung Privatadresse', category: 'optional', type: 'flat', basePrice: 0.27 },
      { code: 'NSG', name: 'Nie sorterowalne (NSG)', category: 'optional', type: 'flat', basePrice: 5.40 },
      { code: 'ENERGY_SURCHARGE', name: 'Energie (Stała)', category: 'mandatory', type: 'percent', percent: 13.30, applyTo: 'base' },
      { code: 'FUEL_SURCHARGE', name: 'Diesel Floater', category: 'mandatory', type: 'variable_external', applyTo: 'base', externalSource: 'diesel_floater' },
      { code: 'KLIMA_PROTECT', name: 'KlimaProtect', category: 'mandatory', type: 'percent', percent: 3.65, applyTo: 'base' },
      { code: 'PEAK_SURCHARGE', name: 'Black Week / Saison', category: 'conditional', type: 'percent', percent: 7.30, applyTo: 'base', conditions: { dateRange: { fromMonth: 11, toMonth: 12 } } },
    ];

    await priceListRef.set({
      id: '2026',
      name: 'GLS Konditionen 2026',
      validFrom: new Date('2026-01-01T00:00:00Z'),
      prices,
      services,
      version: 1,
      updatedAt: new Date(),
      updatedBy: 'system-seed'
    }, { merge: true });

    res.status(200).send('GLS Pricing seeded successfully!');
  } catch (error: any) {
    console.error(error);
    res.status(500).send('Error seeding GLS Pricing: ' + error.message);
  }
});
