import { collection, doc, writeBatch, getDoc, getDocs, updateDoc, setDoc, runTransaction, increment, deleteDoc, query, where } from 'firebase/firestore';
import { sendPasswordResetEmail, createUserWithEmailAndPassword } from 'firebase/auth';
import { db, auth, getSecondaryAuth } from '../firebase/config';
import type { Company, UserProfile, CompanyMember, CompanyMemberWithProfile, CompanyInvite, UserRole, Permission } from './types';
import { logAuditAction } from './audit';
import { getUserProfile } from './firestore';

// 1. Create Company and User (Registration) with Sequential Counter
export const createCompanyAndUser = async (
  uid: string,
  userEmail: string,
  companyData: Omit<Company, 'id' | 'companyCode' | 'ownerUid' | 'createdAt' | 'status' | 'membersCount' | 'registrationSource' | 'lastActivityAt'>,
  preferredLanguage: string = 'pl'
) => {
  const companyId = await runTransaction(db, async (transaction) => {
    // 1. Obsługa sekwencyjnego numeru firmy (GEP-00000X)
    const counterRef = doc(db, 'system', 'counters');
    const counterDoc = await transaction.get(counterRef);
    let nextSeq = 1;
    if (counterDoc.exists() && counterDoc.data().companySequence) {
      nextSeq = counterDoc.data().companySequence + 1;
    }
    
    // Aktualizujemy counter
    transaction.set(counterRef, { companySequence: nextSeq }, { merge: true });
    
    const companyCode = `GEP-${String(nextSeq).padStart(6, '0')}`;
    
    const companyRef = doc(collection(db, 'companies'));
    const generatedCompanyId = companyRef.id;

    // 2. Firma
    const newCompany: Company = {
      id: generatedCompanyId,
      companyCode,
      ...companyData,
      ownerUid: uid,
      status: 'active',
      createdAt: Date.now(),
      membersCount: 1,
      registrationSource: 'web'
    };
    transaction.set(companyRef, newCompany);

    // 3. Globalny profil Usera
    const userRef = doc(db, 'users', uid);
    const newUserProfile: UserProfile = {
      uid,
      email: userEmail,
      displayName: null,
      globalRole: 'user', // owner dla firmy bedzie ustalony w zespole ponizej
      activeCompanyId: generatedCompanyId,
      preferredLanguage,
      authProviders: ['password'],
      createdAt: Date.now()
    };
    transaction.set(userRef, newUserProfile);

    // 4. Rekord członka zespołu
    const memberRef = doc(db, `companies/${generatedCompanyId}/members`, uid);
    const newMember: CompanyMember = {
      uid,
      role: 'company_owner',
      permissions: ['company.view', 'company.manage', 'company.members.view', 'company.members.manage'],
      status: 'active',
      joinedAt: Date.now()
    };
    transaction.set(memberRef, newMember);

    // Audit log (inside transaction requires manual write since we don't await the helper)
    const logsRef = doc(collection(db, `companies/${generatedCompanyId}/audit_logs`));
    transaction.set(logsRef, {
      id: logsRef.id,
      companyId: generatedCompanyId,
      action: 'create_employee',
      performedByUid: uid,
      details: { roleAssigned: 'company_owner', init: true },
      createdAt: Date.now()
    });

    return generatedCompanyId;
  });

  return companyId;
};

// 2. Get Company Profile
export const getCompanyProfile = async (companyId: string): Promise<Company | null> => {
  const docRef = doc(db, 'companies', companyId);
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    return snap.data() as Company;
  }
  return null;
};

// 3. Update Company Profile
export const updateCompanyProfile = async (
  companyId: string, 
  data: Partial<Omit<Company, 'id' | 'companyCode' | 'ownerUid' | 'createdAt'>>,
  performedByUid: string
) => {
  const docRef = doc(db, 'companies', companyId);
  await updateDoc(docRef, data);
  
  await logAuditAction(companyId, 'company_profile_update', performedByUid, { 
    updatedFields: Object.keys(data) 
  });
};

// 4. Get Company Members with Profile 
export const getCompanyMembers = async (companyId: string): Promise<CompanyMemberWithProfile[]> => {
  const membersRef = collection(db, `companies/${companyId}/members`);
  const snap = await getDocs(membersRef);
  
  const rawMembers = snap.docs.map(doc => doc.data() as CompanyMember);
  
  // Zgodnie z decyzją, ładujemy profil usera (zawierający email i displayName) dynamicznie dla kazdego membera
  const enrichedMembers = await Promise.all(
    rawMembers.map(async (member) => {
      const profile = await getUserProfile(member.uid);
      return {
        ...member,
        profile: profile || undefined
      } as CompanyMemberWithProfile;
    })
  );
  
  return enrichedMembers;
};

