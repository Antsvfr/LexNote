import { NetworkError, type PushResult, type RemoteRow, type RemoteStore, type RemoteTable } from './types';
import type { CaptureTable } from '@/services/capture/storage/types';
import type { SyncTable } from '@/services/storage/types';

/** « Serveur » en mémoire, partagé entre utilisateurs, qui imite Postgres + RLS + triggers (version, server_updated_at). */
export class CloudDb {
  tables = new Map<RemoteTable, Map<string, RemoteRow>>();
  private tick = 0;
  /** Simule une coupure réseau (tests). */
  offline = false;
  /** Observateur (persistance du mode démo / traçage dans les tests). */
  onChange?: () => void;

  rows(t: RemoteTable) { let m = this.tables.get(t); if (!m) { m = new Map(); this.tables.set(t, m); } return m; }
  /** Horodatage serveur strictement croissant. */
  now(): string { this.tick = Math.max(this.tick + 1, Date.now()); return new Date(this.tick).toISOString(); }
  toJSON() { return { tick: this.tick, tables: [...this.tables].map(([k, v]) => [k, [...v.values()]]) }; }
  static fromJSON(j: { tick?: number; tables?: [RemoteTable, RemoteRow[]][] } | null): CloudDb {
    const db = new CloudDb();
    if (!j) return db;
    db.tick = j.tick ?? 0;
    for (const [t, rows] of j.tables ?? []) { const m = db.rows(t); rows.forEach((r) => m.set(r.id, r)); }
    return db;
  }
}

const PARENT: Partial<Record<RemoteTable, { col: string; table: RemoteTable }[]>> = {
  modules: [{ col: 'subject_id', table: 'subjects' }],
  course_sessions: [{ col: 'subject_id', table: 'subjects' }, { col: 'module_id', table: 'modules' }],
  study_artifacts: [{ col: 'subject_id', table: 'subjects' }],
  source_documents: [{ col: 'session_id', table: 'course_sessions' }],
  generated_courses: [{ col: 'session_id', table: 'course_sessions' }],
  transcript_sessions: [{ col: 'session_id', table: 'course_sessions' }],
  transcript_segments: [{ col: 'session_id', table: 'course_sessions' }],
  timeline_markers: [{ col: 'session_id', table: 'course_sessions' }],
  note_anchors: [{ col: 'session_id', table: 'course_sessions' }],
  capture_interruptions: [{ col: 'session_id', table: 'course_sessions' }],
};

/** Vue d'UN utilisateur sur le serveur : ne voit et n'écrit que ses lignes (comme la RLS). */
export class InMemoryRemote implements RemoteStore {
  constructor(private db: CloudDb, private userId: string) {}

  private guard() { if (this.db.offline) throw new NetworkError(); }
  private mine(t: RemoteTable, id: string): RemoteRow | undefined { const r = this.db.rows(t).get(id); return r && r.user_id === this.userId ? r : undefined; }
  private checkParents(t: RemoteTable, row: RemoteRow) {
    for (const p of PARENT[t] ?? []) {
      const ref = row[p.col];
      if (ref == null) continue;
      if (!this.mine(p.table, String(ref))) throw new Error(`violates foreign key (${t}.${p.col})`);
    }
  }
  private save(t: RemoteTable, row: RemoteRow) { this.db.rows(t).set(row.id, row); this.db.onChange?.(); }

  async pull(table: RemoteTable, cursor: string | null, limit: number): Promise<RemoteRow[]> {
    this.guard();
    return [...this.db.rows(table).values()]
      .filter((r) => r.user_id === this.userId && (!cursor || String(r.server_updated_at) >= cursor))
      .sort((a, b) => String(a.server_updated_at).localeCompare(String(b.server_updated_at)))
      .slice(0, limit).map((r) => structuredClone(r));
  }

  async insert(table: SyncTable, row: RemoteRow): Promise<PushResult> {
    this.guard();
    if (row.user_id !== this.userId) throw new Error('row-level security: user_id');
    const existing = this.db.rows(table).get(row.id);
    if (existing) return { ok: false, reason: 'conflict', server: existing.user_id === this.userId ? structuredClone(existing) : null };
    this.checkParents(table, row);
    const stored: RemoteRow = { ...structuredClone(row), version: 1, server_updated_at: this.db.now() };
    this.save(table, stored);
    return { ok: true, row: structuredClone(stored) };
  }

  async update(table: SyncTable, row: RemoteRow, baseVersion: number): Promise<PushResult> {
    this.guard();
    if (row.user_id !== this.userId) throw new Error('row-level security: user_id');
    const cur = this.mine(table, row.id);
    if (!cur) return { ok: false, reason: 'conflict', server: null };
    if (cur.version !== baseVersion) return { ok: false, reason: 'conflict', server: structuredClone(cur) };
    this.checkParents(table, row);
    const stored: RemoteRow = { ...structuredClone(row), created_at: cur.created_at, version: (cur.version ?? 0) + 1, server_updated_at: this.db.now() };
    this.save(table, stored);
    return { ok: true, row: structuredClone(stored) };
  }

  async upsertMany(table: CaptureTable, rows: RemoteRow[]): Promise<void> {
    this.guard();
    for (const row of rows) {
      if (row.user_id !== this.userId) throw new Error('row-level security: user_id');
      this.checkParents(table, row);
      const cur = this.mine(table, row.id);
      if (!cur && this.db.rows(table).has(row.id)) throw new Error('row-level security: id');
      this.save(table, { ...structuredClone(row), created_at: cur?.created_at ?? row.created_at, version: (cur?.version ?? 0) + 1, server_updated_at: this.db.now() });
    }
  }

  async softDelete(table: RemoteTable, id: string): Promise<void> {
    this.guard();
    const cur = this.mine(table, id);
    if (!cur) return;
    this.save(table, { ...cur, deleted_at: this.db.now(), version: (cur.version ?? 0) + 1, server_updated_at: this.db.now() });
  }

  async touchDevice(): Promise<void> { this.guard(); }
}
