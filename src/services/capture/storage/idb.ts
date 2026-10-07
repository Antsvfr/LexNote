import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AudioChunk, AudioSession, Interruption, NoteAnchor, TimelineMarker, TranscriptSegment } from '@/domain/capture';
import type { CaptureDirty, CaptureExport, CaptureStorage, CaptureTable, CaptureTombstone, WriteOpts } from './types';

/** Audio stocké en ArrayBuffer (et non Blob) : comportement identique sur Chrome, Firefox et Safari. */
interface ChunkData { id: string; sessionId: string; mimeType: string; data: ArrayBuffer }

interface CaptureDB extends DBSchema {
  audioSessions: { key: string; value: AudioSession };
  chunks: { key: string; value: AudioChunk; indexes: { bySession: string } };
  chunkData: { key: string; value: ChunkData; indexes: { bySession: string } };
  segments: { key: string; value: TranscriptSegment; indexes: { bySession: string } };
  markers: { key: string; value: TimelineMarker; indexes: { bySession: string } };
  anchors: { key: string; value: NoteAnchor; indexes: { bySession: string } };
  interruptions: { key: string; value: Interruption; indexes: { bySession: string } };
  tombstones: { key: string; value: CaptureTombstone };
  meta: { key: string; value: unknown };
}

/** Une base de capture par utilisateur. */
export const captureDbName = (userId: string) => `lexnote-capture-u-${userId}`;
const VERSION = 1;
type StoreName = keyof CaptureDB;
const SESSION_STORES: StoreName[] = ['chunks', 'chunkData', 'segments', 'markers', 'anchors', 'interruptions'];
const STORE_FOR: Record<CaptureTable, 'audioSessions' | 'segments' | 'markers' | 'anchors' | 'interruptions'> = {
  transcript_sessions: 'audioSessions', transcript_segments: 'segments', timeline_markers: 'markers', note_anchors: 'anchors', capture_interruptions: 'interruptions',
};

export class IndexedDbCaptureStorage implements CaptureStorage {
  readonly kind = 'indexeddb' as const;
  readonly persistent = true;
  private constructor(private db: IDBPDatabase<CaptureDB>) {}

