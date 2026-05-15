import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

export const StatusGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, membership, loading } = useAuth();

  if (loading) {
    return <div className="flex h-screen items-center justify-center">Ladowanie statusu...</div>;
  }

  if (profile?.globalRole === 'superadmin' || profile?.globalRole === 'admin') {
    return <>{children}</>;
  }

  if (membership?.status === 'suspended' || membership?.status === 'removed') {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
};
