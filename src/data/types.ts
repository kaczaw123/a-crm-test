export type UserRole = 'superadmin' | 'admin' | 'company_owner' | 'company_admin' | 'worker' | 'viewer';
export type AccountStatus = 'invited' | 'pending' | 'active' | 'suspended' | 'removed';

// Uprawnienia wewnetrzne obslugiwane przez guards.
export type Permission = 
  | 'company.view'
  | 'company.manage'
  | 'company.members.view'
  | 'company.members.manage';

// Zmieniono: User -> UserProfile. Czyste dane globalne uzytkownika.
export interface UserProfile {
  uid: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName: string | null;
  phone?: string;
  avatarUrl?: string; // added back from previous requirement as per new spec
  preferredLanguage?: string;
  globalRole: 'superadmin' | 'admin' | 'user'; // admin: ograniczony pracownik platformy, superadmin: właściciel chmury, user: klient
  platformRole?: string; // Nominalna rola pracownika platformy (np. SALES, ADMIN_OPERACYJNY)
  activeCompanyId?: string; // Pomaga zalogowac do konkretnej instancji logistycznej
  authProviders: string[]; // e.g. ['password', 'google.com']
  accountStatus?: 'active' | 'disabled' | 'deleted'; // Globalny status konta - ułatwia uśpienie całego usera
  requirePasswordChange?: boolean; // Wymusza zmianę hasła na /force-password-change przy pierwszym logowaniu
  createdAt: number;
  updatedAt?: number;
  lastLoginAt?: number;
  rewardBalance?: number;
  shipmentsCreated?: number;
  completedTours?: string[];
}

export interface Address {
  street: string;
  city: string;
  postalCode: string;
  country: string;
}

export type CompanyStatus = 'active' | 'blocked' | 'archived';

export interface Company {
  id: string;
  companyCode: string; // np. GEP-000001
  name: string;
  taxId: string;
  address: Address;
  phone: string;
  email: string;
  ownerUid: string;
  status: CompanyStatus;
  createdAt: number;
  lastActivityAt?: number;
  membersCount?: number;
  registrationSource?: string;
  settings?: CompanySettings;
}

export interface CompanySettings {
  inventoryDeductionMode?: 'on_label' | 'on_pack';
}

// Zmieniono: Czysty obiekt członkostwa - bez duplikacji danych osobowych. (Wyjątek to opcjonalny email dla widokow admina zaproszen przed wejsciem, ale odchodzimy od tego).
export interface CompanyMember {
  uid: string;
  role: UserRole;
  permissions: Permission[];
  status: AccountStatus;
  joinedAt: number;
  invitedByUid?: string;
  approvedBy?: string; // Kto zaakceptował z pending
  approvedAt?: number;
}

// Interfejs pomocniczy do łączenia Membera z Profilem (używany np. w widoku Zespołu)
export interface CompanyMemberWithProfile extends CompanyMember {
  profile?: UserProfile;
}

export interface CompanyInvite {
  id: string;
  email: string;
  displayName?: string | null;
  role: UserRole;
  permissions: Permission[];
  language: string;
  status: 'invited' | 'accepted' | 'expired';
  companyId: string;
  invitedByUid: string;
  createdAt: number;
  expiresAt: number;
}

export type AuditAction = 'create_employee' | 'company_profile_update' | 'invite_user' | string;

export interface AuditLog {
  id: string;
  companyId?: string; // Opcjonalne: Gdy logujemy zdarzenia na szczeblu globalnym np. konta usera
  action: AuditAction;
  performedByUid: string;
  targetUid?: string; // Przydatne gdy zwalniamy usera
  details: Record<string, any>;
  createdAt: number;
}
