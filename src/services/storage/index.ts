import { IndexedDbAdapter, userDbName } from './indexedDbAdapter';
import { MemoryAdapter } from './memoryAdapter';
import type { ChangeSet, CommitOptions, StorageAdapter } from './types';

export type { StorageAdapter, ChangeSet } from './types';

/** Ouvre la base IndexedDB de CET utilisateur ; si indisponible (navigation privée stricte…), repli mémoire signalé à l'UI. */
export async function createStorage(userId: string): Promise<StorageAdapter> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB indisponible');
    return await IndexedDbAdapter.open(userDbName(userId));
  } catch (err) {
    console.warn('[LexNote] IndexedDB indisponible, repli en mémoire (non persistant).', err);
    return new MemoryAdapter(false);
  }
}

/** Écoute des écritures LOCALES (pour planifier une synchronisation en arrière-plan). */
export interface WriteListener { onLocalWrite(changes: ChangeSet): void }

/**
 * Décorateur : après chaque écriture locale réussie, prévient le moteur de synchronisation.
 * La frappe ne dépend jamais du réseau : l'écriture locale est terminée AVANT la notification.
 */
export function withSync(adapter: StorageAdapter, listener: WriteListener): StorageAdapter {
  return {
    get kind() { return adapter.kind; },
    get persistent() { return adapter.persistent; },
    loadLibrary: () => adapter.loadLibrary(),
    getNotes: (id) => adapter.getNotes(id),
    loadArtifacts: () => adapter.loadArtifacts(),
    getMeta: (k) => adapter.getMeta(k),
    setMeta: (k, v) => adapter.setMeta(k, v),
    listDirty: () => adapter.listDirty(),
    markSynced: (t, id, v, u) => adapter.markSynced(t, id, v, u),
    dropTombstone: (k) => adapter.dropTombstone(k),
    exportAll: () => adapter.exportAll(),
    clearAll: () => adapter.clearAll(),
    close: () => adapter.close(),
    async commit(changes: ChangeSet, opts?: CommitOptions) {
      await adapter.commit(changes, opts);
      if (!opts?.remote) listener.onLocalWrite(changes);
    },
  };
}

/** Demande au navigateur de ne pas évincer les notes sous pression de stockage. */
export async function requestPersistence(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
