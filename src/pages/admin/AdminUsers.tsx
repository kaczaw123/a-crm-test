import { useEffect, useState } from 'react';
import { useUsersList, type UserViewModel } from './hooks/useUsersList';
import { UserDetailsPanel } from './UserDetailsPanel';
import { ErrorBoundary } from '../../components/common/ErrorBoundary';
import { syncAllMembershipsUIDs } from '../../data/company';

function AdminUsersContent() {
  const { users, loading, error, membershipsLoading, membershipsError, hasMore, loadMore, handleToggleRole, handleUpdateAccountStatus, handleHardDeleteUser, handleRemoveMembership } = useUsersList();
  const [selectedUser, setSelectedUser] = useState<UserViewModel | null>(null);
  
  const formatDate = (ts?: number) => {
    if (!ts) return '-';
    return new Date(ts).toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  useEffect(() => {
    console.log("[DIAG] AdminUsers component MOUNTED.");
    return () => console.log("[DIAG] AdminUsers component UNMOUNTED.");
  }, []);

  console.log("[DIAG] AdminUsers RENDERING...", { usersCount: users.length, loading, error, membershipsError });

  return (
    <div className="w-full px-4 py-6">
       <div className="flex justify-between items-center mb-6">
         <h1 className="text-2xl font-bold text-[#0F172A] flex items-center gap-3">
           <span className="material-symbols-outlined text-[#4338CA] text-[28px]">group</span>
           Globalni Użytkownicy
         </h1>
         <button 
           onClick={async () => {
             const btn = document.activeElement as HTMLButtonElement;
             const originalText = btn.innerHTML;
             btn.innerHTML = '<span class="material-symbols-outlined animate-spin text-[16px]">sync</span> Przetwarzanie...';
             btn.disabled = true;
             try {
               const count = await syncAllMembershipsUIDs();
               alert(`Sukces bazy danych! Przypisano brakujące pola UID do ${count} archiwalnych dokumentów.`);
             } catch (err: any) {
               alert('Błąd synchronizacji: ' + err.message);
             } finally {
               btn.innerHTML = originalText;
               btn.disabled = false;
             }
           }}
           className="bg-[#F8FAFC] border border-[#CBD5E1] text-[#334155] px-4 py-2 rounded-xl text-[13px] font-bold hover:bg-[#F1F5F9] transition-colors flex items-center gap-2 disabled:opacity-50"
         >
           <span className="material-symbols-outlined text-[16px] text-[#4338CA]">database_sync</span>
           Napraw brakujące UID (Archiwum)
         </button>
       </div>
       
       {error && (
         <div className="mb-6 bg-[#FEF2F2] border border-[#FCA5A5] text-[#991B1B] p-4 rounded-xl flex items-center gap-3 text-[13px] font-bold">
           <span className="material-symbols-outlined">error</span>
           {error}
         </div>
       )}

       {membershipsError && (
         <div className="mb-6 bg-[#FFFBEB] border border-[#FDE68A] p-4 rounded-xl flex items-start gap-3">
           <span className="material-symbols-outlined text-[#D97706] mt-0.5">warning</span>
           <div>
             <h3 className="text-[13px] font-bold text-[#D97706]">Częściowa utrata widoczności (Problem z doczytaniem członkostw Firestore)</h3>
             <p className="text-[12px] text-[#B45309] mt-1">{membershipsError}</p>
           </div>
         </div>
       )}

       <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
         <div className="overflow-x-auto">
           <table className="min-w-full divide-y divide-[#E2E8F0] text-left text-sm">
              <thead className="bg-[#F8FAFC]">
                <tr>
                  <th className="px-6 py-4 font-semibold text-[#64748B] text-[12px] uppercase tracking-wider">Użytkownik</th>
                  <th className="px-6 py-4 font-semibold text-[#64748B] text-[12px] uppercase tracking-wider">Rola (Global)</th>
                  <th className="px-6 py-4 font-semibold text-[#64748B] text-[12px] uppercase tracking-wider">Logowanie</th>
                  <th className="px-6 py-4 font-semibold text-[#64748B] text-[12px] uppercase tracking-wider text-center">Firmy</th>
                  <th className="px-6 py-4 font-semibold text-[#64748B] text-[12px] uppercase tracking-wider">Dołączono</th>
                  <th className="px-6 py-4 text-right font-semibold text-[#64748B] text-[12px] uppercase tracking-wider">Akcje</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9] bg-white">
                {users.map((user) => (
                  <tr key={user.uid} className="hover:bg-[#F8FAFC] transition-colors group cursor-pointer" onClick={() => setSelectedUser(user)}>
                     <td className="px-6 py-4 whitespace-nowrap">
                       <div className="flex items-center gap-3">
                         {user.avatarUrl ? (
                           <img src={user.avatarUrl} alt="" className="h-9 w-9 rounded-full border border-[#E2E8F0] object-cover" />
                         ) : (
                           <div className="h-9 w-9 rounded-full bg-[#E0E7FF] text-[#4338CA] flex items-center justify-center font-bold text-[14px]">
                             {user.displayName?.charAt(0) || (user.email || '?').charAt(0).toUpperCase()}
                           </div>
                         )}
                         <div>
                           <p className="font-bold text-[#0F172A] text-[13px]">{user.displayName || user.email}</p>
                           <p className="text-[12px] text-[#64748B] font-medium">{user.email || 'Brak adresu e-mail'}</p>
                         </div>
                       </div>
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${user.globalRole === 'superadmin' ? 'bg-[#FEF2F2] text-[#991B1B] border-[#FCA5A5]' : 'bg-[#F1F5F9] text-[#475569] border-[#CBD5E1]'}`}>
                           {(user.globalRole || 'USER').toUpperCase()}
                        </span>
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {user.authProviders?.includes('password') && <span className="material-symbols-outlined text-[16px] text-[#64748B]" title="Hasło">password</span>}
                          {user.authProviders?.includes('google.com') && <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-[14px] h-[14px]" title="Google" />}
                          {(!user.authProviders || user.authProviders.length === 0) && <span className="material-symbols-outlined text-[16px] text-[#64748B]" title="Stare konto - Hasło">password</span>}
                        </div>
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap text-center">
                        {user.membershipCount === null ? (
                          <span className="material-symbols-outlined animate-spin text-[16px] text-[#94A3B8]">sync</span>
                        ) : (
                          <span className="inline-flex items-center justify-center min-w-[24px] px-1 h-6 rounded-full bg-[#F1F5F9] text-[#475569] text-[12px] font-bold border border-[#CBD5E1]">
                            {user.membershipCount}
                          </span>
                        )}
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap text-[13px] text-[#475569] font-medium">
                        {formatDate(user.createdAt)}
                     </td>
                     <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button 
                          onClick={(e) => { e.stopPropagation(); setSelectedUser(user); }}
                          className="text-[#4338CA] hover:text-[#312E81] flex items-center gap-1 ml-auto font-semibold bg-[#EEF2FF] px-3 py-1.5 rounded-lg border border-[#C7D2FE] transition-colors"
                        >
                          <span className="material-symbols-outlined text-[16px]">visibility</span>
                          Podgląd
                        </button>
                     </td>
                  </tr>
                ))}
                
                {users.length === 0 && !loading && (
                  <tr>
                     <td colSpan={6} className="px-6 py-12 text-center text-[#64748B]">
                        <span className="material-symbols-outlined text-[48px] text-[#CBD5E1] mb-2">group_off</span>
                        <p className="text-[14px] font-medium">Brak użytkowników do wyświetlenia.</p>
                     </td>
                  </tr>
                )}
              </tbody>
           </table>
         </div>
         
         {loading && (
           <div className="px-6 py-12 text-center text-[#4338CA]">
              <span className="material-symbols-outlined animate-spin text-[32px]">sync</span>
              <p className="mt-2 text-[13px] font-bold text-[#64748B]">Wczytywanie użytkowników...</p>
           </div>
         )}
         
         {hasMore && !loading && (
            <div className="px-6 py-4 border-t border-[#E2E8F0] bg-[#F8FAFC] text-center">
               <button 
                 onClick={loadMore}
                 className="px-5 py-2.5 bg-white border border-[#CBD5E1] text-[#334155] font-bold text-[13px] rounded-lg shadow-sm hover:bg-[#F1F5F9] transition-colors"
               >
                 Załaduj więcej rekordów
               </button>
            </div>
         )}
       </div>

        <UserDetailsPanel 
           user={selectedUser} 
           membershipsLoading={membershipsLoading}
           membershipsError={membershipsError}
           onClose={() => setSelectedUser(null)} 
           onToggleRole={(uid, r) => {
             handleToggleRole(uid, r);
             if (selectedUser) {
               setSelectedUser({ ...selectedUser, globalRole: r === 'superadmin' ? 'user' : 'superadmin' });
             }
           }}
           onUpdateAccountStatus={(uid, status) => {
             handleUpdateAccountStatus(uid, status);
             if (selectedUser) {
               setSelectedUser({ ...selectedUser, accountStatus: status });
             }
           }}
           onHardDelete={handleHardDeleteUser}
           onRemoveMembership={(uid, cid) => {
             handleRemoveMembership(uid, cid);
             if (selectedUser) {
                const newMemberships = selectedUser.memberships.filter(m => m.companyId !== cid);
                setSelectedUser({ ...selectedUser, memberships: newMemberships, membershipCount: newMemberships.length });
             }
           }}
        />
     </div>
   );
}

export default function AdminUsersWrapper() {
  return (
    <ErrorBoundary>
      <AdminUsersContent />
    </ErrorBoundary>
  );
}
