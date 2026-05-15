import admin from 'firebase-admin';
import crypto from 'crypto';

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
try { admin.initializeApp({ projectId: 'gep-a-crm' }); } catch(e) {}
const db = admin.firestore();

function getEncryptionKey() {
  return crypto.createHash('sha256').update("TEST_MOCK_KEY_SHOULD_NOT_BE_USED_LOCALLY").digest(); 
  // Wait, I can't decrypt locally without the real MASTER_ENCRYPTION_KEY which is a Google Cloud Secret!
}
