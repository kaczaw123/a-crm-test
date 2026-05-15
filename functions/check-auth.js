const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gep-a-crm' });

(async () => {
    try {
        const user = await admin.auth().getUserByEmail('aupio1983@gmail.com');
        console.log('✅ User exists in Auth:', user.uid);
    } catch (error) {
        console.log('❌ User does NOT exist in Auth:', error.code, error.message);
    }
})();
