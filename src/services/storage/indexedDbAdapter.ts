import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CourseSession, LibrarySnapshot, Module, NoteDocument, Subject } from '@/domain/types';
import { SCHEMA_VERSION, type ChangeSet, type ExportBundle, type StorageAdapter } from './types';

interface LexNoteDB extends DBSchema {
  subjects: { key: string; value: Subject };
  modules: { key: string; value: Module; indexes: { bySubject: string } };
  sessions: { key: string; value: CourseSession; indexes: { byModule: string } };
  /** Contenu des notes, séparé des métadonnées pour garder les listes légères. */
  notes: { key: string; value: NoteDocument };
  meta: { key: string; value: unknown };
}

const DB_NAME = 'lexnote';

/** Migrations incrémentales : une étape par version de schéma. */
function upgrade(db: IDBPDatabase<LexNoteDB>, oldVersion: number) {
  if (oldVersion < 1) {
    db.createObjectStore('subjects', { keyPath: 'id' });
    db.createObjectStore('modules', { keyPath: 'id' }).createIndex('bySubject', 'subjectId');
    db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('byModule', 'moduleId');
    db.createObjectStore('notes', { keyPath: 'sessionId' });
    db.createObjectStore('meta');
  }
  // if (oldVersion < 2) { … futurs stores : blobs (audio/documents), transcripts… }
}

export class IndexedDbAdapter implements StorageAdapter {
  readonly kind = 'indexeddb' as const;
  readonly persistent = true;
  private constructor(private db: IDBPDatabase<LexNoteDB>) {}

  static async open(name = DB_NAME): Promise<IndexedDbAdapter> {
    const db = await openDB<LexNoteDB>(name, SCHEMA_VERSION, { upgrade });
    // Si un autre onglet demande une migration, on libère la connexion.
    db.addEventListener('versionchange', () => db.close());
    return new IndexedDbAdapter(db);
  }

  async loadLibrary(): Promise<LibrarySnapshot> {
    const [subjects, modules, sessions] = await Promise.all([
      this.db.getAll('subjects'),
      this.db.getAll('modules'),
      this.db.getAll('sessions'),
    ]);
    return { subjects, modules, sessions };
  }

  getNotes(sessionId: string) {
    return this.db.get('notes', sessionId);
  }

  async commit(c: ChangeSet): Promise<void> {
    const tx = this.db.transaction(['subjects', 'modules', 'sessions', 'notes'], 'readwrite');
    const ops: Promise<unknown>[] = [];
    c.putSubjects?.forEach((v) => ops.push(tx.objectStore('subjects').put(v)));
    c.putModules?.forEach((v) => ops.push(tx.objectStore('modules').put(v)));
    c.putSessions?.forEach((v) => ops.push(tx.objectStore('sessions').put(v)));
    c.putNotes?.forEach((v) => ops.push(tx.objectStore('notes').put(v)));
    c.deleteSubjects?.forEach((id) => ops.push(tx.objectStore('subjects').delete(id)));
    c.deleteModules?.forEach((id) => ops.push(tx.objectStore('modules').delete(id)));
    c.deleteSessions?.forEach((id) => {
      ops.push(tx.objectStore('sessions').delete(id));
      ops.push(tx.objectStore('notes').delete(id));
    });
    try {
      await Promise.all([...ops, tx.done]);
    } catch (err) {
      tx.abort?.();
      throw err;
    }
  }

  getMeta<T>(key: string) {
    return this.db.get('meta', key) as Promise<T | undefined>;
  }
  async setMeta(key: string, value: unknown) {
    await this.db.put('meta', value, key);
  }

  async exportAll(): Promise<ExportBundle> {
    const [lib, notes] = await Promise.all([this.loadLibrary(), this.db.getAll('notes')]);
    return { app: 'lexnote', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), ...lib, notes };
  }

  async clearAll() {
    const tx = this.db.transaction(['subjects', 'modules', 'sessions', 'notes', 'meta'], 'readwrite');
    await Promise.all([
      ...(['subjects', 'modules', 'sessions', 'notes', 'meta'] as const).map((s) => tx.objectStore(s).clear()),
      tx.done,
    ]);
  }
}
