/** Doubles de test pour la capture (MediaRecorder, micro, moteur). Utilisés uniquement par les tests. */
import type { ProviderContext, ProviderStatus, TranscriptionProvider, AudioChunkInput, ProviderMode } from '@/services/transcription/types';
import { DEFAULT_ENGINE_SETTINGS, type EngineSettings } from '@/services/transcription/settings';
import { CaptureController, type CaptureDeps } from './controller';
import { MemoryCaptureStorage } from './storage/memory';
import type { StorageInfo } from './quota';

export class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  onended: (() => void) | null = null;
  stop() { this.readyState = 'ended'; }
  /** Simule un débranchement. */
  unplug() { this.readyState = 'ended'; this.onended?.(); }
}
export class FakeStream {
  tracks = [new FakeTrack()];
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
}

export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (t: string) => t.startsWith('audio/webm');
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  emptyOnStop = false;
  constructor(public stream: unknown, public opts: unknown) { FakeMediaRecorder.instances.push(this); }
  start() { this.state = 'recording'; }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(this.emptyOnStop ? [] : [new Uint8Array(1000)]) });
      this.onstop?.();
    });
  }
  /** Simule un arrêt spontané (périphérique perdu). */
  crash() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array(10)]) }); this.onstop?.(); }); }
}

export class FakeProvider implements TranscriptionProvider {
  id = 'fake'; label = 'Fake'; privacy = 'local' as const;
  state: ProviderStatus['state'] = 'idle';
  ctx!: ProviderContext;
  chunks: AudioChunkInput[] = [];
  failTimes = 0;
  failInit = false;
  constructor(public mode: ProviderMode = 'live') {}
  privacyNote() { return 'test'; }
  availability() { return { available: true }; }
  async initialize(ctx: ProviderContext) { if (this.failInit) throw new Error('init impossible'); this.ctx = ctx; this.state = 'ready'; }
  async start() { this.state = 'running'; }
  async processAudioChunk(c: AudioChunkInput) {
    if (this.failTimes > 0) { this.failTimes--; throw new Error('503'); }
    this.chunks.push(c);
    this.ctx.onSegment({ startMs: c.startMs, endMs: c.endMs, text: `texte du chunk ${this.chunks.length}` });
  }
  async pause() { this.state = 'paused'; }
  async resume() { this.state = 'running'; }
  async stop() { this.state = 'idle'; }
  dispose() { this.state = 'disposed'; }
  getStatus(): ProviderStatus { return { state: this.state }; }
  /** Le professeur parle. */
  say(text: string, startMs: number, endMs: number, confidence?: number) { this.ctx.onSegment({ startMs, endMs, text, confidence }); }
}

export interface Rig {
  controller: CaptureController;
  storage: MemoryCaptureStorage;
  provider: FakeProvider | null;
  streams: FakeStream[];
  getUserMedia: ReturnType<typeof import('vitest').vi.fn>;
  info: { current: StorageInfo };
}

export function okStorageInfo(): StorageInfo {
  return { usage: 10e6, quota: 10e9, free: 10e9 - 10e6, level: 'ok', persisted: true };
}

export async function makeRig(vi: typeof import('vitest').vi, opts: {
  provider?: FakeProvider | null; settings?: Partial<EngineSettings>; storage?: MemoryCaptureStorage;
  getUserMediaError?: string; chunkMs?: number; sessionId?: string;
} = {}): Promise<Rig> {
  FakeMediaRecorder.instances = [];
  const storage = opts.storage ?? new MemoryCaptureStorage(true);
  const streams: FakeStream[] = [];
  const info = { current: okStorageInfo() };
  const getUserMedia = vi.fn(async () => {
    if (opts.getUserMediaError) throw new DOMException('refus', opts.getUserMediaError);
    const s = new FakeStream(); streams.push(s); return s as unknown as MediaStream;
  });
  const provider = opts.provider === undefined ? new FakeProvider('live') : opts.provider;
  const deps: CaptureDeps = {
    storage, getUserMedia: getUserMedia as unknown as CaptureDeps['getUserMedia'],
    MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
    isTypeSupported: FakeMediaRecorder.isTypeSupported,
    now: () => Date.now(), estimate: async () => info.current,
    providerFactory: () => provider, settings: () => ({ ...DEFAULT_ENGINE_SETTINGS, ...opts.settings }),
    chunkMs: opts.chunkMs ?? 30_000, retryDelaysMs: [10, 20],
  };
  const controller = new CaptureController(opts.sessionId ?? 'cm1', deps);
  await controller.load();
  return { controller, storage, provider, streams, getUserMedia, info };
}
