import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

export const testGetProducts = onRequest(async (req, res) => {
  const db = admin.firestore();
  const snapshot = await db.collectionGroup('products').limit(5).get();
  const products = snapshot.docs.map(doc => doc.data());
  res.json({ products });
});
