const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // wait, do I have the key?
// No, but I can use firebase-admin SDK locally using default credentials if I run it with GOOGLE_APPLICATION_CREDENTIALS or just use `npx firebase auth:export` to find the uids and `firebase auth:delete` them!
