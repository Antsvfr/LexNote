import type { AudioChunk, AudioSession, Interruption, NoteAnchor, TimelineMarker, TranscriptSegment } from '@/domain/capture';
import type { CaptureExport, CaptureStorage } from './types';

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

  async getAudioSession(id: string) { const a = this.audio.get(id); return a && clone(a); }
  async putAudioSession(a: AudioSession) { this.audio.set(a.id, clone(a)); }

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

  async putSegments(segs: TranscriptSegment[]) { segs.forEach((s) => this.segments.set(s.id, clone(s))); }
  async listSegments(sessionId: string) {
    return [...this.segments.values()].filter((s) => s.sessionId === sessionId).sort((a, b) => a.startMs - b.startMs).map(clone);
  }
  async listAllSegments() { return [...this.segments.values()].map(clone); }

  async putMarker(m: TimelineMarker) { this.markers.set(m.id, clone(m)); }
  async deleteMarker(id: string) { this.markers.delete(id); }
  async listMarkers(sessionId: string) {
    return [...this.markers.values()].filter((m) => m.sessionId === sessionId).sort((a, b) => a.atMs - b.atMs).map(clone);
  }

  async putAnchors(a: NoteAnchor[]) { a.forEach((x) => this.anchors.set(x.id, clone(x))); }
  async listAnchors(sessionId: string) {
    return [...this.anchors.values()].filter((a) => a.sessionId === sessionId).sort((a, b) => a.timestamp - b.timestamp).map(clone);
  }

  async putInterruption(i: Interruption) { this.interruptions.set(i.id, clone(i)); }
  async listInterruptions(sessionId: string) {
    return [...this.interruptions.values()].filter((i) => i.sessionId === sessionId).sort((a, b) => a.atMs - b.atMs).map(clone);
  }

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
      anchors: await this.listAnchors(sessionId), interruptions: await this.listInterruptions(sessionId),
      chunks: await this.listChunks(sessionId),
    };
  }
  async clearAll() {
    [this.audio, this.chunks, this.blobs, this.segments, this.markers, this.anchors, this.interruptions].forEach((m) => m.clear());
  }
}