  static async open(name: string): Promise<IndexedDbCaptureStorage> {
    const db = await openDB<CaptureDB>(name, VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('audioSessions', { keyPath: 'id' });
          for (const s of SESSION_STORES) db.createObjectStore(s as 'chunks', { keyPath: 'id' }).createIndex('bySession', 'sessionId');
          db.createObjectStore('tombstones', { keyPath: 'key' });
          db.createObjectStore('meta');
        }
      },
    });
    db.addEventListener('versionchange', () => db.close());
    return new IndexedDbCaptureStorage(db);
  }

  private mark<T extends { dirty?: boolean }>(v: T, opts?: WriteOpts): T { const c = { ...v }; if (opts?.remote) delete c.dirty; else c.dirty = true; return c; }
  private clean<T extends { dirty?: boolean }>(v: T): T { if (v.dirty) return v; const { dirty: _d, ...rest } = v; return rest as T; }

  async getAudioSession(id: string) { const a = await this.db.get('audioSessions', id); return a && this.clean(a); }
  async putAudioSession(a: AudioSession, opts?: WriteOpts) { await this.db.put('audioSessions', this.mark(a, opts)); }

  async putChunk(meta: AudioChunk, data: Blob) {
    const buf = await data.arrayBuffer();
    const tx = this.db.transaction(['chunks', 'chunkData'], 'readwrite');
    tx.objectStore('chunks').put(meta);
    tx.objectStore('chunkData').put({ id: meta.id, sessionId: meta.sessionId, mimeType: meta.mimeType, data: buf });
    await tx.done;
  }
  async updateChunk(meta: AudioChunk) { await this.db.put('chunks', meta); }
  async listChunks(sessionId: string) { return (await this.db.getAllFromIndex('chunks', 'bySession', sessionId)).sort((a, b) => a.sequence - b.sequence); }
  async getChunkBlob(id: string) { const d = await this.db.get('chunkData', id); return d ? new Blob([d.data], { type: d.mimeType }) : undefined; }
  async deleteAudio(sessionId: string) { await this.deleteBySession(sessionId, ['chunks', 'chunkData']); }
  async audioUsage() {
    const out: Record<string, number> = {};
    let cursor = await this.db.transaction('chunks').store.openCursor();
    while (cursor) { out[cursor.value.sessionId] = (out[cursor.value.sessionId] ?? 0) + cursor.value.size; cursor = await cursor.continue(); }
    return out;
  }

  async putSegments(segs: TranscriptSegment[], opts?: WriteOpts) {
    const tx = this.db.transaction('segments', 'readwrite');
    segs.forEach((s) => tx.store.put(this.mark(s, opts)));
    await tx.done;
  }
  async listSegments(sessionId: string) { return (await this.db.getAllFromIndex('segments', 'bySession', sessionId)).sort((a, b) => a.startMs - b.startMs).map((x) => this.clean(x)); }
  async listAllSegments() { return (await this.db.getAll('segments')).map((x) => this.clean(x)); }

  async putMarker(m: TimelineMarker, opts?: WriteOpts) {
    const tx = this.db.transaction(['markers', 'tombstones'], 'readwrite');
    tx.objectStore('markers').put(this.mark(m, opts));
    tx.objectStore('tombstones').delete(`timeline_markers:${m.id}`);
    await tx.done;
  }
  async deleteMarker(id: string, opts?: WriteOpts) {
    const tx = this.db.transaction(['markers', 'tombstones'], 'readwrite');
    const prev = await tx.objectStore('markers').get(id);
    await tx.objectStore('markers').delete(id);
    const key = `timeline_markers:${id}`;
    if (opts?.remote) await tx.objectStore('tombstones').delete(key);
    else if (prev) await tx.objectStore('tombstones').put({ key, table: 'timeline_markers', id, deletedAt: new Date().toISOString() });
    await tx.done;
  }
  async listMarkers(sessionId: string) { return (await this.db.getAllFromIndex('markers', 'bySession', sessionId)).sort((a, b) => a.atMs - b.atMs).map((x) => this.clean(x)); }

  async putAnchors(a: NoteAnchor[], opts?: WriteOpts) {
    const tx = this.db.transaction('anchors', 'readwrite');
    a.forEach((x) => tx.store.put(this.mark(x, opts)));
    await tx.done;
  }
  async listAnchors(sessionId: string) { return (await this.db.getAllFromIndex('anchors', 'bySession', sessionId)).sort((a, b) => a.timestamp - b.timestamp).map((x) => this.clean(x)); }

  async putInterruption(i: Interruption, opts?: WriteOpts) { await this.db.put('interruptions', this.mark(i, opts)); }
  async listInterruptions(sessionId: string) { return (await this.db.getAllFromIndex('interruptions', 'bySession', sessionId)).sort((a, b) => a.atMs - b.atMs).map((x) => this.clean(x)); }

  async listDirty(): Promise<CaptureDirty> {
    const [audioSessions, segments, markers, anchors, interruptions, tombstones] = await Promise.all([
      this.db.getAll('audioSessions'), this.db.getAll('segments'), this.db.getAll('markers'), this.db.getAll('anchors'), this.db.getAll('interruptions'), this.db.getAll('tombstones'),
    ]);
    const d = <T extends { dirty?: boolean }>(l: T[]) => l.filter((x) => x.dirty);
    return { audioSessions: d(audioSessions), segments: d(segments), markers: d(markers), anchors: d(anchors), interruptions: d(interruptions), tombstones };
  }
  async markSynced(table: CaptureTable, ids: string[]) {
    const name = STORE_FOR[table];
    const tx = this.db.transaction(name, 'readwrite');
    for (const id of ids) {
      const row = (await tx.store.get(id)) as { dirty?: boolean } | undefined;
      if (row) { delete row.dirty; await (tx.store as unknown as { put(v: unknown): Promise<unknown> }).put(row); }
    }
    await tx.done;
  }
  async dropTombstone(key: string) { await this.db.delete('tombstones', key); }
  getMeta<T>(key: string) { return this.db.get('meta', key) as Promise<T | undefined>; }
  async setMeta(key: string, value: unknown) { await this.db.put('meta', value, key); }

  private async deleteBySession(sessionId: string, stores: StoreName[]) {
    const tx = this.db.transaction(stores as 'chunks'[], 'readwrite');
    for (const name of stores) {
      const idx = tx.objectStore(name as 'chunks').index('bySession');
      let c = await idx.openKeyCursor(IDBKeyRange.only(sessionId));
      while (c) { tx.objectStore(name as 'chunks').delete(c.primaryKey); c = await c.continue(); }
    }
    await tx.done;
  }
  async deleteSession(sessionId: string) {
    await this.deleteBySession(sessionId, SESSION_STORES);
    await this.db.delete('audioSessions', sessionId);
  }

  async exportSession(sessionId: string): Promise<CaptureExport> {
    const [audioSession, segments, markers, anchors, interruptions, chunks] = await Promise.all([
      this.getAudioSession(sessionId), this.listSegments(sessionId), this.listMarkers(sessionId), this.listAnchors(sessionId), this.listInterruptions(sessionId), this.listChunks(sessionId),
    ]);
    return { sessionId, audioSession, segments, markers, anchors, interruptions, chunks };
  }
  async clearAll() {
    const names: StoreName[] = ['audioSessions', ...SESSION_STORES, 'tombstones', 'meta'];
    const tx = this.db.transaction(names as 'chunks'[], 'readwrite');
    await Promise.all([...names.map((n) => tx.objectStore(n as 'chunks').clear()), tx.done]);
  }
  close() { this.db.close(); }
}
