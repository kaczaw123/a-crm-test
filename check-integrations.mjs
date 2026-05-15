import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp(); // Uses default credentials from emulator/CLI

const db = getFirestore();

async function check() {
  console.log('Sprawdzanie wszystkich integracji we wszystkich firmach...');
  
  try {
    const companiesSnap = await db.collection('companies').get();
    let found = false;
    for (const comp of companiesSnap.docs) {
      const integrationsSnap = await db.collection(`companies/${comp.id}/integrations`).get();
      if (!integrationsSnap.empty) {
        found = true;
        console.log(`\nFirma [${comp.id}]: Znaleziono integracji = ${integrationsSnap.size}`);
        integrationsSnap.forEach(doc => {
          const data = doc.data();
          console.log(` - Integracja ID: ${doc.id}`);
          console.log(`   Nazwa: ${data.customName}`);
          console.log(`   Status: ${data.status}`);
          console.log(`   Token Zapisany (encrypted): ${!!data.encryptedToken}`);
        });
      }
    }
    
    if (!found) {
      console.log('\n❌ Nie znaleziono żadnych integracji w żadnej firmie!');
    }
  } catch(e) {
    console.error('Błąd bazy danych:', e);
  }
}

check();
