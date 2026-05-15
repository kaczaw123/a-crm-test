import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';

export const WorkerLayout: React.FC = () => {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <header className="bg-primary-600 text-white shadow h-16 flex items-center justify-between px-6">
        <h1 className="text-xl font-bold">Gepard Worker</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm">{profile?.email}</span>
          <button onClick={handleLogout} className="text-sm bg-primary-700 px-3 py-1 rounded hover:bg-primary-800">Wyloguj</button>
        </div>
      </header>
      <main className="p-4 sm:p-6 flex-1 overflow-auto max-w-7xl mx-auto w-full">
        <Outlet />
      </main>
    </div>
  );
};
