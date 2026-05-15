import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { assertCompanyAccess } from './auth/companyAccess';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/**
 * archivedBy convention:
 *   <uid>                    — human user (auth.uid)
 *   'system:gs-sync'         — Google Sheets sync
 *   'system:shoper-sync'     — Shoper sync
 *   'system:baselinker-sync' — Baselinker sync
 *   'system:migration'       — migration scripts
 *   null                     — active product (never archived)
 *   see GH #65 for sku/ean validation follow-up
 */
type ArchivedBy = string | null;

interface ProductActionInput {
  companyId: string;
  productId: string;
}

export const archiveProduct = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');

  const { companyId, productId } = data as Partial<ProductActionInput>;
  if (typeof companyId !== 'string' || !companyId.trim())
    throw new HttpsError('invalid-argument', 'Nieprawidłowy parametr companyId.');
  if (typeof productId !== 'string' || !productId.trim())
    throw new HttpsError('invalid-argument', 'Nieprawidłowy parametr productId.');

  console.info('[archiveProduct] start', { uid: auth.uid, companyId, productId });

  await assertCompanyAccess(auth.uid, companyId);

  const productRef = db.collection(`companies/${companyId}/products`).doc(productId);
  const archivedBy: ArchivedBy = auth.uid;

  await db.runTransaction(async (t) => {
    const productDoc = await t.get(productRef);
    if (!productDoc.exists)
      throw new HttpsError('not-found', 'Produkt nie istnieje.');
    if (productDoc.data()?.isArchived === true)
      throw new HttpsError('failed-precondition', 'Produkt jest już zarchiwizowany.');

    t.update(productRef, {
      isArchived: true,
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  console.info('[archiveProduct] done', { uid: auth.uid, companyId, productId });
  return { success: true };
});

export const unarchiveProduct = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) throw new HttpsError('unauthenticated', 'Wymagane logowanie.');

  const { companyId, productId } = data as Partial<ProductActionInput>;
  if (typeof companyId !== 'string' || !companyId.trim())
    throw new HttpsError('invalid-argument', 'Nieprawidłowy parametr companyId.');
  if (typeof productId !== 'string' || !productId.trim())
    throw new HttpsError('invalid-argument', 'Nieprawidłowy parametr productId.');

  console.info('[unarchiveProduct] start', { uid: auth.uid, companyId, productId });

  await assertCompanyAccess(auth.uid, companyId);

  const productRef = db.collection(`companies/${companyId}/products`).doc(productId);

  await db.runTransaction(async (t) => {
    const productDoc = await t.get(productRef);
    if (!productDoc.exists)
      throw new HttpsError('not-found', 'Produkt nie istnieje.');
    if (productDoc.data()?.isArchived !== true)
      throw new HttpsError('failed-precondition', 'Produkt nie jest zarchiwizowany.');

    t.update(productRef, {
      isArchived: false,
      archivedAt: null,
      archivedBy: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  console.info('[unarchiveProduct] done', { uid: auth.uid, companyId, productId });
  return { success: true };
});
