import type { CourseSession, LibrarySnapshot, Module, NoteDocument, Subject } from '@/domain/types';
import type { ChangeSet, StorageAdapter } from '@/services/storage/types';
import { restPatch, restSelect, restUpsert } from '@/services/supabase/client';
import { useAuth } from '@/store/auth';
import { setSyncStatus } from '@/store/sync';

export interface SyncEngine {
  readonly enabled: boolean;
  enqueue(changes: ChangeSet): void;
  flush(): Promise<void>;
  pull(): Promise<void>;
  dispose(): void;
}

export const noopSync: SyncEngine = {
  enabled: false,
  enqueue() {},
  async flush() {},
  async pull() {},
  dispose() {},
};

interface QueuedChange {
  id: string;
  createdAt: string;
  changes: ChangeSet;
}

const now = () => new Date().toISOString();
const queueKey = (userId: string) => 'lexnote.sync.queue.' + userId;
const lastKey = (userId: string) => 'lexnote.sync.last.' + userId;

function readQueue(userId: string): QueuedChange[] {
  try { return JSON.parse(localStorage.getItem(queueKey(userId)) ?? '[]') as QueuedChange[]; }
  catch { return []; }
}

function writeQueue(userId: string, queue: QueuedChange[]) {
  try { localStorage.setItem(queueKey(userId), JSON.stringify(queue)); } catch { /* best effort */ }
}

function token(): string {
  const t = useAuth.getState().session?.access_token;
  if (!t) throw new Error('Session cloud expirée.');
  return t;
}

function rowSubject(s: Subject, userId: string): Record<string, unknown> {
  return {
    id: s.id, user_id: userId, name: s.name, color: s.color,
    created_at: s.createdAt, updated_at: s.updatedAt, deleted_at: null,
  };
}

function rowModule(m: Module, userId: string): Record<string, unknown> {
  return {
    id: m.id, user_id: userId, subject_id: m.subjectId, name: m.name,
    created_at: m.createdAt, updated_at: m.updatedAt, deleted_at: null,
  };
}

function rowSession(s: CourseSession, userId: string, notes?: NoteDocument): Record<string, unknown> {
  return {
    id: s.id,
    user_id: userId,
    subject_id: s.subjectId,
    module_id: s.moduleId || null,
    session_type: s.type ?? 'CM',
    title: s.title,
    session_date: s.date || null,
    start_time: s.startTime || null,
    end_time: s.endTime || null,
    teacher: s.teacher || null,
    room: s.room || null,
    status: s.status === 'completed' ? 'COMPLETED' : 'IN_PROGRESS',
    notes: notes?.content ?? null,
    word_count: s.wordCount,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    deleted_at: null,
  };
}

const field = <T>(r: Record<string, unknown>, k: string, fallback: T): T => (r[k] == null ? fallback : r[k] as T);

