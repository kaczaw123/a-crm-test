import { HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/**
 * Verifies caller is a member of the company, or a superadmin.
 *
 * This is the authorization gate that SHOULD be called at the start of every
 * onCall function operating on company-scoped data. Currently most existing
 * functions do NOT do this — see GH #66 for the audit follow-up.
 */
export async function assertCompanyAccess(uid: string, companyId: string): Promise<void> {
  const [memberDoc, platformUserDoc, legacyUserDoc] = await Promise.all([
    db.collection(`companies/${companyId}/members`).doc(uid).get(),
    db.collection('platformUsers').doc(uid).get(),
    db.collection('users').doc(uid).get(),
  ]);

  const isMember = memberDoc.exists;
  // Check globalRole and role independently — mirrors isSuperadmin() in firestore.rules.
  // Short-circuit `||` would miss the case where globalRole is truthy-but-non-admin and role is admin.
  // Low-priority fix per GH #66 audit follow-up.
  const legacyData = legacyUserDoc.exists ? legacyUserDoc.data() : null;
  const isLegacyAdmin = legacyData != null && (
    ['superadmin', 'admin'].includes(legacyData.globalRole || '') ||
    ['superadmin', 'admin'].includes(legacyData.role || '')
  );
  const isSuperadmin =
    (platformUserDoc.exists && platformUserDoc.data()?.role === 'SUPER_ADMIN') ||
    isLegacyAdmin;

  if (!isMember && !isSuperadmin) {
    throw new HttpsError('permission-denied', 'Brak uprawnień do tej firmy.');
  }
}
