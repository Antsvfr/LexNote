import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { StudyArtifact } from '@/domain/study';
import type { CourseSession, LibrarySnapshot, Module, NoteDocument, Subject } from '@/domain/types';
import {
  SCHEMA_VERSION, type ChangeSet, type CommitOptions, type DirtySet, type ExportBundle, type StorageAdapter, type SyncTable, type Tombstone,
} from './types';

interface LexNoteDB extends DBSchema {
  subjects: { key: string; value: Subject };
  modules: { key: string; value: Module; indexes: { bySubject: string } };
  sessions: { key: string; value: CourseSession; indexes: { byModule: string; bySubject: string } };
  /** Contenu des notes, séparé des métadonnées pour garder les listes légères. */
  artifacts: { key: string; value: StudyArtifact };
  notes: { key: string; value: NoteDocument };
  meta: { key: string; value: unknown };
  tombstones: { key: string; value: Tombstone };
}

/** Une base par utilisateur : `lexnote-u-<userId>`. Aucune donnée n'est partagée entre comptes d'un même navigateur. */
export const userDbName = (userId: string) => `lexnote-u-${userId}`;

type Store = 'subjects' | 'modules' | 'sessions' | 'artifacts';
const STORE_FOR: Record<SyncTable, Store> = { subjects: 'subjects', modules: 'modules', course_sessions: 'sessions', study_artifacts: 'artifacts' };

/** Migrations incrémentales : une étape par version de schéma. */
function upgrade(db: IDBPDatabase<LexNoteDB>, oldVersion: number) {
  if (oldVersion < 1) {
    db.createObjectStore('subjects', { keyPath: 'id' });
    db.createObjectStore('modules', { keyPath: 'id' }).createIndex('bySubject', 'subjectId');
    const s = db.createObjectStore('sessions', { keyPath: 'id' });
    s.createIndex('byModule', 'moduleId');
    s.createIndex('bySubject', 'subjectId');
    db.createObjectStore('notes', { keyPath: 'sessionId' });
    db.createObjectStore('meta');
    db.createObjectStore('tombstones', { keyPath: 'key' });
  }
  if (oldVersion < 2) {
    db.createObjectStore('artifacts', { keyPath: 'id' });
  }
}

export class IndexedDbAdapter implements StorageAdapter {
  readonly kind = 'indexeddb' as const;
  readonly persistent = true;
  private constructor(private db: IDBPDatabase<LexNoteDB>) {}

  static async open(name: string): Promise<IndexedDbAdapter> {
    const db = await openDB<LexNoteDB>(name, SCHEMA_VERSION, { upgrade });
    // Si un autre onglet demande une migration, on libère la connexion.
    db.addEventListener('versionchange', () => db.close());
    return new IndexedDbAdapter(db);
  }

  async loadLibrary(): Promise<LibrarySnapshot> {
    const [subjects, modules, sessions] = await Promise.all([this.db.getAll('subjects'), this.db.getAll('modules'), this.db.getAll('sessions')]);
    return { subjects, modules, sessions };
  }
  loadArtifacts() { return this.db.getAll('artifacts'); }
  getNotes(sessionId: string) { return this.db.get('notes', sessionId); }

