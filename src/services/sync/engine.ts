import type { AudioSession } from '@/domain/capture';
import type { CourseSession } from '@/domain/types';
import { newId } from '@/lib/ids';
import type { CaptureStorage, CaptureTable } from '@/services/capture/storage/types';
import type { ChangeSet, StorageAdapter, SyncTable } from '@/services/storage/types';
import {
  anchorFromRow, anchorToRow, audioSessionFromRow, audioSessionToRow, interruptionFromRow, interruptionToRow, markerFromRow, markerToRow,
  artifactFromRow, artifactToRow, courseFromRow, courseToRow, documentFromRow, documentToRow, moduleFromRow, moduleToRow, segmentFromRow, segmentToRow, sessionFromRow, sessionToRow, subjectFromRow, subjectToRow,
} from './mappers';
import { CAPTURE_TABLES, NetworkError, type RemoteRow, type RemoteStore, type RemoteTable, VERSIONED_TABLES } from './types';

/** Ce qui a changé localement à cause du cloud : l'UI se rafraîchit en conséquence. */
export interface AppliedChanges {
  library: boolean;
  removedSessionIds: string[];
  captureSessionIds: string[];
}

export interface EngineStatusSink {
  update(p: { state?: 'syncing' | 'synced' | 'offline' | 'error'; pending?: number; lastSyncAt?: string | null; error?: string | null; conflicts?: number }): void;
}

export interface EngineDeps {
  userId: string;
  deviceId: string;
  local: StorageAdapter;
  capture: () => CaptureStorage | null;
  remote: RemoteStore;
  status: EngineStatusSink;
  onApplied: (c: AppliedChanges) => void;
  /** Un conflit de contenu a été résolu en gardant les deux versions. */
  onConflictCopy?: (original: CourseSession, copy: CourseSession) => void;
  isOnline?: () => boolean;
  now?: () => number;
}

/** Tables « simples » (une ligne = un objet, pas de contenu annexe) : supports d'étude, documents importés, cours reconstruits. */
const SIMPLE = {
  study_artifacts: { load: (l: StorageAdapter) => l.loadArtifacts(), put: 'putArtifacts', del: 'deleteArtifacts', from: artifactFromRow },
  source_documents: { load: (l: StorageAdapter) => l.loadDocuments(), put: 'putDocuments', del: 'deleteDocuments', from: documentFromRow },
  generated_courses: { load: (l: StorageAdapter) => l.loadCourses(), put: 'putCourses', del: 'deleteCourses', from: courseFromRow },
} as const;
type Simple = keyof typeof SIMPLE;
const isSimple = (t: SyncTable): t is Simple => t in SIMPLE;
const putSimple = (l: StorageAdapter, t: Simple, row: object, remote = false) => l.commit({ [SIMPLE[t].put]: [row] } as ChangeSet, remote ? { remote: true } : undefined);
const delSimple = (l: StorageAdapter, t: Simple, id: string) => l.commit({ [SIMPLE[t].del]: [id] } as ChangeSet, { remote: true });

/** Passé à `markSynced` pour ne mettre à jour que la version (la ligne reste « à envoyer »). */
const KEEP_DIRTY = '__keep_dirty__';
const PAGE = 1000;
const PUSH_BATCH = 200;

const stableJson = (v: unknown) => JSON.stringify(v ?? null);

/**
 * Moteur de synchronisation LOCAL-FIRST.
 *
 *   écriture → IndexedDB (immédiat, jamais bloqué par le réseau) → lignes marquées `dirty` → ce moteur → cloud
 *
 * - envoi : parents avant enfants ; mise à jour conditionnelle par `version` (verrou optimiste) ;
 * - réception : par curseur `server_updated_at` ; une ligne locale `dirty` n'est JAMAIS écrasée ;
 * - conflit de CONTENU (notes) : on garde les deux versions (copie « conflit ») — jamais d'écrasement silencieux ;
 * - suppressions : pierres tombales locales → `deleted_at` côté serveur → propagées aux autres appareils.
 */
export class SyncEngine {
  private running = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private conflicts = 0;

  constructor(private d: EngineDeps) {}

  private online() { return this.d.isOnline ? this.d.isOnline() : typeof navigator === 'undefined' || navigator.onLine !== false; }

