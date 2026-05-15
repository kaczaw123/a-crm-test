import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const reportFulfillmentException = onCall(async (request) => {
  const { data, auth } = request;
  if (!auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const { companyId, taskId, reason, details } = data;
  if (!companyId || !taskId || !reason) {
    throw new HttpsError('invalid-argument', 'Missing required parameters.');
  }

  const db = admin.firestore();
  
  await db.runTransaction(async (transaction) => {
    const taskRef = db.doc(`companies/${companyId}/fulfillmentQueue/${taskId}`);
    const taskDoc = await transaction.get(taskRef);
    
    if (!taskDoc.exists) {
      throw new HttpsError('not-found', 'Task not found.');
    }

    const taskData = taskDoc.data();
    
    // Create exception record
    const exceptionRef = db.collection(`companies/${companyId}/inventoryExceptions`).doc();
    transaction.set(exceptionRef, {
      taskId: taskId,
      orderId: taskData?.orderId,
      reason: reason,
      details: details || '',
      reportedBy: auth.uid,
      status: 'open',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Update task status and release lock
    transaction.update(taskRef, {
      status: 'exception',
      lockedByUserId: null,
      lockedAt: null,
      lockedStationId: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  return { success: true };
});
