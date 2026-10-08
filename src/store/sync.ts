import { create } from 'zustand';

export type SyncState = 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'disabled';

export interface SyncStatus {
  state: SyncState;
  /** Lignes locales pas encore envoyées au cloud. */
  pending: number;
  lastSyncAt: string | null;
  error: string | null;
  /** Conflits résolus en conservant les DEUX versions (depuis l'ouverture). */
  conflicts: number;
}

export const initialSync: SyncStatus = { state: 'idle', pending: 0, lastSyncAt: null, error: null, conflicts: 0 };
export const useSync = create<SyncStatus>(() => ({ ...initialSync }));
export const setSync = (p: Partial<SyncStatus>) => useSync.setState(p);
