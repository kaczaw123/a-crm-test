import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth';

export const RedirectLogic: React.FC = () => {
  const { profile, membership, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading) {
      if (!profile) {
        navigate('/login');
        return;
      }

      // 0. Sprawdzenie flagi wymuszonej zmiany hasła (Worker z kontem wygenerowanym przez Ownera)
      if (profile.requirePasswordChange === true) {
        navigate('/force-password-change');
        return;
      }

      // 1. Zablokowany lub archiwizowany członek wewnątrz aktualnej firmy
      if (membership && (membership.status === 'suspended' || membership.status === 'removed')) {
        navigate('/unauthorized');
        return;
      }
      
      const prof = profile as any;
      
      // 2. Obsługa Globalnego Superadmina i Administratorów Platformowych
      if (prof.globalRole === 'superadmin' || prof.globalRole === 'admin' || prof.platformRole === 'SUPER_ADMIN' || prof.role === 'SUPER_ADMIN') {
        navigate('/admin');
        return;
      }

      // Pracownik Wewnętrzny - Magazyn Platformowy
      if (prof.platformRole === 'WAREHOUSE' || prof.role === 'WAREHOUSE') {
        navigate('/admin/fulfillment/pack');
        return;
      }

      // Pozostałe operacyjne role platformowe
      if (['ADMIN_OPERACYJNY', 'SALES', 'BILLING', 'CUSTOMER_CARE', 'INTEGRATION'].includes(prof.platformRole || prof.role)) {
        navigate('/admin');
        return;
      }

      // 3. Fallback: Jezeli usuniemy profilom 'globalRole' pozostaje rola z konkretnej firmy (membership)
      if (membership) {
        switch (membership.role) {
          case 'admin': // 'admin' tez moze byc rola firmowa (w starym systemie)
          case 'company_owner':
          case 'company_admin':
          case 'viewer':
            navigate('/app');
            break;
          case 'worker':
            navigate('/worker');
            break;
          default:
            navigate('/unauthorized');
        }
      } else {
        // Jesli jest tylko user, a nie ma przypisanej firmy ani superadmina:
        navigate('/unauthorized');
      }
    }
  }, [profile, membership, loading, navigate]);

  return <div className="flex h-screen items-center justify-center">Ladowanie modułu kontroli...</div>;
};

export default RedirectLogic;