// 4.1 Get Company Invites
export const getCompanyInvites = async (companyId: string): Promise<CompanyInvite[]> => {
  const invitesRef = collection(db, `companies/${companyId}/invites`);
  const snap = await getDocs(invitesRef);
  return snap.docs.map(doc => doc.data() as CompanyInvite);
};

// 5. Invite User To Company
export const inviteUserToCompany = async (
  companyId: string, 
  inviteData: { email: string, role: UserRole, permissions: Permission[], displayName?: string, language: string },
  performedByUid: string
) => {
  const inviteRef = doc(collection(db, `companies/${companyId}/invites`));
  const inviteId = inviteRef.id;
  
  const newInvite: CompanyInvite = {
    id: inviteId,
    email: inviteData.email,
    displayName: inviteData.displayName || null,
    role: inviteData.role,
    permissions: inviteData.permissions,
    language: inviteData.language,
    status: 'invited',
    companyId,
    invitedByUid: performedByUid,
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 dni
  };

  await setDoc(inviteRef, newInvite);
  
  await logAuditAction(companyId, 'invite_user', performedByUid, { 
    inviteId, 
    invitedEmail: inviteData.email, 
    roleAssigned: inviteData.role 
  });
  
  return inviteId;
};

// 6. Create Employee Account Directly (Manual creation)
export const createEmployeeAccount = async (
  companyId: string,
  employeeData: { uid: string, email: string, displayName: string, role: UserRole, permissions: Permission[], phone?: string },
  performedByUid: string
) => {
  const batch = writeBatch(db);

  const userRef = doc(db, 'users', employeeData.uid);
  const newUserProfile: UserProfile = {
    uid: employeeData.uid,
    email: employeeData.email,
    displayName: employeeData.displayName,
    globalRole: 'user',
    activeCompanyId: companyId,
    phone: employeeData.phone,
    authProviders: ['password'],
    createdAt: Date.now()
  };
  batch.set(userRef, newUserProfile);

  const memberRef = doc(db, `companies/${companyId}/members`, employeeData.uid);
  const newMember: CompanyMember = {
    uid: employeeData.uid,
    role: employeeData.role,
    permissions: employeeData.permissions,
    status: 'active',
    joinedAt: Date.now()
  };
  batch.set(memberRef, newMember);

  // Zwiększenie licznika membersCount
  const compRef = doc(db, 'companies', companyId);
  batch.update(compRef, { membersCount: increment(1) });
  
  await batch.commit();

  await logAuditAction(companyId, 'create_employee', performedByUid, { 
    employeeUid: employeeData.uid, 
    employeeEmail: employeeData.email,
    roleAssigned: employeeData.role
  });
};

// 7. GET ALL COMPANIES (SUPERADMIN ONLY)
export const getAllCompanies = async (): Promise<Company[]> => {
  const companiesRef = collection(db, 'companies');
  const snap = await getDocs(companiesRef);
  const data = snap.docs.map(doc => doc.data() as Company);
  // Sortowanie od najnowszej do najstarszej (po dacie utworzenia)
  return data.sort((a, b) => b.createdAt - a.createdAt);
};

