import type { AudioChunk } from '@/domain/capture';
import type { CaptureStorage } from './storage/types';

export interface PlayerState {
  playing: boolean;
  /** Position dans le temps du CM. */
  positionMs: number;
  available: boolean;
}

/**
 * Lecteur minimal sur les segments audio : « -10 s / ▶ / +10 s ».
 * Lit les segments les uns après les autres ; une seule URL objet vit à la fois.
 */
export class ChunkPlayer {
  private audio: HTMLAudioElement | null = null;
  private chunks: AudioChunk[] = [];
  private idx = -1;
  private url: string | null = null;
  private pos = 0;
  private listeners = new Set<(s: PlayerState) => void>();
  private token = 0;

  constructor(private storage: CaptureStorage, private sessionId: string, private makeAudio: () => HTMLAudioElement = () => new Audio()) {}

  subscribe(fn: (s: PlayerState) => void) { this.listeners.add(fn); fn(this.state); return () => { this.listeners.delete(fn); }; }
  get state(): PlayerState {
    return { playing: !!this.audio && !this.audio.paused, positionMs: this.pos, available: this.chunks.length > 0 };
  }
  private emit() { const s = this.state; this.listeners.forEach((l) => l(s)); }

  async load() {
    this.chunks = (await this.storage.listChunks(this.sessionId)).filter((c) => c.status === 'stored');
    this.emit();
    return this.chunks.length > 0;
  }

  /** Index du segment qui contient `ms`, sinon le premier qui suit. */
  indexFor(ms: number): number {
    const i = this.chunks.findIndex((c) => ms < c.endMs);
    return i === -1 ? this.chunks.length - 1 : i;
  }

  async playFrom(ms: number): Promise<void> {
    if (!this.chunks.length) return;
    const my = ++this.token;
    const i = this.indexFor(Math.max(0, ms));
    await this.loadChunk(i, Math.max(0, ms - this.chunks[i]!.startMs) / 1000, my);
  }

  private async loadChunk(i: number, offsetSec: number, token: number): Promise<void> {
    const chunk = this.chunks[i];
    if (!chunk) { this.pause(); return; }
    const blob = await this.storage.getChunkBlob(chunk.id);
    if (token !== this.token) return;
    if (!blob || blob.size === 0) { // segment illisible : on passe au suivant
      return this.loadChunk(i + 1, 0, token);
    }
    this.audio ??= this.makeAudio();
    const a = this.audio;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    this.idx = i;
    a.onended = () => { void this.loadChunk(this.idx + 1, 0, this.token); };
    a.ontimeupdate = () => { this.pos = chunk.startMs + a.currentTime * 1000; this.emit(); };
    a.onpause = () => this.emit();
    a.onplay = () => this.emit();
    a.onerror = () => { void this.loadChunk(this.idx + 1, 0, this.token); }; // segment corrompu
    a.src = this.url;
    const start = () => {
      try { a.currentTime = offsetSec; } catch { /* sera ignoré : lecture depuis le début du segment */ }
      void a.play().then(() => this.emit()).catch(() => this.emit());
    };
    if (a.readyState >= 1) start(); else a.addEventListener('loadedmetadata', start, { once: true });
    this.pos = chunk.startMs + offsetSec * 1000;
    this.emit();
  }

  toggle() {
    if (!this.audio) return;
    if (this.audio.paused) void this.audio.play(); else this.audio.pause();
  }
  pause() { this.audio?.pause(); this.emit(); }
  async seekBy(deltaMs: number) {
    const target = Math.max(0, this.pos + deltaMs);
    await this.playFrom(target);
  }

  dispose() {
    this.token++;
    this.audio?.pause();
    if (this.audio) { this.audio.removeAttribute('src'); this.audio.onended = this.audio.ontimeupdate = this.audio.onerror = null; }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null; this.audio = null; this.listeners.clear();
  }
}
