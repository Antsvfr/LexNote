import type { ChangeSet } from '@/services/storage/types';

/**
 * Synchronisation cloud — NON implémentée en V1 (local-first strict).
 *
 * Chaîne cible :  autosave → stockage local (IndexedDB) → file de sync → cloud.
 * Le stockage local reste la source de vérité ; la sync est facultative et
 * ne sera activée que sur action explicite de l'utilisateur.
 */
export interface SyncEngine {
  readonly enabled: boolean;
  /** Appelé après chaque écriture locale réussie. */
  enqueue(changes: ChangeSet): void;
}

export const noopSync: SyncEngine = {
  enabled: false,
  enqueue() {
    /* aucune donnée ne quitte l'appareil */
  },
};
