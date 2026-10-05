import type { CourseSession, LibrarySnapshot, Module, NoteDocument, Subject } from '@/domain/types';

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

export interface ExportBundle {
  app: 'lexnote';
  schemaVersion: number;
  exportedAt: string;
  subjects: Subject[];
  modules: Module[];
  sessions: CourseSession[];
  notes: NoteDocument[];
}

/**
 * Contrat de stockage. L'application ne parle QU'À cette interface :
 * on pourra remplacer ou compléter IndexedDB par une base cloud sans
 * toucher à l'UI ni aux stores.
 */
export interface StorageAdapter {
  readonly kind: 'indexeddb' | 'memory';
  /** Les données survivent-elles à un redémarrage du navigateur ? */
  readonly persistent: boolean;
  loadLibrary(): Promise<LibrarySnapshot>;
  getNotes(sessionId: string): Promise<NoteDocument | undefined>;
  commit(changes: ChangeSet): Promise<void>;
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  exportAll(): Promise<ExportBundle>;
  clearAll(): Promise<void>;
}

export const SCHEMA_VERSION = 1;