function fromSubject(r: Record<string, unknown>): Subject {
  return {
    id: String(r.id), name: String(r.name ?? ''), color: String(r.color ?? 'indigo'),
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

function fromModule(r: Record<string, unknown>): Module {
  return {
    id: String(r.id), subjectId: String(r.subject_id), name: String(r.name ?? ''),
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

function fromSession(r: Record<string, unknown>): CourseSession {
  return {
    id: String(r.id),
    subjectId: String(r.subject_id),
    moduleId: r.module_id ? String(r.module_id) : '',
    type: String(r.session_type ?? 'COURSE') as CourseSession['type'],
    number: null,
    title: String(r.title ?? ''),
    date: String(r.session_date ?? new Date().toISOString().slice(0, 10)),
    startTime: r.start_time ? String(r.start_time) : undefined,
    endTime: r.end_time ? String(r.end_time) : undefined,
    teacher: r.teacher ? String(r.teacher) : undefined,
    room: r.room ? String(r.room) : undefined,
    durationSec: 0,
    status: String(r.status) === 'COMPLETED' ? 'completed' : 'in_progress',
    completedAt: String(r.status) === 'COMPLETED' ? String(r.updated_at) : null,
    wordCount: Number(r.word_count ?? 0),
    excerpt: '',
    searchText: '',
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    transcript: null,
    audio: null,
    documents: [],
    aiOutputs: {},
    legalItems: [],
    flashcards: [],
    questions: [],
    aiMeta: null,
  };
}

export class CloudSyncEngine implements SyncEngine {
  readonly enabled = true;
  private queue: QueuedChange[];
  private onlineHandler = () => { void this.flush().then(() => this.pull()); };
  private flushing = false;

  constructor(private userId: string, private local: StorageAdapter) {
    this.queue = readQueue(userId);
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', () => setSyncStatus({ phase: 'offline' }));
    setSyncStatus({ pending: this.queue.length, phase: navigator.onLine ? 'idle' : 'offline' });
  }

  enqueue(changes: ChangeSet) {
    this.queue.push({ id: crypto.randomUUID(), createdAt: now(), changes });
    writeQueue(this.userId, this.queue);
    setSyncStatus({ pending: this.queue.length, phase: navigator.onLine ? 'idle' : 'offline' });
    if (navigator.onLine) void this.flush();
  }

  async flush() {
    if (this.flushing || !navigator.onLine || !this.queue.length) {
      if (!navigator.onLine) setSyncStatus({ phase: 'offline' });
      return;
    }
    this.flushing = true;
    setSyncStatus({ phase: 'syncing', pending: this.queue.length, lastError: null });
    try {
      while (this.queue.length) {
        const item = this.queue[0]!;
        await this.pushChange(item.changes);
        this.queue.shift();
        writeQueue(this.userId, this.queue);
        setSyncStatus({ pending: this.queue.length });
      }
      const at = now();
      localStorage.setItem(lastKey(this.userId), at);
      setSyncStatus({ phase: 'idle', pending: 0, lastSyncedAt: at, lastError: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Synchronisation impossible.';
      setSyncStatus({ phase: navigator.onLine ? 'error' : 'offline', lastError: message, pending: this.queue.length });
    } finally {
      this.flushing = false;
    }
  }

  private async pushChange(c: ChangeSet) {
    const access = token();
    await restUpsert('subjects', (c.putSubjects ?? []).map((x) => rowSubject(x, this.userId)), access);
    await restUpsert('modules', (c.putModules ?? []).map((x) => rowModule(x, this.userId)), access);

    const notesBySession = new Map((c.putNotes ?? []).map((n) => [n.sessionId, n]));
    await restUpsert('course_sessions', (c.putSessions ?? []).map((x) => rowSession(x, this.userId, notesBySession.get(x.id))), access);

    for (const note of c.putNotes ?? []) {
      if ((c.putSessions ?? []).some((s) => s.id === note.sessionId)) continue;
      await restPatch('course_sessions', 'id=eq.' + encodeURIComponent(note.sessionId), { notes: note.content, updated_at: note.updatedAt }, access);
    }

    const deletedAt = now();
    for (const id of c.deleteSubjects ?? []) await restPatch('subjects', 'id=eq.' + encodeURIComponent(id), { deleted_at: deletedAt, updated_at: deletedAt }, access);
    for (const id of c.deleteModules ?? []) await restPatch('modules', 'id=eq.' + encodeURIComponent(id), { deleted_at: deletedAt, updated_at: deletedAt }, access);
    for (const id of c.deleteSessions ?? []) await restPatch('course_sessions', 'id=eq.' + encodeURIComponent(id), { deleted_at: deletedAt, updated_at: deletedAt }, access);
  }

  async pull() {
    if (!navigator.onLine) return;
    const access = token();
    setSyncStatus({ phase: 'syncing' });
    try {
      const [sr, mr, cr] = await Promise.all([
        restSelect<Record<string, unknown>>('subjects', 'select=*&deleted_at=is.null', access),
        restSelect<Record<string, unknown>>('modules', 'select=*&deleted_at=is.null', access),
        restSelect<Record<string, unknown>>('course_sessions', 'select=*&deleted_at=is.null', access),
      ]);
      const remote: LibrarySnapshot = {
        subjects: sr.map(fromSubject),
        modules: mr.map(fromModule),
        sessions: cr.map(fromSession),
      };
      const local = await this.local.loadLibrary();
      const choose = <T extends { id: string; updatedAt: string }>(a: T[], b: T[]): T[] => {
        const map = new Map(a.map((x) => [x.id, x]));
        for (const x of b) {
          const old = map.get(x.id);
          if (!old || x.updatedAt > old.updatedAt) map.set(x.id, x);
        }
        return [...map.values()];
      };
      const merged: LibrarySnapshot = {
        subjects: choose(local.subjects, remote.subjects),
        modules: choose(local.modules, remote.modules),
        sessions: choose(local.sessions, remote.sessions),
      };
      const notes: NoteDocument[] = cr
        .filter((r) => r.notes != null)
        .map((r) => ({ sessionId: String(r.id), content: r.notes, updatedAt: String(r.updated_at) }));
      await this.local.commit({
        putSubjects: merged.subjects,
        putModules: merged.modules,
        putSessions: merged.sessions,
        putNotes: notes,
      });
      const at = now();
      localStorage.setItem(lastKey(this.userId), at);
      setSyncStatus({ phase: 'idle', lastSyncedAt: at, lastError: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Lecture cloud impossible.';
      setSyncStatus({ phase: 'error', lastError: message });
    }
  }

  dispose() {
    window.removeEventListener('online', this.onlineHandler);
  }
}