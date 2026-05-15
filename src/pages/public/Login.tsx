import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { signInWithEmailAndPassword, signInWithPopup, sendPasswordResetEmail } from 'firebase/auth';
import { auth, googleProvider } from '../../firebase/config';
import { Link, useNavigate } from 'react-router-dom';
import { LanguageSelector } from '../../components/common/LanguageSelector';
import { syncGoogleUserProfile, updateLastLoginTimestamp } from '../../data/firestore';
import { useAuth } from '../../auth/useAuth';

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, profile, loading: authLoading, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  React.useEffect(() => {
    if (!authLoading && user && profile) {
      navigate('/');
    }
  }, [user, profile, authLoading, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const userCred = await signInWithEmailAndPassword(auth, email, password);
      await updateLastLoginTimestamp(userCred.user.uid);
      navigate('/');
    } catch (err: any) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setError('Nieprawidłowe dane logowania. Jeśli Twoje konto zostało zarejestrowane przez Google, użyj przycisku poniżej.');
      } else if (err.code === 'auth/network-request-failed' || err.message?.includes('Przekroczono limit')) {
        setError('Błąd połączenia z bazą lub emulatorem. Upewnij się, że Firebase (Auth/Firestore) jest poprawnie uruchomiony.');
      } else {
        setError(err.message || 'Wystąpił błąd logowania');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setLoadingGoogle(true);
    try {
      const userCred = await signInWithPopup(auth, googleProvider);
      await syncGoogleUserProfile(userCred.user);
      navigate('/');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Błąd logowania przez Google');
    } finally {
      setLoadingGoogle(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!email) {
      setError('Wpisz adres email w polu powyżej, aby zresetować hasło.');
      return;
    }
    setError('');
    setResetLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
      setTimeout(() => setResetSent(false), 5000);
    } catch (err: any) {
      if (err.code === 'auth/user-not-found') {
        setError('Nie znaleziono konta z tym adresem email.');
      } else {
        setError('Wystąpił błąd podczas wysyłania linku.');
      }
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <>
      <div className="absolute top-6 right-8">
        <LanguageSelector variant="auth" />
      </div>
      <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 max-w-md mx-auto w-full mt-12">
        <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">{t('login.title')}</h2>
      
      {error && <div className="mb-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">{error}</div>}
      
      {user && !profile && !authLoading && (
        <div className="mb-4 bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-3 rounded text-sm mb-6">
          <strong>Brak profilu w bazie.</strong> Zalogowano pomyślnie, ale Twoje konto nie ma dokumentu systemowego. Skontaktuj się z administratorem.
          <button type="button" onClick={logout} className="ml-2 font-bold underline">Wyloguj</button>
        </div>
      )}
      
      <form onSubmit={handleLogin} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700">Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="mt-1 appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Hasło</label>
          <div className="relative mt-1">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm pr-10"
              required
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-500">
              <span className="material-symbols-outlined text-[20px]">{showPassword ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
        </div>
        
        <div className="flex items-center justify-end mt-2">
          <button 
            type="button" 
            onClick={handlePasswordReset} 
            disabled={resetLoading} 
            className="text-sm font-medium text-primary-600 hover:text-primary-500 transition-colors"
          >
            {resetLoading ? 'Wysyłanie...' : 'Zapomniałeś hasła?'}
          </button>
        </div>
        
        {resetSent && (
          <div className="text-sm text-green-600 font-medium bg-green-50 p-2 rounded-md border border-green-200">
            Link do resetu hasła został wysłany na {email}. Sprawdź skrzynkę!
          </div>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50"
        >
          {loading ? 'Logowanie...' : t('login.submit')}
        </button>
      </form>

      <div className="mt-6">
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-gray-500">Albo użyj</span>
          </div>
        </div>
        <div className="mt-6">
          <button
            onClick={handleGoogleLogin}
            disabled={loadingGoogle || loading}
            className="w-full flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 gap-2 transition-colors"
          >
            {loadingGoogle ? (
              <span className="material-symbols-outlined text-[18px] animate-spin text-gray-400">sync</span>
            ) : (
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-4 h-4" />
            )}
            Zaloguj się przez Google
          </button>
        </div>
      </div>
      
      <div className="mt-6 text-center">
        <Link to="/register" className="text-primary-600 hover:text-primary-500 font-medium">
          {t('login.register')}
        </Link>
      </div>
    </div>
    </>
  );
}
