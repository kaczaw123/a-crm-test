import { Timestamp } from 'firebase/firestore';

export interface Integration {
  id?: string;
  orgId: string;
  type: 'baselinker' | 'google_sheets' | 'dhl_de' | 'gls_de' | 'allegro' | 'apilo' | 'shoper' | 'fulfillment_gepard';
  customName: string;
  status: 'active' | 'inactive' | 'error';
  isDefault: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  lastTestAt?: Timestamp;
  lastSuccessAt?: Timestamp;
  syncStatus: 'idle' | 'syncing' | 'error';
  // Secret token metadata (the actual decrypted token is NEVER stored here!)
  keyVersion?: number; 
  // Puste dla baselinker, potrzebne dla google_sheets
  spreadsheetId?: string;
  sheetName?: string;
  // Pola DHL DE
  sandboxMode?: boolean;
  // Ustawienia automatycznej synchronizacji
  autoSync?: boolean;
  syncInterval?: number; // w minutach
  // Pola Fulfillment Gepard
  importStatusId?: string;
  exportStatusId?: string;
}

export interface SyncJob {
  id?: string;
  orgId: string;
  integrationId: string;
  status: 'queued' | 'running' | 'partial' | 'completed' | 'failed';
  processedCount: number;
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  lastCursor?: string;
  startedAt: Timestamp;
  finishedAt?: Timestamp;
  lastErrorMessageSafe?: string;
}

import { functions } from '../firebase/config';
import { httpsCallable } from 'firebase/functions';

export const saveIntegrationCallable = httpsCallable(functions, 'saveIntegration');
export const testIntegrationCallable = httpsCallable(functions, 'testIntegration');
export const triggerProductSyncCallable = httpsCallable(functions, 'triggerProductSync');
export const manualSyncBaselinkerOrdersCallable = httpsCallable(functions, 'manualSyncBaselinkerOrders');
export const deleteIntegrationCallable = httpsCallable(functions, 'deleteIntegration');
export const getIntegrationInventoriesCallable = httpsCallable(functions, 'getIntegrationInventories');

// Google Sheets specific
export const saveGoogleSheetsIntegrationCallable = httpsCallable(functions, 'saveGoogleSheetsIntegration');
export const testGoogleSheetsIntegrationCallable = httpsCallable(functions, 'testGoogleSheetsIntegration');
export const triggerGoogleSheetsSyncCallable = httpsCallable(functions, 'triggerGoogleSheetsSync');

// DHL DE
export const saveDhlIntegrationCallable = httpsCallable(functions, 'saveDhlIntegration');
export const testDhlIntegrationCallable = httpsCallable(functions, 'testDhlIntegration');

// GLS DE
export const saveGlsIntegrationCallable = httpsCallable(functions, 'saveGlsIntegration');
export const testGlsIntegrationCallable = httpsCallable(functions, 'testGlsIntegration');

// Apilo
export const saveApiloIntegrationCallable = httpsCallable(functions, 'saveApiloIntegration');
export const testApiloIntegrationCallable = httpsCallable(functions, 'testApiloIntegration');

export const syncApiloOrdersCallable = httpsCallable(functions, 'syncApiloOrders');

// Shoper
export const saveShoperIntegrationCallable = httpsCallable(functions, 'saveShoperIntegration');
export const testShoperIntegrationCallable = httpsCallable(functions, 'testShoperIntegration');
export const syncShoperOrdersCallable = httpsCallable(functions, 'syncShoperOrders');
export const syncShoperProductsCallable = httpsCallable(functions, 'syncShoperProducts');
