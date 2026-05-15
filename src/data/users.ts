import { collection, query, limit, startAfter, getDocs, collectionGroup, where, doc, updateDoc, deleteDoc, documentId } from 'firebase/firestore';
import { db, auth, functions } from '../firebase/config';
import { httpsCallable } from 'firebase/functions';
import { logGlobalAuditAction } from './audit';
import type { UserProfile, CompanyMember } from './types';

/**
 * Pobiera paginowaną listę globalnych użytkowników
 */
export const getUsersPage = async (limitCount: number, lastDocSnapshot: any = null) => {
  const usersRef = collection(db, 'users');
  // Usunięto 'orderBy("createdAt")', by nie tracić użytkowników, którzy ze starych rejestracji nie posiadają tego pola.
  let q = query(usersRef, limit(limitCount));
  
  if (lastDocSnapshot) {
    q = query(usersRef, startAfter(lastDocSnapshot), limit(limitCount));
  }
  
  const snap = await getDocs(q);
  const users = snap.docs.map(doc => doc.data() as UserProfile);
  const lastVisible = snap.docs[snap.docs.length - 1]; // for next page cursor
  
  return { users, lastVisible, size: snap.docs.length };
};

/**
 * Optymalizator wydajności (UNIKA N+1 QUERIES)
 * Pobiera naraz (batching) role z firm dla wszystkich przekazanych UID
 */
export const getUsersMembershipsBatch = async (uids: string[]): Promise<{ companyId: string, member: CompanyMember, companyName?: string, companyTaxId?: string }[]> => {
  if (uids.length === 0) return [];
  
  // W trybie IN maksymalna liczba indeksów to 30 wg Firebase
  const chunkSize = 30;
  const chunks = [];
  for (let i = 0; i < uids.length; i += chunkSize) {
    chunks.push(uids.slice(i, i + chunkSize));
  }
  
  let allMemberships: { companyId: string, member: CompanyMember }[] = [];
  
  for (const chunk of chunks) {
    const membersQuery = query(collectionGroup(db, 'members'), where('uid', 'in', chunk));
    const snap = await getDocs(membersQuery);
    
    const memberships = snap.docs.map(d => {
      // W Firestore dla doc uzywanego w collectionGroup, 
      // rodzicem subkolekcji 'members' jest dany dokument doc('companies', ID)
      const companyId = d.ref.parent.parent?.id || '';
      return {
        companyId,
        member: d.data() as CompanyMember
      };
    });
    
    allMemberships = [...allMemberships, ...memberships];
  }
  
  const uniqueCompanyIds = Array.from(new Set(allMemberships.map(m => m.companyId))).filter(Boolean);
  const companiesMap: Record<string, { name: string, taxId: string }> = {};

  if (uniqueCompanyIds.length > 0) {
    const compChunks = [];
    for (let i = 0; i < uniqueCompanyIds.length; i += 30) {
      compChunks.push(uniqueCompanyIds.slice(i, i + 30));
    }
    for (const cChunk of compChunks) {
      const cQuery = query(collection(db, 'companies'), where(documentId(), 'in', cChunk));
      const cSnap = await getDocs(cQuery);
      cSnap.docs.forEach(d => {
        const data = d.data();
        companiesMap[d.id] = { name: data.name, taxId: data.taxId };
      });
    }
  }

  return allMemberships.map(m => ({
    ...m,
    companyName: companiesMap[m.companyId]?.name,
    companyTaxId: companiesMap[m.companyId]?.taxId
  }));
};

/**
 * Przełączanie ról (Global Admin)
 */
export const toggleUserGlobalRole = async (uid: string, newRole: 'superadmin' | 'user') => {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, {
    globalRole: newRole,
    updatedAt: Date.now()
  });
};

/**
 * Zmiana statusu konta (Deactivate / Reactivate)
 */
export const updateUserAccountStatus = async (uid: string, newStatus: 'active' | 'disabled' | 'deleted') => {
  const actorUid = auth.currentUser?.uid;
  if (!actorUid) throw new Error("Unauthenticated user");
  
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, {
    accountStatus: newStatus,
    updatedAt: Date.now()
  });
  
  await logGlobalAuditAction(
    newStatus === 'disabled' ? 'deactivate_user' : 'reactivate_user',
    actorUid,
    uid,
    { newStatus }
  );
};

/**
 * Trwałe usunięcie z bazy (tylko testowe konta/zepsute)
 */
export const hardDeleteUser = async (uid: string) => {
  const actorUid = auth.currentUser?.uid;
  if (!actorUid) throw new Error("Unauthenticated user");
  
  const userRef = doc(db, 'users', uid);
  await deleteDoc(userRef);
  
  await logGlobalAuditAction('hard_delete_user', actorUid, uid);
};

/**
 * Wymuszone wyrzucenie z instancji systemu (Superadmin Bypass)
 */
export const removeUserMembershipGlobal = async (uid: string, companyId: string) => {
  const actorUid = auth.currentUser?.uid;
  if (!actorUid) throw new Error("Unauthenticated user");
  
  const memberRef = doc(db, 'companies', companyId, 'members', uid);
  await deleteDoc(memberRef); // Twarde usunięcie lub zmiana statusu na 'removed' - twarde kasuje sub-kolekcje
  
  await logGlobalAuditAction('remove_user_membership', actorUid, uid, { companyId });
};

export const forceSyncClaimsCallable = httpsCallable(functions, 'forceSyncClaims');
