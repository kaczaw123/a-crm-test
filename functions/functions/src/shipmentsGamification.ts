import { onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from 'firebase-admin';

// Initialize admin if not already initialized
if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

export const onShipmentCreatedGamification = onDocumentCreated("companies/{companyId}/shipments/{shipmentId}", async (event) => {
    const snap = event.data;
    if (!snap) return;

    const shipmentData = snap.data();
    const createdBy = shipmentData.createdBy;

    // Przesyłki automatyczne mogą nie mieć createdBy. Nagradzamy tylko za przesyłki powiązane z użytkownikiem.
    if (!createdBy) return;

    try {
        let userRef = db.collection('users').doc(createdBy);
        let userDoc = await userRef.get();

        if (!userDoc.exists) {
            userRef = db.collection('platformUsers').doc(createdBy);
            userDoc = await userRef.get();
        }

        if (userDoc.exists) {
            // Bezpieczna transakcja do inkrementacji licznika i przyznawania nagrody
            await db.runTransaction(async (transaction) => {
                const freshUserDoc = await transaction.get(userRef);
                const userData = freshUserDoc.data();
                if (!userData) return;

                const currentCount = userData.shipmentsCreated || 0;
                const newCount = currentCount + 1;
                const currentBalance = userData.rewardBalance || 0;

                const updateData: any = { shipmentsCreated: newCount };

                // Sprawdzamy czy to tysięczna paczka
                if (newCount > 0 && newCount % 1000 === 0) {
                    updateData.rewardBalance = currentBalance + 10;
                }

                transaction.update(userRef, updateData);
            });
        }
    } catch (error) {
        console.error("Error in onShipmentCreatedGamification:", error);
    }
});
