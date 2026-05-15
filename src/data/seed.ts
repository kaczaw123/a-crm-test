import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { UserProfile } from './types';

export const createSuperAdmin = async (uid: string, email: string) => {
  const userRef = doc(db, 'users', uid);
  const adminProfile: UserProfile = {
    uid,
    email,
    displayName: 'Super Admin',
    globalRole: 'superadmin',
    authProviders: ['password'],
    createdAt: Date.now()
  };

  await setDoc(userRef, adminProfile);
  console.log(`Created superadmin profile for ${email}`);
};
