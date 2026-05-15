import React, { useEffect, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { getCompanyMembers, getCompanyInvites, inviteUserToCompany, updateCompanyMemberStatus, sendMemberPasswordReset, acceptCompanyInviteAndCreateAccount, deleteCompanyInvite } from '../../data/company';
import type { CompanyMemberWithProfile, CompanyInvite, UserRole } from '../../data/types';
import { getUserDisplayName } from '../../utils/user';
import { useTranslation } from 'react-i18next';

export default function CompanyTeam() {
  const { t } = useTranslation();
  const { profile, membership } = useAuth();
  const [members, setMembers] = useState<CompanyMemberWithProfile[]>([]);
  const [invites, setInvites] = useState<CompanyInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteForm, setShowInviteForm] = useState(false);
  
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('worker');
  const [inviteStatus, setInviteStatus] = useState({ loading: false, error: '', success: false });

  const [generatedPassword, setGeneratedPassword] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const canView = profile?.globalRole === 'superadmin' || membership?.role === 'admin' || membership?.role === 'company_owner' || membership?.role === 'company_admin' || membership?.permissions?.includes('company.members.view');
  const canManage = profile?.globalRole === 'superadmin' || membership?.role === 'admin' || membership?.role === 'company_owner' || membership?.role === 'company_admin' || membership?.permissions?.includes('company.members.manage');

  useEffect(() => {
    async function fetchData() {
      if (profile?.activeCompanyId && canView) {
        try {
          const fetchedMembers = await getCompanyMembers(profile.activeCompanyId);
          setMembers(fetchedMembers);
          
          if (canManage) {
            const fetchedInvites = await getCompanyInvites(profile.activeCompanyId);
            setInvites(fetchedInvites);
          }
        } catch (e) {
          console.error('Błąd pobierania zespołu', e);
        }
      }
      setLoading(false);
    }
    fetchData();
  }, [profile?.activeCompanyId, canView, canManage]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.activeCompanyId || !profile.uid) return;
    
    setInviteStatus({ loading: true, error: '', success: false });
    try {
      await inviteUserToCompany(profile.activeCompanyId, {
        email: inviteEmail,
        role: inviteRole,
        permissions: [],
        language: 'pl'
      }, profile.uid);
      setInviteStatus({ loading: false, error: '', success: true });
      setShowInviteForm(false);
      setInviteEmail('');
      const fetched = await getCompanyInvites(profile.activeCompanyId);
      setInvites(fetched);
    } catch (err: any) {
      setInviteStatus({ loading: false, error: err.message || t('team.messages.inviteError'), success: false });
    }
  };

  const handleUpdateStatus = async (uid: string, newStatus: 'active' | 'suspended' | 'removed') => {
    if (!profile?.activeCompanyId || !profile.uid) return;
    try {
      await updateCompanyMemberStatus(profile.activeCompanyId, uid, newStatus, profile.uid);
      const fetchedMembers = await getCompanyMembers(profile.activeCompanyId);
      setMembers(fetchedMembers);
    } catch (err: any) {
      alert(`${t('team.messages.statusUpdateError')} ${err.message}`);
    }
  };

  const handleResetPassword = async (email: string) => {
    try {
      await sendMemberPasswordReset(email);
      alert(`${t('team.messages.passwordResetSent')} ${email}`);
    } catch (err: any) {
      alert(`${t('team.messages.passwordResetError')} ${err.message}`);
    }
  };

  const handleAcceptInvite = async (invite: CompanyInvite) => {
    if (!profile?.activeCompanyId || !profile.uid) return;
    try {
      const tempPassword = await acceptCompanyInviteAndCreateAccount(profile.activeCompanyId, invite, profile.uid);
      
      if (tempPassword) {
        setGeneratedPassword(tempPassword);
        setShowPasswordModal(true);
      } else {
        alert(t('team.messages.inviteAcceptedNoPassword'));
      }
      
      const [fetchedMembers, fetchedInvites] = await Promise.all([
        getCompanyMembers(profile.activeCompanyId),
        getCompanyInvites(profile.activeCompanyId)
      ]);
      setMembers(fetchedMembers);
      setInvites(fetchedInvites);
    } catch (err: any) {
      alert(`${t('team.messages.inviteAcceptError')} ${err.message}`);
    }
  };

  const handleDeleteInvite = async (inviteId: string) => {
    if (!profile?.activeCompanyId || !profile.uid) return;
    try {
      await deleteCompanyInvite(profile.activeCompanyId, inviteId, profile.uid);
      const fetchedInvites = await getCompanyInvites(profile.activeCompanyId);
      setInvites(fetchedInvites);
    } catch (err: any) {
      alert(`${t('team.messages.inviteDeleteError')} ${err.message}`);
    }
  };

  if (!canView) return <div className="p-8 text-[#DC2626] bg-[#FEF2F2] rounded-2xl">{t('team.messages.noViewAccess')}</div>;
  if (loading) return <div className="p-8 text-[#64748B]">{t('team.messages.loading')}</div>;

  return (
    <div className="max-w-6xl mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-xl font-semibold text-[#0F172A] tracking-tight flex items-center gap-2">
          <span className="material-symbols-outlined text-[#4338CA]">group</span>
          {t('team.title')}
        </h1>
        {canManage && (
          <button 
            onClick={() => setShowInviteForm(!showInviteForm)}
            className="h-[40px] px-5 bg-[#4338CA] text-white rounded-full hover:bg-[#3730A3] text-[13px] font-semibold shadow-sm transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">
              {showInviteForm ? 'close' : 'person_add'}
            </span>
            {showInviteForm ? t('team.buttons.cancel') : t('team.buttons.invite')}
          </button>
        )}
      </div>

      {inviteStatus.success && (
        <div className="mb-5 p-4 bg-[#DCFCE7] text-[#166534] rounded-2xl border border-[#BBF7D0] flex items-center gap-3 text-[13px] font-medium">
          <span className="material-symbols-outlined">check_circle</span>
          {t('team.messages.inviteSuccess')}
        </div>
      )}
      {inviteStatus.error && (
        <div className="mb-5 p-4 bg-[#FEF2F2] text-[#991B1B] rounded-2xl border border-[#FECACA] flex items-center gap-3 text-[13px] font-medium">
          <span className="material-symbols-outlined">error</span>
          {inviteStatus.error}
        </div>
      )}

      {showInviteForm && canManage && (
        <div className="bg-white p-5 rounded-2xl mb-8 shadow-[0_1px_2px_rgba(0,0,0,0.05)] border border-[#E2E8F0]">
          <h2 className="text-[15px] font-semibold text-[#0F172A] mb-4">{t('team.inviteForm.title')}</h2>
          <form onSubmit={handleInvite} className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 w-full">
              <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('team.inviteForm.emailLabel')}</label>
              <input required type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA]" placeholder={t('team.inviteForm.emailPlaceholder')} />
            </div>
            <div className="w-full md:w-64">
              <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('team.inviteForm.roleLabel')}</label>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value as UserRole)} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA] bg-white cursor-pointer">
                <option value="worker">{t('team.inviteForm.roles.worker')}</option>
                <option value="company_admin">{t('team.inviteForm.roles.company_admin')}</option>
                <option value="viewer">{t('team.inviteForm.roles.viewer')}</option>
              </select>
            </div>
            <button type="submit" disabled={inviteStatus.loading} className="w-full md:w-auto px-6 h-[40px] bg-[#0F172A] text-white font-semibold rounded-full hover:bg-[#1E293B] disabled:opacity-50 transition-colors text-[13px] flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">{inviteStatus.loading ? 'sync' : 'send'}</span>
              {inviteStatus.loading ? t('team.buttons.sending') : t('team.buttons.sendInvite')}
            </button>
          </form>
        </div>
      )}

      {/* Tabela Wygenerowanych Oczekujących Zaproszeń */}
      {canManage && invites.length > 0 && (
        <div className="mb-8">
          <h2 className="text-[15px] font-semibold text-[#0F172A] mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-[#64748B] text-[20px]">drafts</span>
            {t('team.tables.invitesTitle')}
          </h2>
          <div className="bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-hidden rounded-2xl border border-[#E2E8F0]">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[#E2E8F0] text-[13px]">
                <thead className="bg-[#F8FAFC]">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider">{t('team.tables.invites.email')}</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider">{t('team.tables.invites.role')}</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider">{t('team.tables.invites.status')}</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider">{t('team.tables.invites.createdAt')}</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold text-[#64748B] uppercase tracking-wider">{t('team.tables.invites.actions')}</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-[#F1F5F9]">
                  {invites.map((invite) => (
                    <tr key={invite.id} className="hover:bg-[#F8FAFC] transition-colors">
                      <td className="px-4 py-2.5 whitespace-nowrap font-medium text-[#0F172A]">{invite.email}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap"><span className="px-2 py-0.5 inline-flex text-[11px] leading-tight font-bold rounded-md bg-[#E0E7FF] text-[#4338CA]">{invite.role}</span></td>
                      <td className="px-4 py-2.5 whitespace-nowrap"><span className="px-2 py-0.5 inline-flex text-[11px] leading-tight font-bold rounded-md bg-[#FEF3C7] text-[#D97706]">{t('team.tables.invites.statusPending')}</span></td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-[#64748B]">{new Date(invite.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-right">
                        {canManage && (
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => { if(window.confirm(t('team.messages.confirmAccept', 'Czy na pewno chcesz utworzyć konto i wygenerować mu stałe miejsce?'))) handleAcceptInvite(invite) }} className="bg-[#4338CA] text-white hover:bg-[#3730A3] px-3 py-1 rounded-lg text-[12px] font-bold transition-colors">{t('team.buttons.acceptAndGenerate')}</button>
                            <button onClick={() => { if(window.confirm(t('team.messages.confirmDeleteInvite', 'Usunąć to zaproszenie?'))) handleDeleteInvite(invite.id) }} className="text-[#991B1B] bg-[#FEF2F2] hover:bg-[#FECACA] px-2 py-1 rounded-md text-[12px] font-bold transition-colors flex items-center" title="Usuń">
                               <span className="material-symbols-outlined text-[16px]">delete</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tabela Aktywnych Członków */}
      <div>
        <h2 className="text-[15px] font-semibold text-[#0F172A] mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-[#64748B] text-[20px]">verified_user</span>
          {t('team.tables.membersTitle')}
        </h2>
        <div className="bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] overflow-hidden rounded-2xl border border-[#E2E8F0]">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[#E2E8F0] text-[13px]">
              <thead className="bg-[#F8FAFC]">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider">{t('team.tables.members.user')}</th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider">{t('team.tables.members.role')}</th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider">{t('team.tables.members.status')}</th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase tracking-wider">{t('team.tables.members.joinedAt')}</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold text-[#64748B] uppercase tracking-wider">{t('team.tables.members.actions')}</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-[#F1F5F9]">
                {members.map((member) => {
                  const displayName = getUserDisplayName(member.profile);
                  const initial = displayName.charAt(0).toUpperCase();

                  return (
                  <tr key={member.uid} className="hover:bg-[#F8FAFC] transition-colors">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-[36px] w-[36px] bg-[#E0E7FF] text-[#4338CA] rounded-full flex items-center justify-center font-bold uppercase">
                          {initial}
                        </div>
                        <div className="ml-3">
                          <div className="font-semibold text-[#0F172A]">{displayName}</div>
                          <div className="text-[12px] text-[#64748B]">{member.profile?.email || '-'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="px-2 py-0.5 inline-flex text-[11px] leading-tight font-bold rounded-md bg-[#E0E7FF] text-[#4338CA]">
                        {member.role}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className={`px-2 py-0.5 inline-flex text-[11px] leading-tight font-bold rounded-md ${
                        member.status === 'active' ? 'bg-[#DCFCE7] text-[#166534]' : 
                        member.status === 'suspended' ? 'bg-[#FEF2F2] text-[#991B1B]' : 'bg-[#F1F5F9] text-[#475569]'
                      }`}>
                        {member.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-[#64748B]">
                      {member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-right">
                      {canManage && member.role !== 'company_owner' && member.uid !== profile?.uid && (
                        <div className="flex items-center justify-end gap-2">
                          {(member.status === 'invited' || member.status === 'pending') && (
                            <>
                              <button onClick={() => handleUpdateStatus(member.uid, 'active')} className="bg-[#DCFCE7] text-[#166534] hover:bg-[#BBF7D0] px-3 py-1 rounded-lg text-[12px] font-bold transition-colors">{t('team.buttons.accept')}</button>
                              <button onClick={() => { if(window.confirm(t('team.messages.confirmReject', 'Odrzucić zaproszenie?'))) handleUpdateStatus(member.uid, 'removed') }} className="bg-[#FEF2F2] text-[#991B1B] hover:bg-[#FECACA] px-3 py-1 rounded-lg text-[12px] font-bold transition-colors">{t('team.buttons.reject')}</button>
                            </>
                          )}
                          {member.status === 'active' && (
                            <>
                              <button onClick={() => { if(window.confirm(t('team.messages.confirmSuspend', 'Zawiesić użytkownika w firmie?'))) handleUpdateStatus(member.uid, 'suspended') }} className="text-[#D97706] bg-[#FEF3C7] hover:bg-[#FDE68A] px-2 py-1 rounded-md text-[12px] font-bold transition-colors" title="Zawieś">{t('team.buttons.suspend')}</button>
                              {member.profile?.authProviders?.includes('password') && (
                                <button onClick={() => { if(window.confirm(t('team.messages.confirmResetPassword', 'Wysłać e-mail do resetu hasła?'))) handleResetPassword(member.profile?.email || '') }} className="text-[#4338CA] bg-[#E0E7FF] hover:bg-[#C7D2FE] px-2 py-1 rounded-md text-[12px] font-bold transition-colors flex items-center" title="Wyślij link resetujący hasło">
                                  <span className="material-symbols-outlined text-[16px]">key</span>
                                </button>
                              )}
                            </>
                          )}
                          {member.status === 'suspended' && (
                            <>
                              <button onClick={() => handleUpdateStatus(member.uid, 'active')} className="bg-[#DCFCE7] text-[#166534] hover:bg-[#BBF7D0] px-3 py-1 rounded-lg text-[12px] font-bold transition-colors">{t('team.buttons.unblock')}</button>
                              <button onClick={() => { if(window.confirm(t('team.messages.confirmRemove', 'Usunąć całkowicie dostęp użytkownika do firmy?'))) handleUpdateStatus(member.uid, 'removed') }} className="text-[#991B1B] bg-[#FEF2F2] hover:bg-[#FECACA] px-2 py-1 rounded-md text-[12px] font-bold transition-colors flex items-center" title="Usuń z firmy">
                                 <span className="material-symbols-outlined text-[16px]">delete</span>
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                })}
                {members.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[#64748B]">
                      {t('team.tables.members.noUsers')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showPasswordModal && (
        <div className="fixed inset-0 z-50 bg-[#0F172A]/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col p-6 animate-in zoom-in-95">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-[#0F172A] flex items-center gap-2">
                <span className="material-symbols-outlined text-[#166534]">check_circle</span>
                {t('team.modals.passwordTitle')}
              </h3>
            </div>
            <p className="text-[14px] text-[#475569] mb-4">
              {t('team.modals.passwordDesc')}
            </p>
            <div className="bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0] mb-6 flex items-center justify-between">
              <code className="text-[22px] font-mono font-bold text-[#0F172A] tracking-[0.2em]">{generatedPassword}</code>
              <button onClick={() => navigator.clipboard.writeText(generatedPassword)} className="text-[#4338CA] hover:bg-[#E0E7FF] p-2 rounded-lg transition-colors border border-transparent shadow-sm">
                <span className="material-symbols-outlined">content_copy</span>
              </button>
            </div>
            <button onClick={() => setShowPasswordModal(false)} className="w-full bg-[#0F172A] text-white font-bold py-3 rounded-xl hover:bg-[#1E293B] transition-colors relative">
              {t('team.modals.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
