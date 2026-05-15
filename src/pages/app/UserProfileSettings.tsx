import React, { useState } from 'react';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../firebase/config';
import { useAuth } from '../../auth/useAuth';
import { updateUserProfile } from '../../data/firestore';
import { useTranslation } from 'react-i18next';

export default function UserProfileSettings() {
  const { user, profile, updateSessionProfile } = useAuth();
  const { t } = useTranslation();
  
  // Kompatybilność wsteczna: jeśli profil nie ma tablicy authProviders (stare konta), zgadujemy, że główną metodą było hasło
  const hasProvidersList = Array.isArray(profile?.authProviders) && profile.authProviders.length > 0;
  const hasPasswordAuth = hasProvidersList ? profile.authProviders.includes('password') : true;
  const hasGoogleAuth = hasProvidersList ? profile.authProviders.includes('google.com') : false;
  
  // Profile Form state
  const [firstName, setFirstName] = useState(profile?.firstName || '');
  const [lastName, setLastName] = useState(profile?.lastName || '');
  const [displayName, setDisplayName] = useState(profile?.displayName || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState({ type: '', text: '' });

  // Password Update state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMessage, setPwdMessage] = useState({ type: '', text: '' });

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.uid) return;
    
    setProfileSaving(true);
    setProfileMessage({ type: '', text: '' });
    
    try {
      const updates = {
        firstName,
        lastName,
        displayName: displayName || null,
        phone
      };
      await updateUserProfile(profile.uid, updates);
      updateSessionProfile(updates);
      setProfileMessage({ type: 'success', text: 'Zaktualizowano dane profilu.' });
    } catch (err: any) {
      console.error(err);
      setProfileMessage({ type: 'error', text: 'Błąd podczas zapisywania profilu.' });
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !user.email) return;

    if (newPassword !== confirmPassword) {
      setPwdMessage({ type: 'error', text: 'Hasła nie pasują do siebie.' });
      return;
    }

    if (newPassword.length < 6) {
      setPwdMessage({ type: 'error', text: 'Zbyt słabe hasło. Minimum 6 znaków.' });
      return;
    }

    setPwdSaving(true);
    setPwdMessage({ type: '', text: '' });

    try {
      // Wymagaj re-autoryzacji przed zmiana hasła w Firebase (zgodnie ze standardami bezpieczeństwa)
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      
      // Zmiana hasla
      await updatePassword(user, newPassword);
      
      setPwdMessage({ type: 'success', text: 'Hasło zostało zmienione.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setPwdMessage({ type: 'error', text: 'Obecne hasło jest nieprawidłowe.' });
      } else {
        setPwdMessage({ type: 'error', text: err.message || 'Wystąpił błąd podczas zmiany hasła.' });
      }
    } finally {
      setPwdSaving(false);
    }
  };

  const handleSendResetEmail = async () => {
    if (!profile?.email) return;
    try {
      await sendPasswordResetEmail(auth, profile.email);
      setPwdMessage({ type: 'success', text: `Link do resetu hasła wysłany na aders: ${profile.email}` });
    } catch (err: any) {
      setPwdMessage({ type: 'error', text: 'Nie udało się wysłać linku resetowania.' });
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-6">
      <h1 className="text-xl font-semibold text-[#0F172A] mb-5 tracking-tight flex items-center gap-2">
        <span className="material-symbols-outlined text-[#4338CA]">person</span>
        {t('profile.title')}
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Dane podstawowe */}
        <div className="bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] rounded-2xl p-6 border border-[#E2E8F0]">
          <h2 className="text-[15px] font-semibold text-[#0F172A] mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-[#64748B] text-[20px]">badge</span>
            {t('profile.personalData')}
          </h2>
          
          {profileMessage.text && (
            <div className={`p-4 mb-5 rounded-2xl flex items-center gap-3 text-[13px] font-medium ${profileMessage.type === 'success' ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#FEF2F2] text-[#991B1B]'}`}>
              <span className="material-symbols-outlined">{profileMessage.type === 'success' ? 'check_circle' : 'error'}</span>
              {profileMessage.text}
            </div>
          )}

          <form onSubmit={handleProfileSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('profile.firstName')}</label>
                <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA]" />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('profile.lastName')}</label>
                <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA]" />
              </div>
            </div>
            
            <div>
              <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('profile.displayName')}</label>
              <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA]" placeholder="np. Jan K. (Marketing)" />
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('profile.email')}</label>
              <input type="email" value={profile?.email || ''} disabled className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#64748B] bg-[#F8FAFC]" />
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('profile.phone')}</label>
              <input type="text" value={phone} onChange={e => setPhone(e.target.value)} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA]" placeholder="+48 ..." />
            </div>

            <div className="pt-2 flex justify-end flex-col mt-4">
              <button
                type="submit"
                disabled={profileSaving}
                className="px-6 h-[40px] rounded-full shadow-sm text-[13px] font-semibold text-white bg-[#4338CA] hover:bg-[#3730A3] disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">{profileSaving ? 'sync' : 'save'}</span>
                {profileSaving ? t('profile.saving') : t('profile.saveProfile')}
              </button>
            </div>
          </form>
        </div>

        {/* Zmiana Hasła */}
        <div className="bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] rounded-2xl p-6 border border-[#E2E8F0]">
          <h2 className="text-[15px] font-semibold text-[#0F172A] mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-[#64748B] text-[20px]">lock_reset</span>
            {t('profile.security')}
          </h2>

          {pwdMessage.text && (
            <div className={`p-4 mb-5 rounded-2xl flex items-center gap-3 text-[13px] font-medium ${pwdMessage.type === 'success' ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#FEF2F2] text-[#991B1B]'}`}>
              <span className="material-symbols-outlined">{pwdMessage.type === 'success' ? 'check_circle' : 'error'}</span>
              {pwdMessage.text}
            </div>
          )}

          <div className="mb-6">
            <h3 className="text-[13px] font-semibold text-[#0F172A] mb-3 uppercase tracking-wider">{t('profile.connectedMethods')}</h3>
            <div className="flex gap-3">
              {hasPasswordAuth && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F1F5F9] rounded-lg text-[13px] font-medium text-[#334155] border border-[#E2E8F0]">
                  <span className="material-symbols-outlined text-[18px]">password</span>
                  {t('profile.methodPassword')}
                </div>
              )}
              {hasGoogleAuth && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F1F5F9] rounded-lg text-[13px] font-medium text-[#334155] border border-[#E2E8F0]">
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-4 h-4" />
                  {t('profile.methodGoogle')}
                </div>
              )}
              {!hasProvidersList && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F1F5F9] rounded-lg text-[13px] font-medium text-[#334155] border border-[#E2E8F0]">
                  <span className="material-symbols-outlined text-[18px]">password</span>
                  {t('profile.methodPassword')}
                </div>
              )}
              {hasProvidersList && !hasPasswordAuth && !hasGoogleAuth && (
                <span className="text-[13px] text-[#64748B]">{t('profile.noMethodsData')}</span>
              )}
            </div>
          </div>
          
          <div className="h-px w-full bg-[#E2E8F0] my-4"></div>

          {!hasPasswordAuth ? (
             <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-center mb-2 mt-4">
               <span className="material-symbols-outlined text-[#64748B] text-[24px] mb-2 block">info</span>
               <p className="text-[13px] text-[#475569] font-medium">{t('profile.googleOnlyMessage')}</p>
             </div>
          ) : (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('profile.currentPassword')}</label>
              <input required type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA]" />
            </div>
            
            <div className="h-px w-full bg-[#E2E8F0] my-2"></div>

            <div>
              <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('profile.newPassword')}</label>
              <input required type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA]" />
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#64748B] mb-1.5 uppercase tracking-wider">{t('profile.repeatPassword')}</label>
              <input required type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full h-[40px] px-3 border border-[#CBD5E1] rounded-xl text-[13px] text-[#0F172A] focus:ring-[#4338CA] focus:border-[#4338CA]" />
            </div>

            <div className="pt-2 flex justify-end flex-col sm:flex-row mt-4 gap-3">
              <button
                type="button"
                onClick={handleSendResetEmail}
                className="px-6 h-[40px] rounded-full shadow-sm text-[13px] font-semibold text-[#64748B] hover:bg-[#F1F5F9] transition-colors border border-[#E2E8F0]"
              >
                {t('profile.sendResetEmail')}
              </button>
              <button
                type="submit"
                disabled={pwdSaving}
                className="px-6 h-[40px] rounded-full shadow-sm text-[13px] font-semibold text-[#4338CA] bg-[#E0E7FF] hover:bg-[#C7D2FE] disabled:opacity-50 transition-colors flex items-center justify-center gap-2 border border-[#818CF8]"
              >
                <span className="material-symbols-outlined text-[18px]">{pwdSaving ? 'sync' : 'key'}</span>
                {pwdSaving ? t('profile.changing') : t('profile.changePassword')}
              </button>
            </div>
          </form>
          )}
        </div>

      </div>
    </div>
  );
}
