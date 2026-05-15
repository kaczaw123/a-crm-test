import { readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const PROJECT_ID = 'gep-a-crm';
const COMPANY_ID = '72vZTnE7PhK7pHSWLpFr';
const SHIPMENT_ID = 'DGKwShaDYabHjPHdB621';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const config = JSON.parse(readFileSync(path.join(homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf-8'));
const token = config.tokens.access_token;

function val(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue);
  if ('doubleValue' in v) return parseFloat(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  return JSON.stringify(v);
}
function parse(doc) {
  const id = doc.name?.split('/').pop();
  return { _id: id, ...Object.fromEntries(Object.entries(doc.fields || {}).map(([k,v]) => [k, val(v)])) };
}

async function runQuery(parent, collectionId, filters = []) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/${parent.replace('/documents','')}/documents:runQuery`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId }],
          where: filters.length === 1 ? { fieldFilter: filters[0] } : filters.length > 1 ? { compositeFilter: { op: 'AND', filters: filters.map(f => ({ fieldFilter: f })) } } : undefined
        },
        parent
      })
    }
  );
  const data = await res.json();
  return data.filter(d => d.document).map(d => parse(d.document));
}

async function get(path) {
  const res = await fetch(`${BASE_URL}/${path}`, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0,200)}`);
  return parse(await res.json());
}

async function list(path) {
  const res = await fetch(`${BASE_URL}/${path}`, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0,200)}`);
  const data = await res.json();
  return (data.documents || []).map(parse);
}

async function main() {
  const PARENT = `projects/${PROJECT_ID}/databases/(default)/documents/companies/${COMPANY_ID}`;

  // 1. Wszystkie inventoryStock
  console.log('=== inventoryStock (all docs) ===');
  const stocks = await list(`companies/${COMPANY_ID}/inventoryStock`);
  console.log(`Total: ${stocks.length}`);
  for (const s of stocks) {
    console.log(`  stockId: ${s._id}`);
    console.log(`    productId: "${s.productId}"`);
    console.log(`    sku:       "${s.sku}"`);
    console.log(`    qtyOnHand: ${s.qtyOnHand}`);
  }

  // 2. Wszystkie inventoryMovements dla tej awizacji
  console.log('\n=== inventoryMovements dla awizacji (referenceId == SHIPMENT_ID) ===');
  const movements = await runQuery(PARENT, 'inventoryMovements', [
    { field: { fieldPath: 'referenceId' }, op: 'EQUAL', value: { stringValue: SHIPMENT_ID } }
  ]);
  console.log(`Total movements for shipment: ${movements.length}`);
  for (const m of movements) {
    console.log(`  movId: ${m._id} | type: ${m.type} | productId: "${m.productId}" | qty: ${m.quantity}`);
  }

  // 3. Wszystkie inventoryMovements ogółem — ile jest i jakie productId?
  console.log('\n=== inventoryMovements — WSZYSTKIE (max 20) ===');
  const allMovements = await runQuery(PARENT, 'inventoryMovements', []);
  console.log(`Total movements in collection: ${allMovements.length}`);
  for (const m of allMovements.slice(0, 20)) {
    console.log(`  movId: ${m._id} | type: ${m.type} | productId: "${m.productId}" | referenceId: ${m.referenceId} | qty: ${m.quantity}`);
  }

  // 4. Jeden konkretny stock doc - pokaż wszystkie pola
  console.log('\n=== inventoryStock doc: 7S_KIS_BK_SSYS_NJDqRfQi5pWCNG1mj6Na ===');
  try {
    const s = await get(`companies/${COMPANY_ID}/inventoryStock/7S_KIS_BK_SSYS_NJDqRfQi5pWCNG1mj6Na`);
    console.log(JSON.stringify(s, null, 2));
  } catch(e) { console.log('Error:', e.message); }
}

main().catch(console.error);
