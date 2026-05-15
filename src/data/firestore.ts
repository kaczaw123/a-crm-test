import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { UserProfile } from './types';
import type { User } from 'firebase/auth';

export const withTimeout = <T>(promise: Promise<T>, ms: number, errorMsg: string = 'Przekroczono limit czasu połączenia (Brak dostępu do Firestore)'): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
  ]);
};

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  try {
    const docRef = doc(db, 'users', uid);
    const snap = await withTimeout(getDoc(docRef), 5000);
  if (snap.exists()) {
    const data = snap.data();
    if (!data.activeCompanyId && data.companyId) {
      data.activeCompanyId = data.companyId;
    }
    if (!data.globalRole) {
      data.globalRole = data.role === 'superadmin' ? 'superadmin' : 'user';
    }
    return data as UserProfile;
  }

  // Fallback do kont autorskich / superadminów chmury Gepard
  const platformDoc = await withTimeout(getDoc(doc(db, 'platformUsers', uid)), 2000);
  if (platformDoc.exists()) {
    const pData = platformDoc.data();
    return {
      uid: pData.uid,
      email: pData.email,
      firstName: pData.firstName,
      lastName: pData.lastName,
      displayName: `${pData.firstName} ${pData.lastName}`.trim(),
      phone: pData.phone,
      platformRole: pData.role,
      globalRole: (pData.role === 'SUPER_ADMIN' || pData.role === 'ADMIN_OPERACYJNY') ? 'superadmin' : 'admin',
      authProviders: ['password'],
      createdAt: pData.createdAt?.toMillis ? pData.createdAt.toMillis() : Date.now(),
      lastLoginAt: pData.lastLoginAt?.toMillis ? pData.lastLoginAt.toMillis() : Date.now()
    } as UserProfile;
  }
  } catch (error) {
    console.error("getUserProfile timeout/error:", error);
    throw error; // Rzuć wyżej, aby obsłużyć błąd UI (ERR_CONNECTION_REFUSED timeout)
  }
  return null;
};

export const updateUserProfile = async (uid: string, data: Partial<Omit<UserProfile, 'uid' | 'createdAt'>>) => {
  const docRef = doc(db, 'users', uid);
  await updateDoc(docRef, {
    ...data,
    updatedAt: Date.now()
  });
};

export const syncGoogleUserProfile = async (user: User): Promise<void> => {
  const docRef = doc(db, 'users', user.uid);
  const snap = await getDoc(docRef);
  
  const providers = user.providerData.map(p => p.providerId);
  const authProviders = providers.length > 0 ? providers : ['google.com'];

  if (!snap.exists()) {
    const newProfile: UserProfile = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || null,
      avatarUrl: user.photoURL || undefined,
      globalRole: 'user', 
      authProviders,
      createdAt: Date.now(),
      lastLoginAt: Date.now()
    };
    await setDoc(docRef, newProfile);
  } else {
    const data = snap.data() as UserProfile;
    const mergedProviders = Array.from(new Set([...(data.authProviders || []), ...authProviders]));
    
    const updates: Partial<UserProfile> = {
      authProviders: mergedProviders,
      lastLoginAt: Date.now()
    };
    
    if (!data.avatarUrl && user.photoURL) {
      updates.avatarUrl = user.photoURL;
    }
    
    await updateDoc(docRef, updates);
  }
};

export const updateLastLoginTimestamp = async (uid: string): Promise<void> => {
  try {
    const userRef = doc(db, 'users', uid);
    await withTimeout(updateDoc(userRef, { lastLoginAt: Date.now() }), 3000);
  } catch (err) {
    try {
      const platformUserRef = doc(db, 'platformUsers', uid);
      await withTimeout(updateDoc(platformUserRef, { lastLoginAt: Date.now() }), 3000);
    } catch (platformErr) {
      console.error("Failed to update last login timestamp:", platformErr);
      throw platformErr;
    }
  }
};

export const addRewardBalance = async (uid: string, amount: number, tourId?: string): Promise<{ newBalance: number; completedTours: string[] } | null> => {
  try {
    let collectionName = 'users';
    let docRef = doc(db, collectionName, uid);
    let snap = await getDoc(docRef);

    if (!snap.exists()) {
      collectionName = 'platformUsers';
      docRef = doc(db, collectionName, uid);
      snap = await getDoc(docRef);
    }

    if (snap.exists()) {
      const data = snap.data();
      const currentCompleted = data.completedTours || [];
      const currentBalance = data.rewardBalance || 0;

      // Zabezpieczenie przed podwójnym naliczaniem wycieczek
      if (tourId && currentCompleted.includes(tourId)) {
        return { newBalance: currentBalance, completedTours: currentCompleted };
      }

      const newCompleted = tourId ? [...currentCompleted, tourId] : currentCompleted;
      const newBalance = currentBalance + amount;

      await updateDoc(docRef, {
        completedTours: newCompleted,
        rewardBalance: newBalance
      });

      return { newBalance, completedTours: newCompleted };
    }
  } catch (error) {
    console.error("Failed to update reward balance:", error);
  }
  return null;
};
