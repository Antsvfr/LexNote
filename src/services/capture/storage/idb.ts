import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AudioChunk, AudioSession, Interruption, NoteAnchor, TimelineMarker, TranscriptSegment } from '@/domain/capture';
import type { CaptureExport, CaptureStorage } from './types';

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
}

export const CAPTURE_DB_NAME = 'lexnote-capture';
const VERSION = 1;
type StoreName = Exclude<keyof CaptureDB, never>;
const SESSION_STORES: StoreName[] = ['chunks', 'chunkData', 'segments', 'markers', 'anchors', 'interruptions'];

export class IndexedDbCaptureStorage implements CaptureStorage {
  readonly kind = 'indexeddb' as const;
  readonly persistent = true;
  private constructor(private db: IDBPDatabase<CaptureDB>) {}

  static async open(name = CAPTURE_DB_NAME): Promise<IndexedDbCaptureStorage> {
    const db = await openDB<CaptureDB>(name, VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('audioSessions', { keyPath: 'id' });
          for (const s of SESSION_STORES) {
            db.createObjectStore(s as 'chunks', { keyPath: 'id' }).createIndex('bySession', 'sessionId');
          }
        }
      },
    });
    db.addEventListener('versionchange', () => db.close());
    return new IndexedDbCaptureStorage(db);
  }

  getAudioSession(id: string) { return this.db.get('audioSessions', id); }
  async putAudioSession(a: AudioSession) { await this.db.put('audioSessions', a); }

  async putChunk(meta: AudioChunk, data: Blob) {
    const buf = await data.arrayBuffer();
    const tx = this.db.transaction(['chunks', 'chunkData'], 'readwrite');
    tx.objectStore('chunks').put(meta);
    tx.objectStore('chunkData').put({ id: meta.id, sessionId: meta.sessionId, mimeType: meta.mimeType, data: buf });
    await tx.done;
  }
  async updateChunk(meta: AudioChunk) { await this.db.put('chunks', meta); }
  async listChunks(sessionId: string) {
    const all = await this.db.getAllFromIndex('chunks', 'bySession', sessionId);
    return all.sort((a, b) => a.sequence - b.sequence);
  }
  async getChunkBlob(id: string) {
    const d = await this.db.get('chunkData', id);
    return d ? new Blob([d.data], { type: d.mimeType }) : undefined;
  }
  async deleteAudio(sessionId: string) {
    await this.deleteBySession(sessionId, ['chunks', 'chunkData']);
  }
  async audioUsage() {
    const out: Record<string, number> = {};
    let cursor = await this.db.transaction('chunks').store.openCursor();
    while (cursor) {
      out[cursor.value.sessionId] = (out[cursor.value.sessionId] ?? 0) + cursor.value.size;
      cursor = await cursor.continue();
    }
    return out;
  }

  async putSegments(segs: TranscriptSegment[]) {
    const tx = this.db.transaction('segments', 'readwrite');
    segs.forEach((s) => tx.store.put(s));
    await tx.done;
  }
  async listSegments(sessionId: string) {
    return (await this.db.getAllFromIndex('segments', 'bySession', sessionId)).sort((a, b) => a.startMs - b.startMs);
  }
  listAllSegments() { return this.db.getAll('segments'); }

  async putMarker(m: TimelineMarker) { await this.db.put('markers', m); }
  async deleteMarker(id: string) { await this.db.delete('markers', id); }
  async listMarkers(sessionId: string) {
    return (await this.db.getAllFromIndex('markers', 'bySession', sessionId)).sort((a, b) => a.atMs - b.atMs);
  }

  async putAnchors(a: NoteAnchor[]) {
    const tx = this.db.transaction('anchors', 'readwrite');
    a.forEach((x) => tx.store.put(x));
    await tx.done;
  }
  async listAnchors(sessionId: string) {
    return (await this.db.getAllFromIndex('anchors', 'bySession', sessionId)).sort((a, b) => a.timestamp - b.timestamp);
  }

  async putInterruption(i: Interruption) { await this.db.put('interruptions', i); }
  async listInterruptions(sessionId: string) {
    return (await this.db.getAllFromIndex('interruptions', 'bySession', sessionId)).sort((a, b) => a.atMs - b.atMs);
  }

  private async deleteBySession(sessionId: string, stores: StoreName[]) {
    const tx = this.db.transaction(stores as ('chunks')[], 'readwrite');
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
      this.getAudioSession(sessionId), this.listSegments(sessionId), this.listMarkers(sessionId),
      this.listAnchors(sessionId), this.listInterruptions(sessionId), this.listChunks(sessionId),
    ]);
    return { sessionId, audioSession, segments, markers, anchors, interruptions, chunks };
  }

  async clearAll() {
    const names: StoreName[] = ['audioSessions', ...SESSION_STORES];
    const tx = this.db.transaction(names as 'chunks'[], 'readwrite');
    await Promise.all([...names.map((n) => tx.objectStore(n as 'chunks').clear()), tx.done]);
  }
}
