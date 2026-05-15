import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { updatePassword } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import { useAuth } from '../../auth/useAuth';

export default function ForcePasswordChange() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Hasła nie są identyczne.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Hasło musi mieć co najmniej 6 znaków.');
      return;
    }

    if (!auth.currentUser || !profile) {
      setError('Brak aktywnej sesji użytkownika.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Zmień hasło w Firebase Auth
      await updatePassword(auth.currentUser, newPassword);

      // Usuń flagę z Firestore
      const userRef = doc(db, 'users', profile.uid);
      await updateDoc(userRef, {
        requirePasswordChange: false
      });

      // Zakończ sukcesem i wymuś świeżną weryfikację uprawnień
      navigate('/', { replace: true });

    } catch (err: any) {
      let msg = 'Błąd podczas zmiany hasła: ' + err.message;
      if (err.code === 'auth/requires-recent-login') {
        msg = 'Ze względów bezpieczeństwa musisz wylogować i zalogować się ponownie tymczasowym hasłem, by móc je zmienić.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-xl">
        <div className="flex justify-center mb-6">
          <div className="h-14 w-14 bg-[#FEF2F2] rounded-full flex items-center justify-center">
            <span className="material-symbols-outlined text-[#991B1B] text-[28px]">lock_reset</span>
          </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-[#0F172A] mb-2">Wymagana Zmiana Hasła</h2>
        <p className="text-center text-[#64748B] text-[14px] mb-8">
          Logujesz się na to konto po raz pierwszy używając hasła tymczasowego. Ze względów bezpieczeństwa musisz ustanowić swoje własne, stałe hasło.
        </p>

        {error && (
          <div className="mb-6 p-4 bg-[#FEF2F2] text-[#991B1B] rounded-xl border border-[#FECACA] flex items-center gap-3 text-[13px] font-medium">
            <span className="material-symbols-outlined">error</span>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[13px] font-bold text-[#475569] mb-1.5 uppercase tracking-wider">Nowe Hasło</label>
            <input 
              required 
              type="password" 
              value={newPassword} 
              onChange={e => setNewPassword(e.target.value)} 
              className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-xl text-[14px] focus:ring-[#4338CA] focus:border-[#4338CA] transition-colors"
            />
          </div>
          <div>
            <label className="block text-[13px] font-bold text-[#475569] mb-1.5 uppercase tracking-wider">Potwierdź Nowe Hasło</label>
            <input 
              required 
              type="password" 
              value={confirmPassword} 
              onChange={e => setConfirmPassword(e.target.value)} 
              className="w-full h-[44px] px-3 border border-[#CBD5E1] rounded-xl text-[14px] focus:ring-[#4338CA] focus:border-[#4338CA] transition-colors"
            />
          </div>
          <button 
            type="submit" 
            disabled={loading} 
            className="w-full h-[44px] mt-4 bg-[#0F172A] text-white font-bold rounded-xl hover:bg-[#1E293B] disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-md"
          >
            {loading ? <span className="material-symbols-outlined text-[18px] animate-spin">sync</span> : <span className="material-symbols-outlined text-[18px]">save</span>}
            {loading ? 'Zapisywanie...' : 'Zmień hasło i wejdź'}
          </button>
        </form>
      </div>
    </div>
  );
}
