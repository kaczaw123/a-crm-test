import admin from 'firebase-admin';

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

admin.initializeApp({
  projectId: "mock_project_id" // Używam domyślnego z config.ts
});

const uid = "5fx2B8YGhpgGFoUenAPNjMSGnvz1";
const email = "rafalanaszko@gepardlogistics.com";
const password = "password123";

(async () => {
  try {
    const userRecord = await admin.auth().createUser({
      uid,
      email,
      password,
      emailVerified: true,
      displayName: "Rafał Anaszko",
    });
    console.log("Utworzono użytkownika Auth:", userRecord.uid);
    
    // Tworzenie rekordu w Firestore, żeby zalogowanie przeszło poprawnie
    const db = admin.firestore();
    await db.collection("users").doc(uid).set({
      uid,
      email,
      displayName: "Rafał Anaszko",
      globalRole: "superadmin", // nadanie uprawnień admina
      status: "active",
      createdAt: Date.now()
    });
    console.log("Utworzono profil w Firestore do logowania.");
    process.exit(0);
  } catch (error) {
    if (error.code === 'auth/uid-already-exists' || error.code === 'auth/email-already-exists') {
      console.log("Użytkownik już istnieje. Aktualizuję hasło na: " + password);
      await admin.auth().updateUser(uid, { password }).catch(console.error);
      process.exit(0);
    } else {
      console.error("Błąd tworzenia użytkownika:", error);
      process.exit(1);
    }
  }
})();
