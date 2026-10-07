import { create } from 'zustand';

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

interface SyncState {
  phase: SyncPhase;
  pending: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  conflicts: number;
}

export const useSyncStatus = create<SyncState>(() => ({
  phase: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'idle',
  pending: 0,
  lastSyncedAt: null,
  lastError: null,
  conflicts: 0,
}));

export const setSyncStatus = (patch: Partial<SyncState>) => useSyncStatus.setState(patch);