  async commit(c: ChangeSet, opts: CommitOptions = {}): Promise<void> {
    const tx = this.db.transaction(['subjects', 'modules', 'sessions', 'artifacts', 'notes', 'tombstones'], 'readwrite');
    const mark = <T extends { dirty?: boolean }>(v: T): T => (opts.remote ? v : { ...v, dirty: true });
    const ops: Promise<unknown>[] = [];

    // Garde atomique (dans la même transaction) : une écriture venant du cloud ne remplace JAMAIS une ligne
    // modifiée localement et pas encore envoyée.
    const isDirty = async (store: Store, id: string) =>
      !!opts.remote && !!((await tx.objectStore(store).get(id)) as { dirty?: boolean } | undefined)?.dirty;

    const put = async (store: Store, table: SyncTable, v: { id: string; dirty?: boolean }) => {
      if (await isDirty(store, v.id)) return false;
      await (tx.objectStore(store) as unknown as { put(x: unknown): Promise<unknown> }).put(mark(v));
      await tx.objectStore('tombstones').delete(`${table}:${v.id}`);
      return true;
    };
    const del = async (table: SyncTable, id: string) => {
      const store = STORE_FOR[table];
      if (await isDirty(store, id)) return false;
      const prev = (await tx.objectStore(store).get(id)) as { version?: number } | undefined;
      const key = `${table}:${id}`;
      if (!opts.remote && prev?.version !== undefined) {
        await tx.objectStore('tombstones').put({ key, table, id, version: prev.version, deletedAt: new Date().toISOString() });
      } else if (opts.remote) {
        await tx.objectStore('tombstones').delete(key);
      }
      await tx.objectStore(store).delete(id);
      return true;
    };

    c.putSubjects?.forEach((v) => ops.push(put('subjects', 'subjects', v)));
    c.putModules?.forEach((v) => ops.push(put('modules', 'modules', v)));
    c.putArtifacts?.forEach((v) => ops.push(put('artifacts', 'study_artifacts', v)));
    const sessionWritten = new Map<string, Promise<boolean>>();
    c.putSessions?.forEach((v) => { const p = put('sessions', 'course_sessions', v); sessionWritten.set(v.id, p); ops.push(p); });
    c.putNotes?.forEach((v) => ops.push((async () => {
      // notes d'une séance ignorée par la garde : on ne les écrit pas non plus
      if (sessionWritten.has(v.sessionId) && !(await sessionWritten.get(v.sessionId))) return;
      await tx.objectStore('notes').put(v);
    })()));
    c.deleteSubjects?.forEach((id) => ops.push(del('subjects', id)));
    c.deleteModules?.forEach((id) => ops.push(del('modules', id)));
    c.deleteArtifacts?.forEach((id) => ops.push(del('study_artifacts', id)));
    c.deleteSessions?.forEach((id) => ops.push((async () => { if (await del('course_sessions', id)) await tx.objectStore('notes').delete(id); })()));
    try {
      await Promise.all([...ops, tx.done]);
    } catch (err) {
      try { tx.abort(); } catch { /* déjà terminée */ }
      throw err;
    }
  }

  getMeta<T>(key: string) { return this.db.get('meta', key) as Promise<T | undefined>; }
  async setMeta(key: string, value: unknown) { await this.db.put('meta', value, key); }

  async listDirty(): Promise<DirtySet> {
    const [subjects, modules, sessions, artifacts, tombstones] = await Promise.all([
      this.db.getAll('subjects'), this.db.getAll('modules'), this.db.getAll('sessions'), this.db.getAll('artifacts'), this.db.getAll('tombstones'),
    ]);
    return { subjects: subjects.filter((x) => x.dirty), modules: modules.filter((x) => x.dirty), sessions: sessions.filter((x) => x.dirty), artifacts: artifacts.filter((x) => x.dirty), tombstones };
  }

  async markSynced(table: SyncTable, id: string, version: number, pushedUpdatedAt?: string) {
    const name = STORE_FOR[table];
    const tx = this.db.transaction(name, 'readwrite');
    const row = (await tx.store.get(id)) as { version?: number; dirty?: boolean; updatedAt: string } | undefined;
    if (row) {
      row.version = version;
      if (pushedUpdatedAt === undefined || row.updatedAt === pushedUpdatedAt) delete row.dirty;
      await (tx.store as unknown as { put(v: unknown): Promise<unknown> }).put(row);
    }
    await tx.done;
  }
  async dropTombstone(key: string) { await this.db.delete('tombstones', key); }

  async exportAll(): Promise<ExportBundle> {
    const [lib, notes, artifacts] = await Promise.all([this.loadLibrary(), this.db.getAll('notes'), this.db.getAll('artifacts')]);
    return { app: 'lexnote', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), ...lib, notes, artifacts };
  }

  async clearAll() {
    const names = ['subjects', 'modules', 'sessions', 'artifacts', 'notes', 'meta', 'tombstones'] as const;
    const tx = this.db.transaction([...names], 'readwrite');
    await Promise.all([...names.map((s) => tx.objectStore(s).clear()), tx.done]);
  }
  close() { this.db.close(); }
}
