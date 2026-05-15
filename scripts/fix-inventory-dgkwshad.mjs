/**
 * FIX SCRIPT: Naprawa inventoryStock dla awizacji DGKwShaDYabHjPHdB621
 * Firma: SEVEN SUNDAYS Deutschland GmbH (companyId: 72vZTnE7PhK7pHSWLpFr)
 * 
 * Problem: Wszystkie 7 SKU miały productId=null, przez co powstał 1 błędny dokument
 * stockId: null_NJDqRfQi5pWCNG1mj6Na zamiast osobnego dla każdego SKU.
 * 
 * Skrypt:
 * 1. Wyszukuje realny productId dla każdego SKU w katalogu produktów
 * 2. Tworzy poprawne dokumenty inventoryStock dla każdego SKU
 * 3. Usuwa błędny dokument null_NJDqRfQi5pWCNG1mj6Na
 * 4. Naprawia productId w inventoryMovements
 * 
 * Uruchom: node scripts/fix-inventory-dgkwshad.mjs
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const PROJECT_ID = 'gep-a-crm';
const COMPANY_ID = '72vZTnE7PhK7pHSWLpFr';
const SHIPMENT_ID = 'DGKwShaDYabHjPHdB621';
const WAREHOUSE_ID = 'NJDqRfQi5pWCNG1mj6Na';
const WAREHOUSE_CODE = 'MG-1';
const CORRUPT_STOCK_ID = `null_${WAREHOUSE_ID}`;

const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Token z Firebase CLI configstore
const configPath = path.join(homedir(), '.config', 'configstore', 'firebase-tools.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const token = config.tokens.access_token;
const expiresAt = new Date(config.tokens.expires_at);

console.log(`Token expires: ${expiresAt.toISOString()}`);
if (expiresAt < new Date()) {
  console.error('Token wygasł! Uruchom ponownie firebase login i spróbuj jeszcze raz.');
  process.exit(1);
}

async function get(path) {
  const url = `${BASE_URL}/${path}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function patch(path, fields) {
  const fieldList = Object.keys(fields).join(',');
  const url = `${BASE_URL}/${path}?updateMask.fieldPaths=${fieldList.split(',').join('&updateMask.fieldPaths=')}`;
  const body = JSON.stringify({ fields });
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body
  });
  if (!res.ok) throw new Error(`PATCH ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function create(path, fields) {
  // POST to parent collection to create with specific ID we use PATCH with ?currentDocument.exists=false
  const url = `${BASE_URL}/${path}`;
  const body = JSON.stringify({ fields });
  const res = await fetch(`${url}?currentDocument.exists=false`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body
  });
  if (!res.ok) throw new Error(`CREATE ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function del(path) {
  const url = `${BASE_URL}/${path}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok && res.status !== 404) throw new Error(`DELETE ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status;
}

function val(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('doubleValue' in v) return parseFloat(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k,v2]) => [k, val(v2)]));
  return JSON.stringify(v);
}
function parse(doc) {
  const id = doc.name?.split('/').pop();
  return { _id: id, ...Object.fromEntries(Object.entries(doc.fields || {}).map(([k,v]) => [k, val(v)])) };
}

// Firestore value helpers
function strVal(s) { return { stringValue: s ?? '' }; }
function numVal(n) { return { doubleValue: Number(n) || 0 }; }
function intVal(n) { return { integerValue: String(Math.round(Number(n) || 0)) }; }
function nullVal() { return { nullValue: null }; }
function tsVal() { return { timestampValue: new Date().toISOString() }; }

// Data for all 7 items (from fetch script output)
const items = [
  { itemId: '4GFlMTQgGRTmP63ZV29B', sku: '7S_KIS_SK_SSYS',  name: 'Seitenschläferkissen',      receivedQty: 72,  expectedQty: 72 },
  { itemId: 'CwzIGsNBRdWATN85eUj7', sku: '7S_KIS_NK_SSYS',  name: 'Nackenkissen',               receivedQty: 136, expectedQty: 136 },
  { itemId: 'FrnXJsQA3lvCVZWhWCqE', sku: '7S_KIS_RK_BEZ',   name: 'Reisekissen Bezug',           receivedQty: 26,  expectedQty: 1 },
  { itemId: 'c7eK7b0v8di7q03YmMrC', sku: '7S_KIS_RTA',      name: 'Kissentasche',                receivedQty: 64,  expectedQty: 64 },
  { itemId: 'in04CZTuls14BTneCjci', sku: '7S_KIS_RK_SSYS',  name: 'Reisekissen',                 receivedQty: 39,  expectedQty: 39 },
  { itemId: 'sxpYpKGCXzlBkbOEKECX', sku: '7S_KIS_SK_BEZ',  name: 'Seitenschläferkissen Bezug',  receivedQty: 11,  expectedQty: 11 },
  { itemId: 'ysciQ6g44XEEyO3sld3A', sku: '7S_KIS_BK_SSYS',  name: 'Rücken-Stretch-Kissen',       receivedQty: 54,  expectedQty: 54 },
];

// Company shipment data
const shipmentData = {
  companyName: 'SEVEN SUNDAYS Deutschland GmbH',
  companyNip: '',
};

async function findProductId(sku) {
  try {
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'products' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'sku' },
                op: 'EQUAL',
                value: { stringValue: sku }
              }
            },
            limit: 1
          },
          parent: `projects/${PROJECT_ID}/databases/(default)/documents/companies/${COMPANY_ID}`
        })
      }
    );
    const data = await res.json();
    if (data[0]?.document) {
      return data[0].document.name.split('/').pop();
    }
  } catch(e) {
    console.log(`  [warn] product query failed for ${sku}: ${e.message}`);
  }
  return null;
}

async function main() {
  console.log('\n=== STARTING FIX ===\n');

  // Step 1: Find productIds for all SKUs
  console.log('Step 1: Looking up productIds for each SKU...');
  for (const item of items) {
    item.productId = await findProductId(item.sku);
    console.log(`  ${item.sku} → productId: ${item.productId || 'NOT FOUND (using sku as fallback)'}`);
    if (!item.productId) item.productId = item.sku;
  }

  // Step 2: Get inventory movements for shipment to fix productId
  console.log('\nStep 2: Fetching inventoryMovements for this shipment...');
  let movements = [];
  try {
    const res = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: 'inventoryMovements' }],
            where: {
              compositeFilter: {
                op: 'AND',
                filters: [
                  { fieldFilter: { field: { fieldPath: 'referenceId' }, op: 'EQUAL', value: { stringValue: SHIPMENT_ID } } },
                  { fieldFilter: { field: { fieldPath: 'type' }, op: 'EQUAL', value: { stringValue: 'RECEIPT' } } }
                ]
              }
            }
          },
          parent: `projects/${PROJECT_ID}/databases/(default)/documents/companies/${COMPANY_ID}`
        })
      }
    );
    const data = await res.json();
    movements = data.filter(d => d.document).map(d => parse(d.document));
    console.log(`  Found ${movements.length} RECEIPT movements`);
    for (const m of movements) {
      console.log(`    movId: ${m._id} | productId: ${m.productId} | qty: ${m.quantity}`);
    }
  } catch(e) {
    console.log(`  [warn] Could not fetch movements: ${e.message}`);
  }

  // Step 3: Create correct inventoryStock docs for each SKU
  console.log('\nStep 3: Creating correct inventoryStock documents...');
  for (const item of items) {
    const stockId = `${item.productId}_${WAREHOUSE_ID}`;
    const stockPath = `companies/${COMPANY_ID}/inventoryStock/${stockId}`;
    
    // Check if exists
    let existing = null;
    try {
      const doc = await get(stockPath);
      existing = parse(doc);
    } catch(e) { /* not found */ }

    if (existing) {
      console.log(`  [SKIP] ${stockId} already exists (qty: ${existing.qtyOnHand})`);
      continue;
    }

    const fields = {
      companyId:            strVal(COMPANY_ID),
      companyName:          strVal(shipmentData.companyName),
      companyNip:           strVal(shipmentData.companyNip),
      productId:            strVal(item.productId),
      sku:                  strVal(item.sku),
      productName:          strVal(item.name),
      ean:                  strVal(''),
      qtyOnHand:            intVal(item.receivedQty),
      qtyReserved:          intVal(0),
      qtyAvailable:         intVal(item.receivedQty),
      unitWeightKg:         numVal(0),
      totalWeightKg:        numVal(0),
      unitVolumeM3:         numVal(0),
      totalVolumeM3:        numVal(0),
      warehouseLocationId:  strVal(WAREHOUSE_ID),
      warehouseLocationCode:strVal(WAREHOUSE_CODE),
      receivedFromInboundId:strVal(SHIPMENT_ID),
      lastMovementAt:       tsVal(),
      updatedAt:            tsVal(),
    };

    try {
      await create(stockPath, fields);
      console.log(`  [CREATE] ${stockId} | sku: ${item.sku} | qty: ${item.receivedQty}`);
    } catch(e) {
      console.log(`  [ERROR] Failed to create ${stockId}: ${e.message}`);
    }
  }

  // Step 4: Fix productIds in movements (match by qty)
  console.log('\nStep 4: Fixing productIds in inventoryMovements...');
  const usedMovementIds = new Set();
  for (const item of items) {
    const matchingMovement = movements.find(m =>
      !usedMovementIds.has(m._id) &&
      (m.productId === null || m.productId === 'null') &&
      m.quantity === item.receivedQty
    );
    if (matchingMovement) {
      try {
        const movPath = `companies/${COMPANY_ID}/inventoryMovements/${matchingMovement._id}`;
        await patch(movPath, { productId: strVal(item.productId) });
        usedMovementIds.add(matchingMovement._id);
        console.log(`  [FIX] movement ${matchingMovement._id} → productId: ${item.productId} (sku: ${item.sku})`);
      } catch(e) {
        console.log(`  [ERROR] Failed to patch movement: ${e.message}`);
      }
    } else {
      console.log(`  [SKIP] No unmatched movement found for sku: ${item.sku} (qty: ${item.receivedQty})`);
    }
  }

  // Step 5: Delete corrupted doc
  console.log('\nStep 5: Deleting corrupted stock doc...');
  const corruptPath = `companies/${COMPANY_ID}/inventoryStock/${CORRUPT_STOCK_ID}`;
  try {
    const status = await del(corruptPath);
    console.log(`  [DELETE] ${CORRUPT_STOCK_ID} → HTTP ${status}`);
  } catch(e) {
    console.log(`  [ERROR] Could not delete ${CORRUPT_STOCK_ID}: ${e.message}`);
  }

  console.log('\n=== FIX COMPLETE ===');
  console.log('\nVerification: inventoryStock docs created:');
  for (const item of items) {
    console.log(`  ${item.productId}_${WAREHOUSE_ID} | ${item.sku} | qty: ${item.receivedQty}`);
  }
}

main().catch(console.error);
