import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import type { UserRole } from '../data/types';

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
}

export const RoleGuard: React.FC<RoleGuardProps> = ({ children, allowedRoles }) => {
  const { profile, membership, loading } = useAuth();

  if (loading) {
    return <div className="flex h-screen items-center justify-center">Ladowanie dostępu...</div>;
  }

  if (!profile) {
    return <Navigate to="/unauthorized" replace />;
  }

  // Superadmin i wewnętrzni pracownicy platformy logistycznej (admin) mają zawsze dostęp
  if (profile.globalRole === 'superadmin' || profile.globalRole === 'admin') {
    return <>{children}</>;
  }

  // Dla reszty sprawdzamy role z Memberships (CompanyMember.role)
  if (!membership || !allowedRoles.includes(membership.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
};
