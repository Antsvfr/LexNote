import { IndexedDbAdapter } from './indexedDbAdapter';
import { MemoryAdapter } from './memoryAdapter';
import type { ChangeSet, StorageAdapter } from './types';
import { noopSync, type SyncEngine } from '@/services/sync';

export type { StorageAdapter, ChangeSet } from './types';

export async function createStorage(userId?: string): Promise<StorageAdapter> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB indisponible');
    return await IndexedDbAdapter.open(userId ? 'lexnote-' + userId : 'lexnote');
  } catch (err) {
    console.warn('[LexNote] IndexedDB indisponible, repli en mémoire (non persistant).', err);
    return new MemoryAdapter(false);
  }
}

export function withSync(adapter: StorageAdapter, sync: SyncEngine = noopSync): StorageAdapter {
  return {
    get kind() { return adapter.kind; },
    get persistent() { return adapter.persistent; },
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

export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
