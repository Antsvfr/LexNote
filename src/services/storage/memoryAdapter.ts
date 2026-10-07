import type { StudyArtifact } from '@/domain/study';
import type { CourseSession, LibrarySnapshot, Module, NoteDocument, Subject } from '@/domain/types';
import {
  SCHEMA_VERSION, type ChangeSet, type CommitOptions, type DirtySet, type ExportBundle, type StorageAdapter, type SyncTable, type Tombstone,
} from './types';

const clone = <T>(v: T): T => structuredClone(v);

/** Stockage en mémoire : tests, et repli si IndexedDB est indisponible (non persistant). */
export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  constructor(readonly persistent = false) {}

  private subjects = new Map<string, Subject>();
  private modules = new Map<string, Module>();
  private sessions = new Map<string, CourseSession>();
  private artifacts = new Map<string, StudyArtifact>();
  private notes = new Map<string, NoteDocument>();
  private meta = new Map<string, unknown>();
  private tombstones = new Map<string, Tombstone>();

  async loadLibrary(): Promise<LibrarySnapshot> {
    return { subjects: clone([...this.subjects.values()]), modules: clone([...this.modules.values()]), sessions: clone([...this.sessions.values()]) };
  }
  async loadArtifacts() { return clone([...this.artifacts.values()]); }
  async getNotes(sessionId: string) { const n = this.notes.get(sessionId); return n ? clone(n) : undefined; }

  async commit(c: ChangeSet, opts: CommitOptions = {}) {
    const mark = <T extends { dirty?: boolean }>(v: T): T => (opts.remote ? v : { ...v, dirty: true });
    const tomb = (table: SyncTable, map: Map<string, { version?: number }>, id: string) => {
      const prev = map.get(id);
      if (!opts.remote && prev?.version !== undefined) {
        this.tombstones.set(`${table}:${id}`, { key: `${table}:${id}`, table, id, version: prev.version, deletedAt: new Date().toISOString() });
      }
      if (opts.remote) this.tombstones.delete(`${table}:${id}`);
    };
    // Garde atomique : une écriture venant du cloud ne remplace JAMAIS une ligne modifiée localement et pas encore envoyée.
    const guarded = (map: Map<string, { dirty?: boolean }>, id: string) => !!opts.remote && !!map.get(id)?.dirty;
    const skippedSessions = new Set<string>();
    c.putSubjects?.forEach((s) => { if (guarded(this.subjects, s.id)) return; this.subjects.set(s.id, clone(mark(s))); this.tombstones.delete(`subjects:${s.id}`); });
    c.putModules?.forEach((m) => { if (guarded(this.modules, m.id)) return; this.modules.set(m.id, clone(mark(m))); this.tombstones.delete(`modules:${m.id}`); });
    c.putSessions?.forEach((s) => { if (guarded(this.sessions, s.id)) { skippedSessions.add(s.id); return; } this.sessions.set(s.id, clone(mark(s))); this.tombstones.delete(`course_sessions:${s.id}`); });
    c.putArtifacts?.forEach((a) => { if (guarded(this.artifacts, a.id)) return; this.artifacts.set(a.id, clone(mark(a))); this.tombstones.delete(`study_artifacts:${a.id}`); });
    c.putNotes?.forEach((n) => { if (!skippedSessions.has(n.sessionId)) this.notes.set(n.sessionId, clone(n)); });
    c.deleteArtifacts?.forEach((id) => { if (guarded(this.artifacts, id)) return; tomb('study_artifacts', this.artifacts, id); this.artifacts.delete(id); });
    c.deleteSubjects?.forEach((id) => { if (guarded(this.subjects, id)) return; tomb('subjects', this.subjects, id); this.subjects.delete(id); });
    c.deleteModules?.forEach((id) => { if (guarded(this.modules, id)) return; tomb('modules', this.modules, id); this.modules.delete(id); });
    c.deleteSessions?.forEach((id) => { if (guarded(this.sessions, id)) return; tomb('course_sessions', this.sessions, id); this.sessions.delete(id); this.notes.delete(id); });
  }

  async getMeta<T>(key: string) { return this.meta.get(key) as T | undefined; }
  async setMeta(key: string, value: unknown) { this.meta.set(key, value); }

  async listDirty(): Promise<DirtySet> {
    return {
      subjects: clone([...this.subjects.values()].filter((x) => x.dirty)),
      modules: clone([...this.modules.values()].filter((x) => x.dirty)),
      sessions: clone([...this.sessions.values()].filter((x) => x.dirty)),
      artifacts: clone([...this.artifacts.values()].filter((x) => x.dirty)),
      tombstones: clone([...this.tombstones.values()]),
    };
  }
  async markSynced(table: SyncTable, id: string, version: number, pushedUpdatedAt?: string) {
    const map = (table === 'subjects' ? this.subjects : table === 'modules' ? this.modules : table === 'study_artifacts' ? this.artifacts : this.sessions) as Map<string, { version?: number; dirty?: boolean; updatedAt: string }>;
    const row = map.get(id);
    if (!row) return;
    row.version = version;
    if (pushedUpdatedAt === undefined || row.updatedAt === pushedUpdatedAt) delete row.dirty;
  }
  async dropTombstone(key: string) { this.tombstones.delete(key); }

  async exportAll(): Promise<ExportBundle> {
    const lib = await this.loadLibrary();
    return { app: 'lexnote', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), ...lib, notes: clone([...this.notes.values()]), artifacts: clone([...this.artifacts.values()]) };
  }
  async clearAll() { [this.subjects, this.modules, this.sessions, this.artifacts, this.notes, this.meta, this.tombstones].forEach((m) => m.clear()); }
  close() { /* rien à fermer */ }
}
