import type { UserViewModel } from './hooks/useUsersList';

interface Props {
  user: UserViewModel | null;
  membershipsLoading: boolean;
  membershipsError: string;
  onClose: () => void;
  onToggleRole: (uid: string, currentRole: 'superadmin' | 'admin' | 'user') => void;
  onUpdateAccountStatus: (uid: string, status: 'active' | 'disabled' | 'deleted') => void;
  onHardDelete: (uid: string) => void;
  onRemoveMembership: (uid: string, companyId: string) => void;
}

export function UserDetailsPanel({ user, membershipsLoading, membershipsError, onClose, onToggleRole, onUpdateAccountStatus, onHardDelete, onRemoveMembership }: Props) {
  if (!user) return null;

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const formatDate = (ts?: number) => {
    if (!ts) return 'Brak danych';
    return new Date(ts).toLocaleString('pl-PL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0F172A]/40 backdrop-blur-sm flex justify-end" onClick={handleBackdrop}>
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#E2E8F0] shadow-sm bg-white z-10">
          <h2 className="text-lg font-bold text-[#0F172A] flex items-center gap-2">
            <span className="material-symbols-outlined text-[#4338CA]">person</span>
            Szczegóły konta
          </h2>
          <button onClick={onClose} className="text-[#64748B] hover:text-[#0F172A] transition-colors rounded-full hover:bg-[#F1F5F9] p-1 flex items-center justify-center">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-[#F8FAFC]">
          
          <div className="text-center p-6 bg-white rounded-2xl shadow-sm border border-[#E2E8F0]">
             {user.avatarUrl ? (
               <img src={user.avatarUrl} alt="Avatar" className="w-20 h-20 rounded-full mx-auto mb-3 border-2 border-[#E2E8F0]" />
             ) : (
               <div className="w-20 h-20 rounded-[28px] bg-[#EEF2FF] text-[#4338CA] flex items-center justify-center text-3xl font-bold mx-auto mb-4 border border-[#E0E7FF]">
                 {user.displayName?.charAt(0) || user.email.charAt(0).toUpperCase()}
               </div>
             )}
             <h3 className="text-lg font-bold text-[#0F172A]">{user.displayName || user.email}</h3>
             <p className="text-sm font-medium text-[#64748B] mb-4">{user.email}</p>
             <div className="flex items-center justify-center gap-2">
               <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${user.globalRole === 'superadmin' ? 'bg-[#FEF2F2] text-[#991B1B] border-[#FCA5A5]' : 'bg-[#F1F5F9] text-[#475569] border-[#CBD5E1]'}`}>
                 <span className="material-symbols-outlined text-[14px]">
                   {user.globalRole === 'superadmin' ? 'shield_person' : 'person'}
                 </span>
                 {user.globalRole.toUpperCase()}
               </span>
               <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border ${user.accountStatus === 'disabled' ? 'bg-[#FEF2F2] border-[#FCA5A5] text-[#991B1B]' : user.accountStatus === 'deleted' ? 'bg-[#F1F5F9] border-[#CBD5E1] text-[#475569]' : 'bg-[#ECFCCB] border-[#BEF264] text-[#3F6212]'}`}>
                 {user.accountStatus === 'disabled' ? 'ZAWIESZONE' : user.accountStatus === 'deleted' ? 'USUNIĘTE' : 'AKTYWNE'}
               </span>
             </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <h4 className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Metody logowania</h4>
            </div>
            <div className="p-5 flex flex-wrap gap-2">
               {user.authProviders?.includes('password') && (
                 <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F8FAFC] border border-[#CBD5E1] text-[13px] font-semibold text-[#334155] shadow-sm">
                   <span className="material-symbols-outlined text-[16px]">password</span> Hasło
                 </span>
               )}
               {user.authProviders?.includes('google.com') && (
                 <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F8FAFC] border border-[#CBD5E1] text-[13px] font-semibold text-[#334155] shadow-sm">
                   <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="G" className="w-[14px] h-[14px]" /> Google
                 </span>
               )}
               {(!user.authProviders || user.authProviders.length === 0) && (
                 <span className="text-[13px] text-[#64748B] font-medium bg-[#F1F5F9] px-3 py-1.5 rounded-lg border border-[#E2E8F0]">Brak danych o logowaniu (Legacy: Hasło)</span>
               )}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex justify-between items-center">
              <h4 className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Członkostwa w organizacjach</h4>
              <span className="bg-[#E2E8F0] text-[#475569] text-[11px] font-bold px-2 py-0.5 rounded-full">{user.membershipCount}</span>
            </div>
            <div className="p-5">
              {membershipsLoading ? (
                <div className="text-center py-4">
                   <span className="material-symbols-outlined animate-spin text-[32px] text-[#4338CA] mb-2">sync</span>
                   <p className="text-[13px] font-medium text-[#64748B]">Trwa odczyt z bazy Firestore...</p>
                </div>
              ) : membershipsError ? (
                <div className="text-center py-3 px-2 bg-[#FEF2F2] rounded-xl border border-[#FCA5A5]">
                   <span className="material-symbols-outlined text-[28px] text-[#991B1B] mb-2">shield_locked</span>
                   <p className="text-[13px] font-bold text-[#991B1B]">Błąd pobierania danych (Firebase SDK)</p>
                   <p className="text-[11px] font-medium text-[#991B1B] mt-1 text-left px-2 break-all">{membershipsError}</p>
                   <div className="text-[11px] font-medium text-[#991B1B] mt-2 border-t border-[#FCA5A5] pt-2 text-left px-2">
                     {membershipsError.includes('permission-denied') && (
                       <p><strong>Diagnoza:</strong> Brak reguł Security Rules dla odczytu <code>collectionGroup('members')</code> przez superadmina. Zaktualizuj plik firestore.rules.</p>
                     )}
                     {(membershipsError.includes('failed-precondition') || membershipsError.includes('index')) && (
                       <p><strong>Diagnoza:</strong> Brak indeksu Firebase dla optymalizującego zapytania typu CollectionGroup. Skopiuj link z konsoli (F12) do przeglądarki, by wygenerować indeks <code>uid</code> na <code>members</code>.</p>
                     )}
                     {!membershipsError.includes('permission-denied') && !membershipsError.includes('failed-precondition') && !membershipsError.includes('index') && (
                       <p><strong>Diagnoza:</strong> Niepoprawne zapytanie (Invalid Query) lub problem z odczytem bazy. Skonsultuj panel Google Cloud.</p>
                     )}
                   </div>
                </div>
              ) : user.memberships.length > 0 ? (
                <ul className="space-y-4">
                  {user.memberships.map((m) => (
                    <li key={m.companyId} className="flex flex-col gap-1 border-b border-[#F1F5F9] pb-4 last:border-0 last:pb-0">
                      <div className="flex justify-between items-center">
                         <span className="font-bold text-[14px] text-[#0F172A] bg-[#EEF2FF] text-[#4338CA] px-2 py-0.5 rounded-md border border-[#C7D2FE]" title={m.companyId}>{m.companyName ? `${m.companyName} (NIP: ${m.companyTaxId})` : m.companyId}</span>
                         <div className="flex items-center gap-2">
                           <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${m.member.status === 'active' ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#FEF2F2] text-[#991B1B]'}`}>{m.member.status.toUpperCase()}</span>
                           <button onClick={() => { if(window.confirm('Wyrzucić użytkownika z tej firmy?')) onRemoveMembership(user.uid, m.companyId) }} className="text-[#64748B] hover:text-[#991B1B] transition-colors bg-[#F1F5F9] hover:bg-[#FEF2F2] rounded-md p-1 border border-[#E2E8F0] hover:border-[#FCA5A5]" title="Usuń dostęp">
                             <span className="material-symbols-outlined text-[14px]">person_remove</span>
                           </button>
                         </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[12px] font-medium text-[#64748B] uppercase tracking-wide">{m.member.role}</span>
                        <span className="text-[#CBD5E1]">•</span>
                        <span className="text-[12px] text-[#94A3B8]">Od: {formatDate(m.member.joinedAt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-center py-4">
                   <span className="material-symbols-outlined text-[#CBD5E1] text-[32px] mb-2">domain_disabled</span>
                   <p className="text-[13px] font-medium text-[#64748B]">Ten użytkownik nie należy obecnie do żadnej firmy.</p>
                </div>
              )}
            </div>
          </div>
          
          <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] overflow-hidden">
             <div className="px-5 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC]">
               <h4 className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Zarządzanie bezpieczeństwem</h4>
             </div>
             <div className="p-5 flex flex-col gap-3">
               <button 
                 onClick={() => onToggleRole(user.uid, user.globalRole)}
                 className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 border rounded-xl font-bold transition-all shadow-sm text-[13px] ${
                   user.globalRole === 'superadmin' 
                    ? 'bg-white border-[#FCA5A5] text-[#B91C1C] hover:bg-[#FEF2F2]' 
                    : 'bg-white border-[#CBD5E1] text-[#334155] hover:bg-[#F8FAFC] hover:border-[#94A3B8]'
                 }`}
               >
                 <span className="material-symbols-outlined text-[18px]">
                   {user.globalRole === 'superadmin' ? 'remove_moderator' : 'admin_panel_settings'}
                 </span>
                 {user.globalRole === 'superadmin' ? 'Zdegraduj z roli Superadmina' : 'Nadaj uprawnienia Superadmina'}
               </button>
               
               <div className="border-t border-[#F1F5F9] my-2"></div>
               
               <button 
                 onClick={() => {
                   if(window.confirm(user.accountStatus === 'disabled' ? 'Odblokować uźytkownika?' : 'Zablokować to konto na platformie Gepard?')) {
                     onUpdateAccountStatus(user.uid, user.accountStatus === 'disabled' ? 'active' : 'disabled');
                   }
                 }}
                 className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border rounded-xl font-bold transition-all shadow-sm text-[13px] bg-white border-[#E2E8F0] text-[#0F172A] hover:bg-[#F8FAFC]"
               >
                 <span className="material-symbols-outlined text-[18px]">
                   {user.accountStatus === 'disabled' ? 'lock_open' : 'block'}
                 </span>
                 {user.accountStatus === 'disabled' ? 'Odblokuj Profil' : 'Deaktywuj Profil Globalnie'}
               </button>

               <button 
                 onClick={() => {
                   if (user.membershipCount && user.membershipCount > 0) {
                     alert("Odmowa: Nie możesz trwale usunąć konta powiązanego z firmami. Najpierw usuń uprawnienia, lub po prostu zablokuj profil (Deaktywacja).");
                     return;
                   }
                   if(window.prompt('OSTRZEŻENIE: WPISZ "DELETE" ABY TRWALE USUNĄĆ TO KONTO:') === 'DELETE') {
                     onHardDelete(user.uid);
                     onClose();
                   }
                 }}
                 className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 border rounded-xl font-bold transition-all shadow-[0_0_10px_rgba(239,68,68,0.1)] text-[13px] ${user.membershipCount && user.membershipCount > 0 ? 'bg-[#F1F5F9] border-[#E2E8F0] text-[#94A3B8] cursor-not-allowed' : 'bg-[#FEF2F2] border-[#FCA5A5] text-[#991B1B] hover:bg-[#FEE2E2]'}`}
               >
                 <span className="material-symbols-outlined text-[18px]">delete_forever</span>
                 Twarde usunięcie (Hard Delete)
               </button>
             </div>
          </div>
          
          <div className="text-center pb-8">
            <p className="text-[11px] font-medium text-[#94A3B8]">Utworzono: {formatDate(user.createdAt)}</p>
            {user.lastLoginAt && <p className="text-[11px] font-medium text-[#94A3B8]">Ostatnie logowanie: {formatDate(user.lastLoginAt)}</p>}
          </div>

        </div>
      </div>
    </div>
  );
}
