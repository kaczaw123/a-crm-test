import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const db = admin.firestore();

// Skrypt grupujący do X zadan w 1 fali, uwzględniając priorytet oraz status awaiting.
export const generatePickWave = onCall(async (request) => {
  const { data, auth } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'User must be logged in.');

  const { companyId, limit = 15 } = data;
  if (!companyId) throw new HttpsError('invalid-argument', 'Missing companyId.');

  try {
    const queueRef = db.collection(`companies/${companyId}/fulfillmentQueue`);
    
    // Sortuj pierw według priorytetu (highest -> normal) potem po deadline
    // Do ułożenia indexu Firestore może to wymagać drobnego dopieszczenia
    const query = queueRef
      .where('status', '==', 'awaiting')
      .orderBy('cutOffDeadline', 'asc') // Najpilniejsze na górze
      .limit(limit);

    const snapshot = await query.get();
    
    if (snapshot.empty) {
      return { success: true, count: 0, waveId: null, message: "Brak zadań w kolejce." };
    }

    const taskIds = snapshot.docs.map(doc => doc.id);

    // Stwórz falę
    const waveRef = db.collection(`companies/${companyId}/pickWaves`).doc();
    
    const batch = db.batch();
    
    batch.set(waveRef, {
      id: waveRef.id,
      companyId: companyId,
      status: 'active',
      assignedPickerId: auth.uid,
      taskIds: taskIds,
      totalItems: taskIds.length,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Zaktualizuj status w taskach
    snapshot.docs.forEach(doc => {
      batch.update(doc.ref, {
        status: 'picking',
        pickWaveId: waveRef.id,
        assignedToPickerId: auth.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    await batch.commit();

    return { success: true, count: taskIds.length, waveId: waveRef.id };
  } catch (err: any) {
    throw new HttpsError('internal', err.message);
  }
});
