import type { CourseSession, LibrarySnapshot, Module, NoteDocument, Subject } from '@/domain/types';

/** Tables synchronisées « versionnées » (avec détection de conflit). */
export type SyncTable = 'subjects' | 'modules' | 'course_sessions';

/** Écriture atomique : tout ou rien. Supprimer une séance supprime aussi ses notes. */
export interface ChangeSet {
  putSubjects?: Subject[];
  putModules?: Module[];
  putSessions?: CourseSession[];
  putNotes?: NoteDocument[];
  deleteSubjects?: string[];
  deleteModules?: string[];
  deleteSessions?: string[];
}

export interface CommitOptions {
  /**
   * `true` = changement qui VIENT du cloud : les lignes ne sont pas marquées « à envoyer » et aucune
   * pierre tombale n'est créée (sinon on renverrait au serveur ce qu'il vient de nous donner).
   */
  remote?: boolean;
}

/** Trace d'une suppression locale d'une ligne déjà synchronisée : permet de propager la suppression plus tard. */
export interface Tombstone {
  key: string; // `${table}:${id}`
  table: SyncTable;
  id: string;
  version: number;
  deletedAt: string;
}

export interface DirtySet {
  subjects: Subject[];
  modules: Module[];
  sessions: CourseSession[];
  tombstones: Tombstone[];
}

export interface ExportBundle {
  app: 'lexnote';
  schemaVersion: number;
  exportedAt: string;
  userId?: string;
  subjects: Subject[];
  modules: Module[];
  sessions: CourseSession[];
  notes: NoteDocument[];
}

/**
 * Contrat de stockage LOCAL (source d'écriture de l'application — la frappe ne dépend jamais du réseau).
 * Une instance = les données d'UN utilisateur (une base IndexedDB par `userId`).
 */
export interface StorageAdapter {
  readonly kind: 'indexeddb' | 'memory';
  /** Les données survivent-elles à un redémarrage du navigateur ? */
  readonly persistent: boolean;
  loadLibrary(): Promise<LibrarySnapshot>;
  getNotes(sessionId: string): Promise<NoteDocument | undefined>;
  commit(changes: ChangeSet, opts?: CommitOptions): Promise<void>;
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;

  /* --- synchronisation --- */
  listDirty(): Promise<DirtySet>;
  /** Enregistre la version serveur ; n'efface `dirty` que si la ligne n'a pas bougé depuis l'envoi. */
  markSynced(table: SyncTable, id: string, version: number, pushedUpdatedAt?: string): Promise<void>;
  dropTombstone(key: string): Promise<void>;

  exportAll(): Promise<ExportBundle>;
  clearAll(): Promise<void>;
  close(): void;
}

export const SCHEMA_VERSION = 1;
