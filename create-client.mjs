import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, doc, setDoc } from "firebase/firestore";

const app = initializeApp({ projectId: "mock_project_id", apiKey: "mock_key" });
const auth = getAuth(app);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, "127.0.0.1", 8080);

const email = "rafalanaszko@gepardlogistics.com";
const password = "password123";

(async () => {
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        console.log("Utworzono nowego użytkownika w Auth, UID:", cred.user.uid);
        
        await setDoc(doc(db, "users", cred.user.uid), {
            uid: cred.user.uid,
            email,
            displayName: "Rafał Anaszko",
            globalRole: "superadmin",
            status: "active",
            createdAt: Date.now()
        });
        console.log("Utworzono profil z uprawnieniami superadmina w Firestore");
        process.exit(0);
    } catch (e) {
        if (e.code === 'auth/email-already-in-use') {
            console.log("Konto już istnieje! Użyj hasła:", password);
            process.exit(0);
        } else {
            console.error("Błąd klienta:", e.message);
            process.exit(1);
        }
    }
})();
