import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
// We assume GCLOUD_PROJECT is already set or the demo project parses from firebaserc. If not, it falls back to demo-test
if (!process.env.GCLOUD_PROJECT) {
  process.env.GCLOUD_PROJECT = 'a-cmr-396a8';
}

initializeApp();
const db = getFirestore();
const companyId = 'test-perf-company';

async function seedProducts(count) {
  console.log(`Seeding ${count} products to company: ${companyId}...`);
  const productsRef = db.collection(`companies/${companyId}/products`);
  
  let batch = db.batch();
  let ops = 0;
  let totalCommitted = 0;

  for (let i = 1; i <= count; i++) {
    const docRef = productsRef.doc(`perf-prod-${i}`);
    batch.set(docRef, {
      productId: `perf-prod-${i}`,
      name: `Syntetyczny Produkt ${i}`,
      nameNormalized: `syntetycznyprodukt${i}`,
      sku: `SKU-${i}`,
      skuExact: `SKU-${i}`,
      ean: `EAN-${i}`,
      eanExact: `EAN-${i}`,
      source: 'perf-test',
      updatedAt: FieldValue.serverTimestamp(),
      isActive: true,
      logistics: { weight: 1.5, length: 10, width: 20, height: 30 }
    });
    
    ops++;
    
    if (ops === 400) {
      await batch.commit();
      totalCommitted += ops;
      console.log(`Committed ${totalCommitted}/${count}...`);
      batch = db.batch();
      ops = 0;
    }
  }
  
  if (ops > 0) {
    await batch.commit();
    totalCommitted += ops;
    console.log(`Committed ${totalCommitted}/${count}...`);
  }
  console.log('Seeding finished.');
}

async function testQueryByLimit(limitCount) {
  const start = performance.now();
  const snap = await db.collection(`companies/${companyId}/products`)
    .orderBy('updatedAt', 'desc')
    .limit(limitCount)
    .get();
  const end = performance.now();
  console.log(`[Paginacja] Pobranie pierwszych ${limitCount} rekordów zajęło: ${(end - start).toFixed(2)} ms. Odebrano: ${snap.size}`);
}

async function testSearch(field, val) {
  const start = performance.now();
  const snap = await db.collection(`companies/${companyId}/products`)
    .where(field, '==', val)
    .limit(50)
    .get();
  const end = performance.now();
  console.log(`[Wyszukiwanie] Query gdzie ${field} == '${val}' zajęło: ${(end - start).toFixed(2)} ms. Odnaleziono: ${snap.size}`);
}

async function run() {
  console.log('--- STARTING PERFORMANCE TEST ---');
  // First clear old
  const oldSnap = await db.collection(`companies/${companyId}/products`).limit(1).get();
  if (oldSnap.empty) {
    await seedProducts(5000);
  } else {
    console.log('Products already seeded.');
  }
  
  console.log('\n--- WYNIKI TESTÓW WYDAJNOŚCIOWYCH ---');
  await testQueryByLimit(50);
  await testQueryByLimit(100);
  await testQueryByLimit(500);
  await testQueryByLimit(1000);
  await testQueryByLimit(4000);
  
  await testSearch('skuExact', 'SKU-2500');
  await testSearch('eanExact', 'EAN-4999');
  
  process.exit(0);
}

run().catch(console.error);
