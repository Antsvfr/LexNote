import type { AudioChunk, AudioSession, Interruption, NoteAnchor, TimelineMarker, TranscriptSegment } from '@/domain/capture';
import type { CaptureDirty, CaptureExport, CaptureStorage, CaptureTable, CaptureTombstone, WriteOpts } from './types';

const clone = <T>(v: T): T => structuredClone(v);

/** Stockage en mémoire : tests, et repli (non persistant) si IndexedDB est indisponible. */
export class MemoryCaptureStorage implements CaptureStorage {
  readonly kind = 'memory' as const;
  constructor(readonly persistent = false) {}

  /** Test : simule un quota saturé. */
  failChunkWrites = false;

  private audio = new Map<string, AudioSession>();
  private chunks = new Map<string, AudioChunk>();
  private blobs = new Map<string, Blob>();
  private segments = new Map<string, TranscriptSegment>();
  private markers = new Map<string, TimelineMarker>();
  private anchors = new Map<string, NoteAnchor>();
  private interruptions = new Map<string, Interruption>();
  private tombstones = new Map<string, CaptureTombstone>();
  private meta = new Map<string, unknown>();

  private put<T extends { id: string; dirty?: boolean }>(m: Map<string, T>, v: T, opts?: WriteOpts) {
    m.set(v.id, clone(opts?.remote ? { ...v, dirty: undefined } : { ...v, dirty: true }));
  }
  private clean<T extends { dirty?: boolean }>(v: T): T { const c = clone(v); if (!c.dirty) delete c.dirty; return c; }

  async getAudioSession(id: string) { const a = this.audio.get(id); return a && this.clean(a); }
  async putAudioSession(a: AudioSession, opts?: WriteOpts) { this.put(this.audio, a, opts); }

  async putChunk(meta: AudioChunk, data: Blob) {
    if (this.failChunkWrites) throw new DOMException('quota', 'QuotaExceededError');
    this.chunks.set(meta.id, clone(meta));
    this.blobs.set(meta.id, data);
  }
  async updateChunk(meta: AudioChunk) { this.chunks.set(meta.id, clone(meta)); }
  async listChunks(sessionId: string) {
    return [...this.chunks.values()].filter((c) => c.sessionId === sessionId).sort((a, b) => a.sequence - b.sequence).map(clone);
  }
  async getChunkBlob(id: string) { return this.blobs.get(id); }
  async deleteAudio(sessionId: string) {
    for (const c of [...this.chunks.values()]) if (c.sessionId === sessionId) { this.chunks.delete(c.id); this.blobs.delete(c.id); }
  }
  async audioUsage() {
    const out: Record<string, number> = {};
    for (const c of this.chunks.values()) out[c.sessionId] = (out[c.sessionId] ?? 0) + c.size;
    return out;
  }

  async putSegments(segs: TranscriptSegment[], opts?: WriteOpts) { segs.forEach((s) => this.put(this.segments, s, opts)); }
  async listSegments(sessionId: string) {
    return [...this.segments.values()].filter((s) => s.sessionId === sessionId).sort((a, b) => a.startMs - b.startMs).map((x) => this.clean(x));
  }
  async listAllSegments() { return [...this.segments.values()].map((x) => this.clean(x)); }

  async putMarker(m: TimelineMarker, opts?: WriteOpts) { this.put(this.markers, m, opts); this.tombstones.delete(`timeline_markers:${m.id}`); }
  async deleteMarker(id: string, opts?: WriteOpts) {
    const prev = this.markers.get(id);
    this.markers.delete(id);
    if (opts?.remote) { this.tombstones.delete(`timeline_markers:${id}`); return; }
    // Pierre tombale systématique : supprimer côté serveur une ligne qui n'existe pas est sans effet.
    if (prev) this.tombstones.set(`timeline_markers:${id}`, { key: `timeline_markers:${id}`, table: 'timeline_markers', id, deletedAt: new Date().toISOString() });
  }
  async listMarkers(sessionId: string) {
    return [...this.markers.values()].filter((m) => m.sessionId === sessionId).sort((a, b) => a.atMs - b.atMs).map((x) => this.clean(x));
  }

  async putAnchors(a: NoteAnchor[], opts?: WriteOpts) { a.forEach((x) => this.put(this.anchors, x, opts)); }
  async listAnchors(sessionId: string) {
    return [...this.anchors.values()].filter((a) => a.sessionId === sessionId).sort((a, b) => a.timestamp - b.timestamp).map((x) => this.clean(x));
  }

  async putInterruption(i: Interruption, opts?: WriteOpts) { this.put(this.interruptions, i, opts); }
  async listInterruptions(sessionId: string) {
    return [...this.interruptions.values()].filter((i) => i.sessionId === sessionId).sort((a, b) => a.atMs - b.atMs).map((x) => this.clean(x));
  }

  async listDirty(): Promise<CaptureDirty> {
    const d = <T extends { dirty?: boolean }>(m: Map<string, T>) => [...m.values()].filter((x) => x.dirty).map(clone);
    return { audioSessions: d(this.audio), segments: d(this.segments), markers: d(this.markers), anchors: d(this.anchors), interruptions: d(this.interruptions), tombstones: clone([...this.tombstones.values()]) };
  }
  async markSynced(table: CaptureTable, ids: string[]) {
    const m = ({ transcript_sessions: this.audio, transcript_segments: this.segments, timeline_markers: this.markers, note_anchors: this.anchors, capture_interruptions: this.interruptions } as Record<CaptureTable, Map<string, { dirty?: boolean }>>)[table];
    ids.forEach((id) => { const r = m.get(id); if (r) delete r.dirty; });
  }
  async dropTombstone(key: string) { this.tombstones.delete(key); }
  async getMeta<T>(key: string) { return this.meta.get(key) as T | undefined; }
  async setMeta(key: string, value: unknown) { this.meta.set(key, value); }

  async deleteSession(sessionId: string) {
    this.audio.delete(sessionId);
    await this.deleteAudio(sessionId);
    for (const m of [this.segments, this.markers, this.anchors, this.interruptions] as Map<string, { sessionId: string }>[]) {
      for (const [k, v] of [...m]) if (v.sessionId === sessionId) m.delete(k);
    }
  }
  async exportSession(sessionId: string): Promise<CaptureExport> {
    return {
      sessionId, audioSession: await this.getAudioSession(sessionId),
      segments: await this.listSegments(sessionId), markers: await this.listMarkers(sessionId),
      anchors: await this.listAnchors(sessionId), interruptions: await this.listInterruptions(sessionId), chunks: await this.listChunks(sessionId),
    };
  }
  async clearAll() { [this.audio, this.chunks, this.blobs, this.segments, this.markers, this.anchors, this.interruptions, this.tombstones, this.meta].forEach((m) => (m as Map<string, unknown>).clear()); }
  close() { /* rien à fermer */ }
}
