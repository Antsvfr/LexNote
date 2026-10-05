import { IndexedDbAdapter } from './indexedDbAdapter';
import { MemoryAdapter } from './memoryAdapter';
import type { ChangeSet, StorageAdapter } from './types';
import { noopSync, type SyncEngine } from '@/services/sync';

export type { StorageAdapter, ChangeSet } from './types';

/** Ouvre IndexedDB ; si indisponible (navigation privée stricte, etc.), repli mémoire signalé à l'UI. */
export async function createStorage(): Promise<StorageAdapter> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB indisponible');
    return await IndexedDbAdapter.open();
  } catch (err) {
    console.warn('[LexNote] IndexedDB indisponible, repli en mémoire (non persistant).', err);
    return new MemoryAdapter(false);
  }
}

/** Décorateur : après chaque commit local réussi, notifie le moteur de synchronisation (inactif en V1). */
export function withSync(adapter: StorageAdapter, sync: SyncEngine = noopSync): StorageAdapter {
  return {
    get kind() {
      return adapter.kind;
    },
    get persistent() {
      return adapter.persistent;
    },
    loadLibrary: () => adapter.loadLibrary(),
    getNotes: (id) => adapter.getNotes(id),
    getMeta: (k) => adapter.getMeta(k),
    setMeta: (k, v) => adapter.setMeta(k, v),
    exportAll: () => adapter.exportAll(),
    clearAll: () => adapter.clearAll(),
    async commit(changes: ChangeSet) {
      await adapter.commit(changes);
      sync.enqueue(changes);
    },
  };
}

/** Demande au navigateur de ne pas évincer les notes sous pression de stockage. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
