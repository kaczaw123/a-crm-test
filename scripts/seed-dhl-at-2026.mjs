import fs from 'fs';
import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'gep-a-crm' });
}
const db = admin.firestore();
const ts = () => admin.firestore.FieldValue.serverTimestamp();
const toTs = (iso) => admin.firestore.Timestamp.fromDate(new Date(iso));

// Deterministyczne ID — pozwala uruchamiać seed wielokrotnie bez duplikatów
const CARRIER_ID = 'dhl_at';
const CONTRACT_ID = 'dhl_at_2026';
const PRICELIST_IDS = {
  'DHL Paket Germany 2026':       'dhl_at_2026__de_domestic_v1',
  'DHL Paket International 2026': 'dhl_at_2026__de_international_v1'
};

async function main() {
  const path = 'data/carriers/dhl-at-2026-pricelist.json';
  if (!fs.existsSync(path)) {
    console.error(`Brak pliku ${path}. Uruchom skrypt z roota repo.`);
    process.exit(1);
  }
  const { carrier, contract, priceLists } = JSON.parse(fs.readFileSync(path, 'utf8'));

  // 1. Carrier — set+merge na deterministycznym ID
  console.log(`[1/3] Carrier ${CARRIER_ID}...`);
  await db.collection('carriers').doc(CARRIER_ID).set({
    code: carrier.code,
    displayName: carrier.displayName,
    country: carrier.country,
    apiIntegrationType: carrier.apiIntegrationType ?? null,
    surchargeUrl: carrier.surchargeUrl ?? null,
    active: carrier.active !== false,
    updatedAt: ts(),
    updatedBy: 'seed-script'
  }, { merge: true });

  // 2. Contract — set+merge + 5 nowych pól metadanych
  console.log(`[2/3] Contract ${CONTRACT_ID}...`);
  const contractRef = db.collection('carrierContracts').doc(CONTRACT_ID);
  const existingContract = await contractRef.get();
  await contractRef.set({
    carrierId: CARRIER_ID,
    validFrom: toTs(contract.validFrom),
    validTo: contract.validTo ? toTs(contract.validTo) : null,
    contractFileUrl: contract.contractFileUrl ?? null,
    notes: contract.notes ?? '',
    status: contract.status ?? 'active',
    originCountry: contract.originCountry ?? null,
    injectionPoint: contract.injectionPoint ?? null,
    contractEntity: contract.contractEntity ?? null,
    contractRef: contract.contractRef ?? null,
    ekp: contract.ekp ?? null,
    version: contract.version ?? 1,
    ...(existingContract.exists ? {} : { createdAt: ts(), createdBy: 'seed-script' }),
    updatedAt: ts(),
    updatedBy: 'seed-script'
  }, { merge: true });

  // 3. PriceLists — deterministyczne ID + name
  console.log(`[3/3] PriceLists...`);
  for (const pl of priceLists) {
    const plId = PRICELIST_IDS[pl.name];
    if (!plId) {
      console.warn(`  ! Brak deterministycznego ID dla "${pl.name}" — pomijam.`);
      continue;
    }
    const plRef = contractRef.collection('priceLists').doc(plId);
    const existingPL = await plRef.get();
    await plRef.set({
      name: pl.name,
      validFrom: toTs(pl.validFrom),
      validTo: pl.validTo ? toTs(pl.validTo) : null,
      prices: pl.prices,
      services: pl.services ?? [],
      version: pl.version ?? 1,
      ...(existingPL.exists ? {} : { createdAt: ts(), createdBy: 'seed-script' }),
      updatedAt: ts(),
      updatedBy: 'seed-script'
    }, { merge: true });
    console.log(`  ✓ ${plId}: ${pl.prices.length} cen, ${pl.services?.length ?? 0} usług`);
  }

  console.log('\n--- SEED OK ---');
  console.log(`  Carrier:    carriers/${CARRIER_ID}`);
  console.log(`  Contract:   carrierContracts/${CONTRACT_ID}`);
  console.log(`  PriceLists: ${Object.values(PRICELIST_IDS).join(', ')}`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
