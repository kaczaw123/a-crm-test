import { readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const PROJECT_ID = 'gep-a-crm';
const SHIPMENT_ID = 'DGKwShaDYabHjPHdB621';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Read token from Firebase CLI configstore
const configPath = path.join(homedir(), '.config', 'configstore', 'firebase-tools.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));
const token = config.tokens.access_token;

console.log(`Using token (first 30 chars): ${token.slice(0, 30)}...`);
console.log(`Token expires_at: ${new Date(config.tokens.expires_at).toISOString()}\n`);

async function apiGet(path) {
  const url = `${BASE_URL}/${path}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status} for ${path}: ${txt.slice(0, 300)}`);
  }
  return res.json();
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

async function main() {

  // --- 1. List all companies ---
  console.log('=== COMPANIES ===');
  const comps = await apiGet('companies');
  const companies = (comps.documents || []).map(parse);
  for (const c of companies) {
    console.log(`  ID: ${c._id} | name: ${c.name} | email: ${c.email || c.ownerEmail || '-'}`);
  }

  // --- 2. Find companyId for my7sundays ---
  let companyId = null;
  console.log('\n=== Searching for my7sundays company in members ===');
  for (const c of companies) {
    try {
      const membersRes = await apiGet(`companies/${c._id}/members`);
      for (const m of (membersRes.documents || [])) {
        const md = parse(m);
        if ((md.email || '').toLowerCase().includes('my7sundays') || (md.email || '').toLowerCase().includes('erik')) {
          console.log(`  FOUND! companyId=${c._id} member email=${md.email}`);
          companyId = c._id;
          break;
        }
      }
    } catch(e) { /* skip */ }
    if (companyId) break;
  }

  if (!companyId) {
    console.log('  Not found by members — trying all companies with shipment...');
    for (const c of companies) {
      try {
        await apiGet(`companies/${c._id}/inboundShipments/${SHIPMENT_ID}`);
        companyId = c._id;
        console.log(`  Found shipment in company: ${companyId}`);
        break;
      } catch(e) { /* not in this company */ }
    }
  }

  if (!companyId) { console.error('Cannot determine companyId!'); return; }

  // --- 3. Shipment header ---
  console.log(`\n=== INBOUND SHIPMENT: ${SHIPMENT_ID} (company: ${companyId}) ===`);
  const ship = parse(await apiGet(`companies/${companyId}/inboundShipments/${SHIPMENT_ID}`));
  console.log(`  status:                  ${ship.status}`);
  console.log(`  receiptStatus:           ${ship.receiptStatus}`);
  console.log(`  destinationWarehouseId:  ${ship.destinationWarehouseId}`);
  console.log(`  destinationWarehouseCode:${ship.destinationWarehouseCode}`);
  console.log(`  totalExpectedQty:        ${ship.totalExpectedQty}`);
  console.log(`  totalReceivedQty:        ${ship.totalReceivedQty}`);
  console.log(`  itemsCount:              ${ship.itemsCount}`);

  // --- 4. Items ---
  console.log(`\n=== ITEMS (subcollection) ===`);
  const itemsRes = await apiGet(`companies/${companyId}/inboundShipments/${SHIPMENT_ID}/items`);
  const items = (itemsRes.documents || []).map(parse);
  console.log(`  Total items: ${items.length}`);
  for (const item of items) {
    console.log(`\n  Item ID:         ${item._id}`);
    console.log(`    sku:           ${item.sku}`);
    console.log(`    productId:     ${item.productId}`);
    console.log(`    name:          ${item.name}`);
    console.log(`    expectedQty:   ${item.expectedQty}`);
    console.log(`    receivedQty:   ${item.receivedQty}`);
    console.log(`    draftReceivedQty: ${item.draftReceivedQty}`);
  }

  // --- 5. inventoryStock ---
  console.log(`\n=== INVENTORY STOCK (all docs) ===`);
  try {
    const stockRes = await apiGet(`companies/${companyId}/inventoryStock`);
    const stocks = (stockRes.documents || []).map(parse);
    console.log(`  Total stock docs: ${stocks.length}`);
    for (const s of stocks) {
      console.log(`  stockId: ${s._id} | sku: ${s.sku} | qtyOnHand: ${s.qtyOnHand} | from: ${s.receivedFromInboundId}`);
    }
  } catch(e) {
    console.log(`  Error: ${e.message}`);
  }

  console.log('\nDone.');
}

main().catch(console.error);
