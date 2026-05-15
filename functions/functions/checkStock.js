
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gep-a-crm' });
async function checkStock() {
  try {
    const snap = await admin.firestore().collection('platformUsers').where('email', '==', 'rafalanaszko@gepardlogistics.com').get();
    if (snap.empty) { console.log('user not found'); return; }
    const user = snap.docs[0].data();
    const companyId = user.activeCompanyId;
    console.log('Company ID:', companyId);
    const stockSnap = await admin.firestore().collection('companies/'+companyId+'/inventoryStock').limit(5).get();
    console.log('Znalezionych dokumentow w inventoryStock:', stockSnap.size);
    stockSnap.docs.forEach(d => {
       console.log('--- Document ID:', d.id);
       console.log('--- Data:', JSON.stringify(d.data(), null, 2));
    });
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
checkStock();

