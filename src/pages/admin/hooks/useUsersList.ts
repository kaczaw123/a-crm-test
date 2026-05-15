import { useState, useEffect, useCallback } from 'react';
import type { UserProfile, CompanyMember } from '../../../data/types';
import { getUsersPage, getUsersMembershipsBatch, toggleUserGlobalRole, updateUserAccountStatus, hardDeleteUser, removeUserMembershipGlobal } from '../../../data/users';

export interface UserViewModel extends UserProfile {
  memberships: { companyId: string, member: CompanyMember, companyName?: string, companyTaxId?: string }[];
  membershipCount: number | null; // null oznacza 'jeszcze nie załadowane' albo błąd
}

export const useUsersList = () => {
  const [users, setUsers] = useState<UserViewModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [membershipsLoading, setMembershipsLoading] = useState(false);
  const [membershipsError, setMembershipsError] = useState('');

  const [lastVisible, setLastVisible] = useState<any>(null);
  const [hasMore, setHasMore] = useState(false);
  
  const pageSize = 25;

  const fetchUsers = useCallback(async (isNextPage = false) => {
    try {
      if (!isNextPage) {
        setLoading(true);
        setUsers([]);
        setLastVisible(null);
      }
      setError('');
      setMembershipsError('');
      
      const res = await getUsersPage(pageSize, isNextPage ? lastVisible : null);
      
      if (res.users.length === 0) {
        setHasMore(false);
        setLoading(false);
        return;
      }

      // 1. Zapisz uźytkowników do UI NAJPIERW
      // SANITIZATION: Brakujące pola z legacy accounts nie mogą crashować .toUpperCase()
      const initialViewModels: UserViewModel[] = res.users.map(user => ({
        ...user,
        globalRole: user.globalRole || 'user',
        displayName: user.displayName || '',
        email: user.email || '',
        authProviders: user.authProviders || [],
        memberships: [],
        membershipCount: null
      }));

      setUsers(prev => isNextPage ? [...prev, ...initialViewModels] : initialViewModels);
      setLastVisible(res.lastVisible);
      setHasMore(res.size === pageSize);
      setLoading(false);
      
      // 2. Pobierz memberships bez przerywania renderu userów w wypadku błędów Index/Rules
      const uids = res.users.map(u => u.uid);
      
      try {
        setMembershipsLoading(true);
        const membershipsResult = await getUsersMembershipsBatch(uids);
        
        setUsers(currentUsers => currentUsers.map(user => {
          if (!uids.includes(user.uid)) return user;
          const userMemberships = membershipsResult.filter(m => m.member.uid === user.uid);
          return {
            ...user,
            memberships: userMemberships,
            membershipCount: userMemberships.length
          };
        }));
      } catch (memErr: any) {
        console.warn("Błąd kolekcji Memberships (RAW):", memErr);
        const code = memErr.code || 'unknown-code';
        const msg = memErr.message || 'Brak komunikatu o błędzie';
        setMembershipsError(`[${code}] ${msg}`);
      } finally {
        setMembershipsLoading(false);
      }
      
    } catch (err: any) {
      console.error("Błąd pobrania bazy uźytkowników:", err);
      let errorMsg = 'Wystąpił błąd podczas ładowania użytkowników z collection("users"): ';
      if (err.code === 'permission-denied') {
        errorMsg += 'Brak upewnień w Security Rules.';
      } else {
        errorMsg += err.message;
      }
      setError(errorMsg);
      setLoading(false);
    }
  }, [lastVisible, pageSize]); // Add explicit dependency list

  useEffect(() => {
    fetchUsers(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = () => {
    if (!loading && hasMore) {
      fetchUsers(true);
    }
  };

  const handleToggleRole = async (uid: string, currentRole: 'superadmin' | 'admin' | 'user') => {
    const newRole = currentRole === 'superadmin' ? 'user' : 'superadmin';
    try {
      await toggleUserGlobalRole(uid, newRole);
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, globalRole: newRole } : u));
    } catch (err) {
      console.error(err);
      alert('Wystąpił błąd podczas aktualizacji uprawnień roli.');
    }
  };

  const handleUpdateAccountStatus = async (uid: string, newStatus: 'active' | 'disabled' | 'deleted') => {
    try {
      await updateUserAccountStatus(uid, newStatus);
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, accountStatus: newStatus } : u));
    } catch (err: any) {
      console.error(err);
      alert('Błąd podczas zmiany statusu konta: ' + err.message);
    }
  };

  const handleHardDeleteUser = async (uid: string) => {
    try {
      await hardDeleteUser(uid);
      setUsers(prev => prev.filter(u => u.uid !== uid));
    } catch (err: any) {
      console.error(err);
      alert('Błąd podczas usuwania konta: ' + err.message);
    }
  };

  const handleRemoveMembership = async (uid: string, companyId: string) => {
    try {
      await removeUserMembershipGlobal(uid, companyId);
      setUsers(prev => prev.map(u => {
        if (u.uid !== uid) return u;
        const newMemberships = u.memberships.filter(m => m.companyId !== companyId);
        return {
          ...u,
          memberships: newMemberships,
          membershipCount: newMemberships.length
        };
      }));
    } catch (err: any) {
      console.error(err);
      alert('Błąd podczas usuwania dostępu: ' + err.message);
    }
  };

  return {
    users,
    loading,
    error,
    membershipsLoading,
    membershipsError,
    hasMore,
    loadMore,
    handleToggleRole,
    handleUpdateAccountStatus,
    handleHardDeleteUser,
    handleRemoveMembership,
    refresh: () => { setLastVisible(null); fetchUsers(false); }
  };
};
