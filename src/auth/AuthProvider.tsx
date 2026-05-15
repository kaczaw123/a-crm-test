import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { auth, db } from '../firebase/config';
import { AuthContext } from './AuthContext';
import { getUserProfile } from '../data/firestore';
import { doc, getDoc } from 'firebase/firestore';
import type { UserProfile, CompanyMember } from '../data/types';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [membership, setMembership] = useState<CompanyMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [systemError, setSystemError] = useState<'offline' | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setLoading(true);
        try {
          // Wymuszenie synca najnowszego układu ról (Custom Claims)
          await firebaseUser.getIdToken(true);
          setUser(firebaseUser);
          
          const userProfile = await getUserProfile(firebaseUser.uid);
          setProfile(userProfile);
          
          if (userProfile && userProfile.activeCompanyId) {
             const memberRef = doc(db, `companies/${userProfile.activeCompanyId}/members`, firebaseUser.uid);
             const memberSnap = await getDoc(memberRef);
             if (memberSnap.exists()) {
               setMembership(memberSnap.data() as CompanyMember);
             } else {
               setMembership(null);
             }
          } else {
             setMembership(null);
          }
        } catch (error: any) {
          console.error("Error fetching user session:", error);
          if (error?.message?.includes('offline') || error?.code === 'unavailable') {
            setSystemError('offline');
          }
          setProfile(null);
          setMembership(null);
        }
      } else {
        setUser(null);
        setProfile(null);
        setMembership(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const logout = async () => {
    await signOut(auth);
  };
  
  const forceRefreshSession = async () => {
    if (auth.currentUser) {
      setLoading(true);
      try {
        await auth.currentUser.getIdToken(true);
        // Po odświeżeniu JWT, mechanizmy Firebase natywnie pchną nowy token w kolejne zapytania
      } finally {
        setLoading(false);
      }
    }
  };

  const updateSessionProfile = (updates: Partial<UserProfile>) => {
    if (profile) {
      setProfile({ ...profile, ...updates });
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, membership, loading, systemError, logout, updateSessionProfile, forceRefreshSession }}>
      {children}
    </AuthContext.Provider>
  );
};
