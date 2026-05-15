const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

async function run() {
    try {
        console.log("Szukam zaimportowanych produktów...");
        const companiesSnap = await db.collection('companies').get();
        let total = 0;
        for (const companyDoc of companiesSnap.docs) {
             const productsSnap = await db.collection(`companies/${companyDoc.id}/products`).get();
             if (!productsSnap.empty) {
                 let hasGoogleSheetsTags = false;
                 productsSnap.forEach(doc => {
                     const p = doc.data();
                     if (p.tags && p.tags.includes('google_sheets')) {
                         if (!hasGoogleSheetsTags) {
                             console.log(`\n--- Firma: ${companyDoc.id} ---`);
                             hasGoogleSheetsTags = true;
                         }
                         console.log(`- ${p.name} \n  SKU: ${p.sku} | EAN: ${p.ean}`);
                         total++;
                     }
                 });
             }
        }
        console.log(`\nŁącznie pobrano w tagu 'google_sheets': ${total} produktów.`);
        process.exit(0);
    } catch(e) {
        console.error("Błąd zapytania do Firestore:", e.message);
        process.exit(1);
    }
}
run();
