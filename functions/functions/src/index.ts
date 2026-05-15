import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

admin.initializeApp();
const db = admin.firestore();

const ROLE_HIERARCHY: Record<string, number> = {
  'SUPER_ADMIN': 100,
  'ADMIN_OPERACYJNY': 80,
  'SALES': 50,
  'BILLING': 50,
  'WAREHOUSE': 50,
  'CUSTOMER_CARE': 50,
  'INTEGRATION': 50
};

export const createInternalUser = onCall(async (request) => {
  const { data, auth } = request;
  
  if (!auth) {
    throw new HttpsError('unauthenticated', 'User must be logged in.');
  }

  const callerUid = auth.uid;

  // Weryfikacja bezpośrednio w bazie (platformUsers lub users jako fallback)
  const callerDoc = await db.collection('platformUsers').doc(callerUid).get();
  let isSuperAdmin = false;
  let isOperativeAdmin = false;

  if (callerDoc.exists) {
    const callerData = callerDoc.data();
    if (callerData?.role === 'SUPER_ADMIN') isSuperAdmin = true;
    if (callerData?.role === 'ADMIN_OPERACYJNY') isOperativeAdmin = true;
  } else {
    // Fallback dla pierwotnego założyciela chmury (z głównej kolekcji users)
    const legacyDoc = await db.collection('users').doc(callerUid).get();
    const legacyData = legacyDoc.data();
    if (legacyDoc.exists && (legacyData?.globalRole === 'superadmin' || legacyData?.role === 'superadmin')) {
      isSuperAdmin = true;
    }
  }

  if (!isSuperAdmin && !isOperativeAdmin) {
    throw new HttpsError('permission-denied', 'Tylko administratorzy mogą tworzyć konta wewnętrzne.');
  }

  const targetRole = data.role;
  
  // Zabezpieczenie hierarchii ról
  if (!isSuperAdmin && targetRole === 'SUPER_ADMIN') {
    throw new HttpsError('permission-denied', 'Admin Operacyjny nie może stworzyć konta Super Admina.');
  }
  
  if (!isSuperAdmin && ROLE_HIERARCHY[targetRole] >= ROLE_HIERARCHY['ADMIN_OPERACYJNY']) {
    throw new HttpsError('permission-denied', 'Brak uprawnień do nadania tej roli.');
  }

  try {
    // 1. Tworzenie użytkownika w usłudze Auth
    const tempPassword = data.password || Math.random().toString(36).slice(-10) + 'A1!';
    const userRecord = await admin.auth().createUser({
      email: data.email,
      password: tempPassword,
      displayName: `${data.firstName} ${data.lastName}`.trim(),
    });

    // 2. Custom Claims dla bezpiecznych reguł firestore
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      accountType: 'internal',
      role: targetRole
    });

    // 3. Budowa dokumentu profilowego
    const userData: any = {
      uid: userRecord.uid,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone || '',
      accountType: 'internal',
      role: targetRole,
      department: data.department,
      permissions: data.permissions || {},
      clientScope: data.clientScope || { type: 'all', clientIds: [] },
      status: data.status || 'active',
      createdAt: FieldValue.serverTimestamp(),
      createdBy: callerUid,
      lastLoginAt: null
    };

    if (data.assignedPackingStationId) {
       userData.assignedPackingStationId = data.assignedPackingStationId;
    }

    await db.collection('platformUsers').doc(userRecord.uid).set(userData);

    return { success: true, uid: userRecord.uid, generatedPassword: tempPassword };

  } catch (error: any) {
    if (error.code && error.code.startsWith('auth/')) {
        throw new HttpsError('already-exists', error.message);
    }
    throw new HttpsError('internal', error.message);
  }
});

export const forceSyncClaims = onCall(async (request) => {
  try {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Brak autoryzacji.');

    // W pierwszej kolejności szukamy profilu wewnętrznego, w drugiej zewn.
    const platformUserDoc = await db.collection('platformUsers').doc(uid).get();
    let role = '';
    
    if (platformUserDoc.exists) {
      role = platformUserDoc.data()?.role || '';
    } else {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        role = userDoc.data()?.globalRole || userDoc.data()?.role || '';
      }
    }

    const roleLower = String(role).toLowerCase();
    
    if (roleLower === 'superadmin' || roleLower === 'super_admin') {
       await admin.auth().setCustomUserClaims(uid, { role: 'superadmin' });
    } else {
       await admin.auth().setCustomUserClaims(uid, { role: roleLower });
    }

    return { success: true, message: 'Uprawnienia zsynchronizowane z chmurą.' };
  } catch (error: any) {
    console.error("Błąd w forceSyncClaims:", error);
    throw new HttpsError('internal', error.message || 'Wystąpił nieoczekiwany błąd w chmurze.');
  }
});

export const onUserRoleUpdated = onDocumentUpdated('platformUsers/{userId}', async (event) => {
  const newValue = event.data?.after.data();
  const oldValue = event.data?.before.data();
  
  if (!newValue || !oldValue) return;
  if (newValue.role !== oldValue.role) {
    let roleLower = String(newValue.role || '').toLowerCase();
    if (roleLower === 'super_admin') roleLower = 'superadmin';
    await admin.auth().setCustomUserClaims(event.params.userId, { role: roleLower });
  }
});

export * from './baselinker';
export * from './inbound';
export * from './shoper';
export * from './warehouse';
export * from './warehouses';
export * from './baselinker';
export * from './orders';
export { runGoogleSheetsSyncOnJobCreated, scheduledGoogleSheetsSync } from './google_sheets';
export * from './outbounds';
export * from './dhl';
export * from './gls';
export * from './allegro';
export { scheduledAllegroDispatcher, processAllegroSync } from './allegro/scheduled';
export * from './test_run';
export * from './products';

// Fulfillment
export * from './fulfillment/triggers';
export * from './fulfillment/packing';
export * from './fulfillment/waves';
export * from './fulfillment/exceptions';
export * from './fulfillment/cartonization';
export * from "./apilo";
export * from './billing/carrierContracts';
export * from './billing/clientPricing';
export * from './billing/surchargeFetcher';
export * from './billing/estimateCost';
export * from './billing/seedGls';

// Gamification
export * from "./shipmentsGamification";