// 8. Update Member Status (Approve, Suspend, Remove)
export const updateCompanyMemberStatus = async (
  companyId: string, 
  uid: string, 
  newStatus: 'invited' | 'pending' | 'active' | 'suspended' | 'removed', 
  performedByUid: string
) => {
  const memberRef = doc(db, `companies/${companyId}/members`, uid);
  const dataToUpdate: Partial<CompanyMember> = { status: newStatus, uid };
  
  if (newStatus === 'active') {
    dataToUpdate.approvedBy = performedByUid;
    dataToUpdate.approvedAt = Date.now();
  }
  
  await updateDoc(memberRef, dataToUpdate);
  
  await logAuditAction(companyId, `member_status_${newStatus}` as any, performedByUid, { 
    targetUid: uid 
  });
};
// 10. Accept Invite and Form Temporary Password
export const acceptCompanyInviteAndCreateAccount = async (
  companyId: string,
  invite: CompanyInvite,
  performedByUid: string
) => {
  const secondaryAuth = getSecondaryAuth();
  
  // Generowanie losowego 8 znakowego hasła tymczasowego
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  let tempPassword = '';
  for (let i = 0; i < 8; i++) {
    tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  let newUid: string | null = null;
  let resultPassword: string | null = null;

  try {
    // Tworzenie konta bez rozłączania głównej sesji admina
    const userCred = await createUserWithEmailAndPassword(secondaryAuth, invite.email, tempPassword);
    newUid = userCred.user.uid;
    resultPassword = tempPassword;
    
    // Czyszczenie sesji secondary
    await secondaryAuth.signOut();
    
    const batch = writeBatch(db);
    
    const userRef = doc(db, 'users', newUid);
    batch.set(userRef, {
      uid: newUid,
      email: invite.email,
      displayName: invite.displayName || null,
      globalRole: 'user',
      activeCompanyId: companyId,
      authProviders: ['password'],
      createdAt: Date.now(),
      requirePasswordChange: true
    } as UserProfile);
    
    const memberRef = doc(db, `companies/${companyId}/members`, newUid);
    batch.set(memberRef, {
      uid: newUid,
      role: invite.role,
      permissions: invite.permissions,
      status: 'active',
      joinedAt: Date.now(),
      invitedByUid: invite.invitedByUid,
      approvedBy: performedByUid,
      approvedAt: Date.now()
    } as CompanyMember);
    
    const compRef = doc(db, 'companies', companyId);
    batch.update(compRef, { membersCount: increment(1) });
    
    const inviteRef = doc(db, `companies/${companyId}/invites`, invite.id);
    batch.delete(inviteRef);
    
    await batch.commit();
  } catch (err: any) {
    if (err.code === 'auth/email-already-in-use') {
      // Czyszczenie sesji secondary, jeśli błąd wystąpił po jej utworzeniu
      await secondaryAuth.signOut();

      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('email', '==', invite.email));
      const snap = await getDocs(q);
      
      if (snap.empty) {
        throw new Error("Konto istnieje na Firebase, ale nie ma profilu użytkownika. Skontaktuj się z administracją.");
      }
      
      const existingUid = snap.docs[0].id;
      newUid = existingUid; // Set newUid to existingUid for audit log
      resultPassword = null; // No password generated for existing user
      
      const batch = writeBatch(db);
      const memberRef = doc(db, `companies/${companyId}/members`, existingUid);
      batch.set(memberRef, {
        uid: existingUid,
        role: invite.role,
        permissions: invite.permissions,
        status: 'active',
        joinedAt: Date.now(),
        invitedByUid: invite.invitedByUid,
        approvedBy: performedByUid,
        approvedAt: Date.now()
      } as CompanyMember);
      
      const compRef = doc(db, 'companies', companyId);
      batch.update(compRef, { membersCount: increment(1) });
      
      const inviteRef = doc(db, `companies/${companyId}/invites`, invite.id);
      batch.delete(inviteRef);
      
      await batch.commit();
    } else {
      throw err;
    }
  }
  
  if (newUid) {
    await logAuditAction(companyId, 'accept_invite_create_user', performedByUid, { 
      newUid, inviteId: invite.id 
    });
  }
  
  return resultPassword;
};

export const deleteCompanyInvite = async (companyId: string, inviteId: string, performedByUid: string) => {
  const inviteRef = doc(db, `companies/${companyId}/invites`, inviteId);
  await deleteDoc(inviteRef);
  await logAuditAction(companyId, 'delete_invite', performedByUid, { inviteId });
};

// 12. Migrations / Sync
export const syncAllMembershipsUIDs = async () => {
  const companiesSnap = await getDocs(collection(db, 'companies'));
  let count = 0;
  
  for (const compDoc of companiesSnap.docs) {
    const membersSnap = await getDocs(collection(db, `companies/${compDoc.id}/members`));
    const batch = writeBatch(db);
    let batchHasDocs = false;
    
    for (const memDoc of membersSnap.docs) {
      if (!memDoc.data().uid) {
        batch.update(memDoc.ref, { uid: memDoc.id });
        batchHasDocs = true;
        count++;
      }
    }
    
    if (batchHasDocs) {
      await batch.commit();
    }
  }
  
  return count;
};
// 9. Send Password Reset Email 
export const sendMemberPasswordReset = async (email: string) => {
  await sendPasswordResetEmail(auth, email);
};
