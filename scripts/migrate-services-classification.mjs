import admin from 'firebase-admin';
import * as fs from 'fs';

// Argument parsing
const isApply = process.argv.includes('--apply');
const isDryRun = !isApply;

console.log(`Starting migration script in ${isDryRun ? 'DRY RUN' : 'APPLY'} mode.`);

admin.initializeApp();
const db = admin.firestore();

function classifyService(code, name) {
  // exact matches or regex
  if (code === 'TOLL_CO2') return { category: 'mandatory', type: 'flat' };
  if (code === 'ENERGY_SURCHARGE') return { category: 'mandatory', type: 'percent', applyTo: 'base', externalSource: 'carriers/{cid}/surcharges' };
  if (code === 'PEAK_SURCHARGE') return { category: 'conditional', type: 'flat', conditions: { dateRange: { fromMonth: 11, toMonth: 12 } } };
  if (code === 'PEAK_IN_PEAK') return { category: 'conditional', type: 'flat', conditions: { dateRange: { fromMonth: 11, toMonth: 12 } } };
  if (code === 'BULKY') return { category: 'conditional', type: 'flat', conditions: { parcelType: 'bulky' } };
  if (code.startsWith('BREXIT')) return { category: 'conditional', type: 'flat', conditions: { countries: ['GB', 'IM', 'JE', 'GG'] } };
  
  // Penalties
  if (code.startsWith('UNDELIVERABLE') || code.startsWith('WEIGHT_CORR') || code.startsWith('LABELING_FEE') || 
      code === 'WEIGHT_NO_DECL' || code === 'WEIGHT_MANIPULATION' || code === 'LABEL_UNREADABLE' || code === 'CUSTOMS_DATA_PP') {
    return { category: 'penalty', type: 'flat' };
  }
  
  if (code === 'PACKSTATION_DISCOUNT') return { category: 'optional', type: 'flat', conditions: { parcelType: 'standard' } };
  
  // All other codes:
  return { category: 'optional', type: 'flat' };
}

async function run() {
  const contractsSnap = await db.collection('carrierContracts').get();
  let totalUpdated = 0;
  let updatesLog = [];

  for (const contractDoc of contractsSnap.docs) {
    const priceListsSnap = await db.collection(`carrierContracts/${contractDoc.id}/priceLists`).get();
    
    for (const plDoc of priceListsSnap.docs) {
      const data = plDoc.data();
      const services = data.services || [];
      let changed = false;
      
      const updatedServices = services.map(svc => {
        if (svc.category && svc.type) return svc; // Already classified
        
        const classification = classifyService(svc.code, svc.name);
        changed = true;
        
        const updated = { ...svc, ...classification };
        updatesLog.push({
          contractId: contractDoc.id,
          priceListId: plDoc.id,
          code: svc.code,
          classification
        });
        
        return updated;
      });
      
      if (changed) {
        totalUpdated++;
        if (isApply) {
          await plDoc.ref.update({ services: updatedServices });
          console.log(`Updated price list ${plDoc.id}`);
        } else {
          console.log(`[DRY RUN] Would update price list ${plDoc.id}`);
        }
      }
    }
  }
  
  if (isApply) {
    const logFilename = `migration-log-${new Date().toISOString().slice(0, 10)}.json`;
    fs.writeFileSync(logFilename, JSON.stringify(updatesLog, null, 2));
    console.log(`\nMigration complete. Updated ${totalUpdated} price lists. Log written to ${logFilename}`);
  } else {
    console.log(`\n[DRY RUN] Found ${totalUpdated} price lists to update. Run with --apply to execute.`);
  }
}

run().catch(console.error);
