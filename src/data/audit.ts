import { collection, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { AuditLog, AuditAction } from './types';

export const logAuditAction = async (
  companyId: string,
  action: AuditAction,
  performedByUid: string,
  details: Record<string, any> = {}
) => {
  try {
    const logsRef = doc(collection(db, `companies/${companyId}/audit_logs`));
    
    const newLog: AuditLog = {
      id: logsRef.id,
      companyId,
      action,
      performedByUid,
      details,
      createdAt: Date.now()
    };

    await setDoc(logsRef, newLog);
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
};

export const logGlobalAuditAction = async (
  action: AuditAction,
  performedByUid: string,
  targetUid: string,
  details: Record<string, any> = {}
) => {
  try {
    const logsRef = doc(collection(db, `audit_logs`));
    
    const newLog: AuditLog = {
      id: logsRef.id,
      action,
      performedByUid,
      targetUid,
      details,
      createdAt: Date.now()
    };

    await setDoc(logsRef, newLog);
  } catch (error) {
    console.error('Failed to write global audit log:', error);
  }
};
