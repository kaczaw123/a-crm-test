const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccount.json'); 
// Assuming a service account isn't needed if I execute it via `firebase exec` or just using the shell in functions/ ... wait, the project uses `export GOOGLE_APPLICATION_CREDENTIALS` on the OS.
// No, I can just use `require('firebase-admin')` normally if I pass credentials, or `firebase-admin` running in the environment.

admin.initializeApp();
const db = admin.firestore();

async function migrate() {
    console.log('Rozpoczynam migrację zamówień ze statusem "shipped", ale nie będących w fulfillment...');
    let count = 0;
    
    const companiesSnap = await db.collection('companies').get();
    
    for (const company of companiesSnap.docs) {
        const companyId = company.id;
        const ordersSnap = await db.collection(`companies/${companyId}/orders`)
                                   .where('status', '==', 'shipped')
                                   .get();

        for (const order of ordersSnap.docs) {
            const data = order.data();
            const fulfillmentStatus = data.fulfillmentStatus;
            
            // Jeśli utknęło przez generację etykiety:
            if (!fulfillmentStatus || fulfillmentStatus === 'awaiting' || fulfillmentStatus === 'none') {
                console.log(`[${companyId}] Naprawiam zamówienie: ${order.id}`);
                await order.ref.update({
                    status: 'ready_for_shipping'
                });
                count++;
            }
        }
    }
    console.log(`Zakończono. Naprawiono zamówień: ${count}`);
}

migrate().catch(console.error);
