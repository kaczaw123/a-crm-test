
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';

export default function Unauthorized() {
  const { logout, systemError } = useAuth();
  
  if (systemError === 'offline') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 px-4">
        <div className="text-center max-w-lg">
          <span className="material-symbols-outlined text-6xl text-orange-500 mb-4 animate-pulse">cloud_off</span>
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">Baza Danych Offline</h2>
          <p className="text-gray-600 mb-8 font-mono text-sm bg-gray-100 p-4 rounded text-left">
            Nie można nawiązać połączenia z serwerem bazy danych (Firestore backend is unreachable / client is offline).
            <br/><br/>
            Upewnij się, że Emulator Firebase jest uruchomiony na porcie 8080 lub Twoje połączenie internetowe do chmury działa poprawnie.
          </p>
          <div className="flex gap-4 justify-center">
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition">
              Odśwież
            </button>
            <button onClick={() => logout()} className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition">
              Wyloguj się
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 px-4">
      <div className="text-center max-w-lg">
        <h1 className="text-6xl font-bold text-red-600 mb-4">403</h1>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Brak uprawnień / Konto Zablokowane</h2>
        <p className="text-gray-600 mb-8">
          Twoje konto zostało zablokowane, usunięte lub nie posiadasz odpowiedniej roli by uzyskać dostęp do panelu.
        </p>
        <div className="flex gap-4 justify-center">
          <Link to="/" className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition">
            Powrót
          </Link>
          <button onClick={() => logout()} className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition">
            Wyloguj się
          </button>
        </div>
      </div>
    </div>
  );
}
