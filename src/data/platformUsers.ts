import { collection, doc, getDocs, query, orderBy, updateDoc } from 'firebase/firestore';
import { db, functions } from '../firebase/config';
import { httpsCallable } from 'firebase/functions';

export type PlatformRole = "SUPER_ADMIN" | "ADMIN_OPERACYJNY" | "SALES" | "BILLING" | "WAREHOUSE" | "CUSTOMER_CARE" | "INTEGRATION";
export type PlatformDepartment = "sales" | "billing" | "warehouse" | "operations" | "admin" | "integration";
export type AccessLevel = "none" | "read" | "write";

export interface Permissions {
  modules: {
    dashboard: AccessLevel;
    crm: AccessLevel;
    clients: AccessLevel;
    billing: AccessLevel;
    carriers: AccessLevel;
    warehouse: AccessLevel;
    reports: AccessLevel;
    users: AccessLevel;
    settings: AccessLevel;
  };
  financeAccess: {
    canSeeCosts: boolean;
    canSeeMargins: boolean;
    canEditPricing: boolean;
  };
}

export interface ClientScope {
  type: "all" | "assigned" | "selected";
  clientIds: string[];
}

export interface PlatformUser {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  accountType: "internal";
  role: PlatformRole;
  department: PlatformDepartment;
  permissions: Permissions;
  clientScope: ClientScope;
  status: "active" | "invited" | "blocked";
  createdAt: number; // timestamp
  createdBy: string;
  lastLoginAt?: number; // timestamp
  assignedPackingStationId?: string;
}

// DEFAULT ROLES (Presets)
export const ROLE_PRESETS: Record<PlatformRole, { department: PlatformDepartment, permissions: Permissions }> = {
  SUPER_ADMIN: {
    department: 'admin',
    permissions: {
      modules: { dashboard: 'write', crm: 'write', clients: 'write', billing: 'write', carriers: 'write', warehouse: 'write', reports: 'write', users: 'write', settings: 'write' },
      financeAccess: { canSeeCosts: true, canSeeMargins: true, canEditPricing: true }
    }
  },
  ADMIN_OPERACYJNY: {
    department: 'operations',
    permissions: {
      modules: { dashboard: 'write', crm: 'write', clients: 'write', billing: 'read', carriers: 'write', warehouse: 'write', reports: 'write', users: 'read', settings: 'read' },
      financeAccess: { canSeeCosts: false, canSeeMargins: false, canEditPricing: false }
    }
  },
  SALES: {
    department: 'sales',
    permissions: {
      modules: { dashboard: 'read', crm: 'write', clients: 'write', billing: 'none', carriers: 'none', warehouse: 'none', reports: 'read', users: 'none', settings: 'none' },
      financeAccess: { canSeeCosts: false, canSeeMargins: false, canEditPricing: false }
    }
  },
  BILLING: {
    department: 'billing',
    permissions: {
      modules: { dashboard: 'read', crm: 'none', clients: 'read', billing: 'write', carriers: 'read', warehouse: 'none', reports: 'read', users: 'none', settings: 'none' },
      financeAccess: { canSeeCosts: true, canSeeMargins: true, canEditPricing: true }
    }
  },
  WAREHOUSE: {
    department: 'warehouse',
    permissions: {
      modules: { dashboard: 'none', crm: 'none', clients: 'none', billing: 'none', carriers: 'write', warehouse: 'write', reports: 'none', users: 'none', settings: 'none' },
      financeAccess: { canSeeCosts: false, canSeeMargins: false, canEditPricing: false }
    }
  },
  CUSTOMER_CARE: {
    department: 'operations',
    permissions: {
      modules: { dashboard: 'read', crm: 'write', clients: 'read', billing: 'read', carriers: 'read', warehouse: 'read', reports: 'none', users: 'none', settings: 'none' },
      financeAccess: { canSeeCosts: false, canSeeMargins: false, canEditPricing: false }
    }
  },
  INTEGRATION: {
    department: 'integration',
    permissions: {
      modules: { dashboard: 'none', crm: 'none', clients: 'none', billing: 'none', carriers: 'read', warehouse: 'none', reports: 'read', users: 'none', settings: 'write' },
      financeAccess: { canSeeCosts: false, canSeeMargins: false, canEditPricing: false }
    }
  }
};

export const createInternalUserCallable = httpsCallable(functions, 'createInternalUser');

export const getPlatformUsers = async (): Promise<PlatformUser[]> => {
  const usersRef = collection(db, 'platformUsers');
  const q = query(usersRef, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(doc => doc.data() as PlatformUser);
};

export const updatePlatformUserStatus = async (uid: string, status: "active" | "invited" | "blocked"): Promise<void> => {
  const docRef = doc(db, 'platformUsers', uid);
  await updateDoc(docRef, { status });
};
