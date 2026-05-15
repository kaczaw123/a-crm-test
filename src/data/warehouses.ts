import { collection, doc, getDoc, getDocs, query, orderBy, where } from 'firebase/firestore';
import { db, functions } from '../firebase/config';
import { httpsCallable } from 'firebase/functions';

export type WarehouseType = 'fulfillment' | 'returns' | 'crossdock' | 'other';

export interface WarehouseAddress {
  street: string;
  buildingNumber: string;
  unitNumber?: string;
  postalCode: string;
  city: string;
  region?: string;
  country: string;
}

export interface WarehouseContact {
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
}

export interface GlobalWarehouse {
  id: string;
  name: string;
  code: string;
  warehouseType: WarehouseType;
  companyName: string;
  address: WarehouseAddress;
  contact: WarehouseContact;
  openingHours: string;
  deliveryInstructions: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  updatedBy: string;
}

export interface CompanyWarehouseAccess {
  warehouseId: string;
  companyId: string;
  isActive: boolean;
  isDefaultForCompany: boolean;
  assignedAt: number;
  assignedBy: string;
}

/** 
 * Frontend Wrappers na Callable 
 */
export const addWarehouseCallable = httpsCallable<any, { id: string }>(functions, 'addWarehouse');
export const updateWarehouseCallable = httpsCallable<any, any>(functions, 'updateWarehouse');
export const toggleWarehouseStatusCallable = httpsCallable<any, any>(functions, 'toggleWarehouseStatus');
export const assignWarehouseToCompanyCallable = httpsCallable<any, any>(functions, 'assignWarehouseToCompany');
export const revokeWarehouseAccessCallable = httpsCallable<any, any>(functions, 'revokeWarehouseAccess');

export async function getGlobalWarehouses(): Promise<GlobalWarehouse[]> {
  const q = query(collection(db, 'warehouses'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as GlobalWarehouse));
}

export async function getCompanyWarehouseAccess(companyId: string): Promise<CompanyWarehouseAccess[]> {
  const q = query(collection(db, `companies/${companyId}/warehouseAccess`));
  const snap = await getDocs(q);
  return snap.docs.map(doc => ({ warehouseId: doc.id, ...doc.data() } as CompanyWarehouseAccess));
}