  start() {
    this.stopped = false;
    const onOnline = () => void this.syncNow();
    const onVisible = () => { if (document.visibilityState === 'visible') void this.syncNow(); };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', () => this.d.status.update({ state: 'offline' }));
      document.addEventListener('visibilitychange', onVisible);
      this.cleanup = () => { window.removeEventListener('online', onOnline); document.removeEventListener('visibilitychange', onVisible); };
    }
    this.interval = setInterval(() => void this.syncNow(), 60_000);
    void this.syncNow();
  }
  private cleanup: (() => void) | undefined;
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.interval);
    this.cleanup?.();
  }

  /** Planifie une synchronisation peu après une écriture locale (regroupe les frappes). */
  schedule(delayMs = 1500, maxWaitMs = 15_000) {
    if (this.stopped) return;
    const now = Date.now();
    // Délai glissant (regroupe les frappes) borné : une écriture continue est quand même envoyée toutes les 15 s.
    if (!this.firstScheduledAt) this.firstScheduledAt = now;
    clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(delayMs, this.firstScheduledAt + maxWaitMs - now));
    this.timer = setTimeout(() => { this.firstScheduledAt = 0; void this.syncNow(); }, wait);
    void this.refreshPending();
  }
  private firstScheduledAt = 0;

  async refreshPending() {
    try { this.d.status.update({ pending: await this.countPending() }); } catch { /* base fermée */ }
  }
  private async countPending(): Promise<number> {
    const l = await this.d.local.listDirty();
    const c = this.d.capture();
    let n = l.subjects.length + l.modules.length + l.sessions.length + l.artifacts.length + l.documents.length + l.courses.length + l.tombstones.length;
    if (c) { const k = await c.listDirty(); n += k.audioSessions.length + k.segments.length + k.markers.length + k.anchors.length + k.interruptions.length + k.tombstones.length; }
    return n;
  }

  /** Une seule synchronisation à la fois ; une demande pendant l'exécution déclenche un nouveau tour. */
  async syncNow(): Promise<void> {
    if (this.stopped) return;
    if (this.running) { this.again = true; return; }
    if (!this.online()) { this.d.status.update({ state: 'offline', pending: await this.safePending() }); return; }
    this.running = true;
    this.d.status.update({ state: 'syncing' });
    try {
      let rounds = 0;
      do {
        this.again = false;
        await this.push();
        await this.pull();
        rounds++;
      } while (this.again && rounds < 3 && !this.stopped);
      await this.d.remote.touchDevice(this.d.deviceId, typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : 'node').catch(() => undefined);
      this.d.status.update({ state: 'synced', lastSyncAt: new Date().toISOString(), error: null, pending: await this.safePending() });
    } catch (err) {
      const offline = err instanceof NetworkError || !this.online();
      this.d.status.update({
        state: offline ? 'offline' : 'error', pending: await this.safePending(),
        error: offline ? null : (err as Error).message,
      });
      if (!offline) console.error('[LexNote] synchronisation', err);
    } finally {
      this.running = false;
    }
  }
  private async safePending() { try { return await this.countPending(); } catch { return 0; } }

  /* ===================================================================== envoi */
  private async push() {
    const { local } = this.d;
    const dirty = await local.listDirty();

    for (const s of dirty.subjects) await this.pushVersioned('subjects', s.id, s.updatedAt, subjectToRow(s), s.version);
    for (const m of dirty.modules) await this.pushVersioned('modules', m.id, m.updatedAt, moduleToRow(m), m.version);
    for (const s of dirty.sessions) {
      const notes = (await local.getNotes(s.id))?.content;
      await this.pushVersioned('course_sessions', s.id, s.updatedAt, sessionToRow(s, notes), s.version);
    }
    for (const a of dirty.artifacts) await this.pushVersioned('study_artifacts', a.id, a.updatedAt, artifactToRow(a), a.version);
    for (const d of dirty.documents) await this.pushVersioned('source_documents', d.id, d.updatedAt, documentToRow(d), d.version);
    for (const c of dirty.courses) await this.pushVersioned('generated_courses', c.id, c.updatedAt, courseToRow(c), c.version);
    for (const t of dirty.tombstones) {
      await this.d.remote.softDelete(t.table, t.id);
      await local.dropTombstone(t.key);
    }
    await this.pushCapture();
  }

  private async pushVersioned(table: SyncTable, id: string, updatedAt: string, row: RemoteRow, version: number | undefined) {
    const res = version === undefined ? await this.d.remote.insert(table, row) : await this.d.remote.update(table, row, version);
    if (res.ok) {
      await this.d.local.markSynced(table, id, res.row.version ?? 1, updatedAt);
      return;
    }
    await this.resolveConflict(table, id, row, res.server);
    this.again = true; // la ligne a été rebasée / copiée : un nouveau tour l'enverra
  }

  /**
   * Conflit : le serveur a une version que nous n'avions pas vue.
   *  - le serveur l'a SUPPRIMÉE alors que nous l'avons modifiée → on la RESTAURE (la modification locale est gardée) ;
   *  - conflit de CONTENU de séance (notes différentes) → on garde les deux : copie « conflit » + version serveur ;
   *  - métadonnées seules → la modification la plus récente gagne (rien de précieux n'est perdu : titres, couleurs…).
   */
  private async resolveConflict(table: SyncTable, id: string, localRow: RemoteRow, server: RemoteRow | null) {
    const { local } = this.d;
    if (!server) {
      // Le serveur ne connaît pas cette ligne (base réinitialisée…) : on oublie la version et on la ré-insère comme nouvelle.
      const lib = await local.loadLibrary();
      if (table === 'subjects') { const r = lib.subjects.find((x) => x.id === id); if (r) await local.commit({ putSubjects: [{ ...r, version: undefined }] }); }
      else if (table === 'modules') { const r = lib.modules.find((x) => x.id === id); if (r) await local.commit({ putModules: [{ ...r, version: undefined }] }); }
      else if (isSimple(table)) { const r = (await SIMPLE[table].load(local)).find((x) => x.id === id); if (r) await putSimple(local, table, { ...r, version: undefined }); }
      else { const r = lib.sessions.find((x) => x.id === id); if (r) await local.commit({ putSessions: [{ ...r, version: undefined }] }); }
      return;
    }
    const serverDeleted = !!server.deleted_at;
    if (serverDeleted) {
      // Restauration : mise à jour conditionnelle sur la version serveur actuelle, deleted_at remis à null.
      const res = await this.d.remote.update(table, { ...localRow, deleted_at: null }, server.version ?? 0);
      if (res.ok) await local.markSynced(table, id, res.row.version ?? 1, String(localRow.updated_at));
      return;
    }

    if (table === 'course_sessions') {
      const lib = await local.loadLibrary();
      const mine = lib.sessions.find((s) => s.id === id);
      const myNotes = (await local.getNotes(id))?.content;
      if (mine && stableJson(myNotes) !== stableJson(server.notes_content)) {
        await this.keepBoth(mine, myNotes, server);
        return;
      }
    }
    if (table === 'study_artifacts') {
      // Support d'étude : jamais d'écrasement silencieux d'un travail de l'utilisateur.
      const mine = (await local.loadArtifacts()).find((x) => x.id === id);
      if (mine && String(server.updated_at ?? '') > mine.updatedAt && stableJson(server.content) !== stableJson(mine.content)) {
        const stamp = new Date().toISOString();
        await local.commit({ putArtifacts: [{ ...structuredClone(mine), id: newId(), version: undefined, dirty: undefined, createdAt: stamp, updatedAt: stamp, title: `${mine.title} (copie locale en conflit)` }] });
        await this.applyServerRow(table, server);
        this.conflicts++;
        this.d.status.update({ conflicts: this.conflicts });
        return;
      }
    }
    const serverEdited = String(server.updated_at ?? '');
    if (String(localRow.updated_at) >= serverEdited) {
      // La version locale est plus récente : on la garde, rebasée sur la version serveur.
      await local.markSynced(table, id, server.version ?? 1, KEEP_DIRTY);
    } else {
      await this.applyServerRow(table, server);
    }
  }

  private async keepBoth(mine: CourseSession, myNotes: unknown, server: RemoteRow) {
    const stamp = new Date().toISOString();
    const copy: CourseSession = {
      ...structuredClone(mine), id: newId(), version: undefined, dirty: undefined, createdAt: stamp, updatedAt: stamp,
      title: `${mine.title || 'Séance'} (version locale en conflit)`,
    };
    await this.d.local.commit({ putSessions: [copy], putNotes: myNotes === undefined ? [] : [{ sessionId: copy.id, content: myNotes, updatedAt: stamp }] });
    // La version serveur remplace l'originale ; rien n'est perdu : la copie porte le contenu local.
    await this.forceApplyServerSession(server);
    this.conflicts++;
    this.d.status.update({ conflicts: this.conflicts });
    this.d.onConflictCopy?.(mine, copy);
    this.d.onApplied({ library: true, removedSessionIds: [], captureSessionIds: [] });
  }

  /** Écrase la ligne locale par la version serveur (après avoir sauvegardé la copie locale). */
  private async forceApplyServerSession(server: RemoteRow) {
    const { session, notes } = sessionFromRow(server);
    // Pour passer la garde « dirty » on nettoie d'abord la ligne : la copie conserve le contenu local.
    await this.markClean('course_sessions', session.id);
    await this.d.local.commit({ putSessions: [session], putNotes: notes === undefined ? [] : [{ sessionId: session.id, content: notes, updatedAt: session.updatedAt }] }, { remote: true });
  }
  private async markClean(table: SyncTable, id: string) {
    const lib = await this.d.local.loadLibrary();
    const row = [...lib.subjects, ...lib.modules, ...lib.sessions, ...(await this.d.local.loadArtifacts()), ...(await this.d.local.loadDocuments()), ...(await this.d.local.loadCourses())].find((x) => x.id === id);
    if (row) await this.d.local.markSynced(table, id, row.version ?? 0, row.updatedAt);
  }

  private async applyServerRow(table: SyncTable, server: RemoteRow) {
    await this.markClean(table, server.id);
    if (table === 'subjects') await this.d.local.commit({ putSubjects: [subjectFromRow(server)] }, { remote: true });
    else if (table === 'modules') await this.d.local.commit({ putModules: [moduleFromRow(server)] }, { remote: true });
    else if (isSimple(table)) await putSimple(this.d.local, table, SIMPLE[table].from(server), true);
    else await this.forceApplyServerSession(server);
    this.d.onApplied({ library: true, removedSessionIds: [], captureSessionIds: [] });
  }

  private async pushCapture() {
    const cap = this.d.capture();
    if (!cap) return;
    const u = this.d.userId;
    const dirty = await cap.listDirty();
    const send = async <T extends { id: string }>(table: CaptureTable, items: T[], toRow: (x: T) => RemoteRow) => {
      for (let i = 0; i < items.length; i += PUSH_BATCH) {
        const chunk = items.slice(i, i + PUSH_BATCH);
        await this.d.remote.upsertMany(table, chunk.map(toRow));
        await cap.markSynced(table, chunk.map((x) => x.id));
      }
    };
    await send('transcript_sessions', dirty.audioSessions, (a: AudioSession) => audioSessionToRow(a, u));
    await send('transcript_segments', dirty.segments, (x) => segmentToRow(x, u));
    await send('timeline_markers', dirty.markers, (x) => markerToRow(x, u));
    await send('note_anchors', dirty.anchors, (x) => anchorToRow(x, u));
    await send('capture_interruptions', dirty.interruptions, (x) => interruptionToRow(x, u));
    for (const t of dirty.tombstones) { await this.d.remote.softDelete(t.table, t.id); await cap.dropTombstone(t.key); }
  }

  /* ================================================================ réception */
  private async pull() {
    const applied: AppliedChanges = { library: false, removedSessionIds: [], captureSessionIds: [] };
    for (const table of VERSIONED_TABLES) await this.pullVersioned(table, applied);
    await this.pullCapture(applied);
    if (applied.library || applied.removedSessionIds.length || applied.captureSessionIds.length) this.d.onApplied(applied);
  }

  private async cursor(table: RemoteTable): Promise<string | null> {
    return ((await this.d.local.getMeta<string>(`cursor:${table}`)) ?? null);
  }
  private async setCursor(table: RemoteTable, v: string) { await this.d.local.setMeta(`cursor:${table}`, v); }

  private async pullVersioned(table: SyncTable, applied: AppliedChanges) {
    const { local } = this.d;
    for (;;) {
      const cursor = await this.cursor(table);
      const rows = await this.d.remote.pull(table, cursor, PAGE);
      if (!rows.length) return;
      const lib = await local.loadLibrary();
      const simpleRows = isSimple(table) ? await SIMPLE[table].load(local) : [];
      const byId = new Map<string, { version?: number; dirty?: boolean }>(
        ([] as { id: string; version?: number; dirty?: boolean }[]).concat(table === 'subjects' ? lib.subjects : table === 'modules' ? lib.modules : isSimple(table) ? simpleRows : lib.sessions).map((x) => [x.id, x]),
      );
      for (const row of rows) {
        const mine = byId.get(row.id);
        if (row.deleted_at) {
          if (mine && !mine.dirty) {
            if (isSimple(table)) await delSimple(local, table, row.id);
            else await local.commit(table === 'subjects' ? { deleteSubjects: [row.id] } : table === 'modules' ? { deleteModules: [row.id] } : { deleteSessions: [row.id] }, { remote: true });
            applied.library = true;
            if (table === 'course_sessions') applied.removedSessionIds.push(row.id);
          }
          continue; // modification locale en attente : elle restaurera la ligne à l'envoi
        }
        if (mine?.dirty) continue; // la garde locale prime ; le conflit éventuel est traité à l'envoi
        if (mine && (mine.version ?? 0) >= (row.version ?? 0)) continue; // déjà à jour (curseur inclusif : idempotent)
        if (table === 'subjects') await local.commit({ putSubjects: [subjectFromRow(row)] }, { remote: true });
        else if (table === 'modules') await local.commit({ putModules: [moduleFromRow(row)] }, { remote: true });
        else if (isSimple(table)) await putSimple(local, table, SIMPLE[table].from(row), true);
        else {
          const { session, notes } = sessionFromRow(row);
          await local.commit({ putSessions: [session], putNotes: notes === undefined ? [] : [{ sessionId: session.id, content: notes, updatedAt: session.updatedAt }] }, { remote: true });
        }
        applied.library = true;
      }
      const last = String(rows[rows.length - 1]!.server_updated_at);
      const same = last === cursor;
      await this.setCursor(table, last);
      if (rows.length < PAGE || same) return;
    }
  }

  private async pullCapture(applied: AppliedChanges) {
    const cap = this.d.capture();
    if (!cap) return;
    const lib = await this.d.local.loadLibrary();
    const known = new Set(lib.sessions.map((s) => s.id));
    for (const table of CAPTURE_TABLES) {
      for (;;) {
        const cursor = ((await cap.getMeta<string>(`cursor:${table}`)) ?? null);
        const rows = await this.d.remote.pull(table, cursor, PAGE);
        if (!rows.length) break;
        for (const row of rows) {
          const sid = String(row.session_id);
          if (!known.has(sid)) continue; // séance supprimée / inconnue : rien à rattacher
          if (row.deleted_at) {
            if (table === 'timeline_markers') { await cap.deleteMarker(row.id, { remote: true }); applied.captureSessionIds.push(sid); }
            continue;
          }
          await this.applyCaptureRow(cap, table, row);
          applied.captureSessionIds.push(sid);
        }
        const last = String(rows[rows.length - 1]!.server_updated_at);
        const same = last === cursor;
        await cap.setMeta(`cursor:${table}`, last);
        if (rows.length < PAGE || same) break;
      }
    }
  }

  /** Les lignes de capture locales « dirty » gagnent (elles seront envoyées) ; sinon on applique la version serveur. */
  private async applyCaptureRow(cap: CaptureStorage, table: CaptureTable, row: RemoteRow) {
    const remote = { remote: true } as const;
    switch (table) {
      case 'transcript_sessions': {
        const cur = await cap.getAudioSession(String(row.id));
        if (cur?.dirty) return;
        // Ne jamais « rétrograder » une séance dont on a l'audio localement.
        if (cur && cur.mimeType && !row.mime_type) return;
        await cap.putAudioSession({ ...audioSessionFromRow(row), ...(cur ? { chunkMs: cur.chunkMs, bitsPerSecond: cur.bitsPerSecond } : {}) }, remote);
        return;
      }
      case 'transcript_segments': {
        const list = await cap.listSegments(String(row.session_id));
        if (list.find((x) => x.id === row.id)?.dirty) return;
        await cap.putSegments([segmentFromRow(row)], remote); return;
      }
      case 'timeline_markers': {
        const list = await cap.listMarkers(String(row.session_id));
        if (list.find((x) => x.id === row.id)?.dirty) return;
        await cap.putMarker(markerFromRow(row), remote); return;
      }
      case 'note_anchors': {
        const list = await cap.listAnchors(String(row.session_id));
        if (list.find((x) => x.id === row.id)?.dirty) return;
        await cap.putAnchors([anchorFromRow(row)], remote); return;
      }
      case 'capture_interruptions': {
        const list = await cap.listInterruptions(String(row.session_id));
        if (list.find((x) => x.id === row.id)?.dirty) return;
        await cap.putInterruption(interruptionFromRow(row), remote); return;
      }
    }
  }
}
