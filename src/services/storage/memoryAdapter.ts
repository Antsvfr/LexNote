import type { CourseSession, LibrarySnapshot, Module, NoteDocument, Subject } from '@/domain/types';
import { SCHEMA_VERSION, type ChangeSet, type ExportBundle, type StorageAdapter } from './types';

const clone = <T>(v: T): T => structuredClone(v);

/** Stockage en mémoire : tests, et repli si IndexedDB est indisponible (non persistant). */
export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  constructor(readonly persistent = false) {}

  private subjects = new Map<string, Subject>();
  private modules = new Map<string, Module>();
  private sessions = new Map<string, CourseSession>();
  private notes = new Map<string, NoteDocument>();
  private meta = new Map<string, unknown>();

  async loadLibrary(): Promise<LibrarySnapshot> {
    return {
      subjects: clone([...this.subjects.values()]),
      modules: clone([...this.modules.values()]),
      sessions: clone([...this.sessions.values()]),
    };
  }
  async getNotes(sessionId: string) {
    const n = this.notes.get(sessionId);
    return n ? clone(n) : undefined;
  }
  async commit(c: ChangeSet) {
    c.putSubjects?.forEach((s) => this.subjects.set(s.id, clone(s)));
    c.putModules?.forEach((m) => this.modules.set(m.id, clone(m)));
    c.putSessions?.forEach((s) => this.sessions.set(s.id, clone(s)));
    c.putNotes?.forEach((n) => this.notes.set(n.sessionId, clone(n)));
    c.deleteSubjects?.forEach((id) => this.subjects.delete(id));
    c.deleteModules?.forEach((id) => this.modules.delete(id));
    c.deleteSessions?.forEach((id) => {
      this.sessions.delete(id);
      this.notes.delete(id);
    });
  }
  async getMeta<T>(key: string) {
    return this.meta.get(key) as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    this.meta.set(key, value);
  }
  async exportAll(): Promise<ExportBundle> {
    const lib = await this.loadLibrary();
    return {
      app: 'lexnote',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      ...lib,
      notes: clone([...this.notes.values()]),
    };
  }
  async clearAll() {
    this.subjects.clear();
    this.modules.clear();
    this.sessions.clear();
    this.notes.clear();
    this.meta.clear();
  }
}
