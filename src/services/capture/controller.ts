import {
  nearbySegmentIds, recordedMs, insertSorted, segmentsWordCount,
  type AudioChunk, type AudioSession, type CaptureSummary, type Interruption, type InterruptionKind, type MarkerReason,
  type NoteAnchor, type TimelineMarker, type TranscriptionStatus, type TranscriptSegment,
} from '@/domain/capture';
import { newId } from '@/lib/ids';
import type { ProviderContext, ProviderError, SegmentDraft, TranscriptionProvider } from '@/services/transcription/types';
import type { EngineSettings } from '@/services/transcription/settings';
import { ChunkedRecorder, DEFAULT_BITS_PER_SECOND, DEFAULT_CHUNK_MS, pickMimeType, type RecordedChunk } from './recorder';
import type { StorageInfo } from './quota';
import type { CaptureStorage } from './storage/types';

export interface CaptureDeps {
  /** Propriétaire des données capturées. */
  userId?: string;
  storage: CaptureStorage;
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorderCtor?: typeof MediaRecorder;
  isTypeSupported?: (t: string) => boolean;
  /** Epoch ms. */
  now: () => number;
  estimate: () => Promise<StorageInfo>;
  providerFactory: () => TranscriptionProvider | null;
  settings: () => EngineSettings;
  chunkMs?: number;
  /** Écart entre deux ticks du watchdog au-delà duquel on suppose une mise en veille. */
  sleepGapMs?: number;
  retryDelaysMs?: number[];
  wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
}

export type CaptureEvent =
  | { type: 'status'; status: TranscriptionStatus; error: CaptureError | null }
  | { type: 'segment'; segment: TranscriptSegment }
  | { type: 'interim'; text: string }
  | { type: 'marker'; marker: TimelineMarker }
  | { type: 'markerRemoved'; id: string }
  | { type: 'interruption'; interruption: Interruption }
  | { type: 'chunk'; chunk: AudioChunk }
  | { type: 'audioSession'; audioSession: AudioSession }
  | { type: 'storage'; info: StorageInfo; audioStopped: boolean }
  | { type: 'summary'; summary: CaptureSummary };

export interface CaptureError {
  kind: InterruptionKind;
  message: string;
  recoverable: boolean;
}

export interface LoadedCapture {
  audioSession?: AudioSession;
  segments: TranscriptSegment[];
  markers: TimelineMarker[];
  interruptions: Interruption[];
  chunks: AudioChunk[];
  anchors: NoteAnchor[];
}

const SEGMENT_FLUSH_MS = 1000;

/**
 * Orchestrateur de capture d'UN CM. Vit hors de React et hors de l'éditeur :
 * toute erreur ici est capturée et transformée en état `ERROR` + `Interruption` — jamais propagée aux notes.
 */
export class CaptureController {
  status: TranscriptionStatus = 'INACTIVE';
  error: CaptureError | null = null;
  audio: AudioSession | undefined;
  segments: TranscriptSegment[] = [];
  markers: TimelineMarker[] = [];
  interruptions: Interruption[] = [];
  chunks: AudioChunk[] = [];
  anchors: NoteAnchor[] = [];
  audioStopped = false;

  private listeners = new Set<(e: CaptureEvent) => void>();
  private stream: MediaStream | null = null;
  private recorder: ChunkedRecorder | null = null;
  private provider: TranscriptionProvider | null = null;
  private runId: string | null = null;
  private seq = 0;
  private segBuf: TranscriptSegment[] = [];
  private anchorBuf: NoteAnchor[] = [];
  private segTimer: ReturnType<typeof setInterval> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private lastTick = 0;
  private txQueue: Promise<void> = Promise.resolve();
  /** Segments audio en cours d'écriture/enregistrement : on les attend avant de clore un run. */
  private inflight = new Set<Promise<void>>();
  private txPending = 0;
  private openProviderInterruption: Interruption | null = null;
  private lock: { release(): Promise<void> } | null = null;
  private disposed = false;
  private failing = false;

  constructor(readonly sessionId: string, private deps: CaptureDeps) {}

  /* ---------- abonnement ---------- */
  subscribe(fn: (e: CaptureEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: CaptureEvent) { this.listeners.forEach((l) => { try { l(e); } catch (err) { console.error(err); } }); }
  private setStatus(status: TranscriptionStatus, error: CaptureError | null = null) {
    this.status = status;
    this.error = error;
    if (this.audio) this.audio.status = status;
    this.emit({ type: 'status', status, error });
  }

  /** Temps CM (ms depuis l'origine). */
  cmNow(): number { return this.audio ? this.deps.now() - this.audio.originAt : 0; }
  get isActive() { return ['REQUESTING_PERMISSION', 'STARTING', 'RECORDING', 'PROCESSING'].includes(this.status); }
  recordedMs(): number { return this.audio ? recordedMs(this.audio.runs, this.cmNow()) : 0; }
  get pendingTranscriptions() { return this.txPending; }

  /* ---------- chargement ---------- */
  async load(): Promise<LoadedCapture> {
    const s = this.deps.storage;
    const [audio, segments, markers, interruptions, chunks, anchors] = await Promise.all([
      s.getAudioSession(this.sessionId), s.listSegments(this.sessionId), s.listMarkers(this.sessionId),
      s.listInterruptions(this.sessionId), s.listChunks(this.sessionId), s.listAnchors(this.sessionId),
    ]);
    this.audio = audio; this.segments = segments; this.markers = markers;
    this.interruptions = interruptions; this.chunks = chunks; this.anchors = anchors;
    this.seq = chunks.reduce((m, c) => Math.max(m, c.sequence), 0);
    await this.recoverOrphanRun();
    if (this.audio) this.status = this.audio.status === 'COMPLETED' ? 'COMPLETED' : this.audio.runs.length ? 'PAUSED' : 'INACTIVE';
    return { audioSession: this.audio, segments, markers, interruptions, chunks, anchors };
  }

  /** L'application a été fermée/plantée en plein enregistrement : on referme le run au dernier chunk connu. */
  private async recoverOrphanRun() {
    const a = this.audio;
    const run = a?.runs[a.runs.length - 1];
    if (!a || !run || run.endMs !== null || this.isActive) return;
    const lastChunkEnd = this.chunks.filter((c) => c.runId === run.id).reduce((m, c) => Math.max(m, c.endMs), run.startMs);
    run.endMs = lastChunkEnd;
    run.endReason = 'interrupted';
    a.status = 'PAUSED';
    await this.addInterruption('app-closed', 'L’application a été fermée pendant l’enregistrement. Les segments déjà enregistrés sont conservés.', true, lastChunkEnd);
    await this.saveAudioSession();
  }

  /* ---------- cycle de vie ---------- */
  async start(): Promise<void> {
    if (this.disposed || this.isActive) return;
    if (this.status === 'RECORDING') return;
    this.setStatus('REQUESTING_PERMISSION');
    let stream: MediaStream;
    try {
      stream = await this.deps.getUserMedia({ audio: { channelCount: 1 } });
    } catch (err) {
      this.setStatus('ERROR', this.classifyMediaError(err));
      return;
    }
    if (this.disposed) { stream.getTracks().forEach((t) => t.stop()); return; }
    this.stream = stream;
    this.setStatus('STARTING');
    try {
      await this.beginRun();
    } catch (err) {
      console.error('[LexNote] démarrage de la capture', err);
      this.releaseHardware();
      this.setStatus('ERROR', { kind: 'unknown', message: `Démarrage impossible : ${(err as Error).message}`, recoverable: true });
    }
  }

  private async beginRun(existing?: TranscriptionProvider) {
    const { deps } = this;
    const settings = deps.settings();
    const now = deps.now();
    if (!this.audio) {
      const t = new Date(now).toISOString();
      this.audio = {
        id: this.sessionId, userId: this.deps.userId, sessionId: this.sessionId, originAt: now, mimeType: '', bitsPerSecond: DEFAULT_BITS_PER_SECOND,
        chunkMs: deps.chunkMs ?? DEFAULT_CHUNK_MS, keepAudio: settings.keepAudio, providerId: null, runs: [],
        status: 'STARTING', createdAt: t, updatedAt: t,
      };
    }
    const a = this.audio;
    a.keepAudio = settings.keepAudio;

    // Moteur : on le choisit avant l'audio, car un moteur « chunk » a besoin des segments audio.
    const provider = existing ?? deps.providerFactory();
    a.providerId = provider?.id ?? null;
    const needsChunks = a.keepAudio || provider?.mode === 'chunk';

    const mime = deps.MediaRecorderCtor && deps.isTypeSupported ? pickMimeType(deps.isTypeSupported) : undefined;
    const audioPossible = !!(deps.MediaRecorderCtor && mime);
    if (needsChunks && !audioPossible && provider?.mode === 'chunk') {
      throw new Error('Ce navigateur ne sait pas enregistrer l’audio (MediaRecorder).');
    }
    if (mime) a.mimeType = mime;

    const startMs = now - a.originAt;
    const run = { id: newId('run'), startMs, endMs: null, endReason: null };
    a.runs.push(run);
    this.runId = run.id;
    this.audioStopped = !(needsChunks && audioPossible);
    await this.saveAudioSession();

    // Moteur de transcription : un échec ici ne doit PAS empêcher l'enregistrement audio.
    this.provider = null;
    if (provider) {
      try {
        if (existing) {
          await provider.resume();
        } else {
          await provider.initialize(this.providerContext());
          await provider.start();
        }
        this.provider = provider;
      } catch (err) {
        provider.dispose();
        await this.addInterruption('provider', `Moteur de transcription indisponible : ${(err as Error).message}. L’audio est enregistré quand même.`, true);
      }
    }

    if (!this.audioStopped && this.stream) {
      this.recorder = new ChunkedRecorder(this.stream, {
        MediaRecorderCtor: deps.MediaRecorderCtor!, mimeType: mime!, bitsPerSecond: a.bitsPerSecond, chunkMs: a.chunkMs, now: deps.now,
      }, {
        onChunk: (c) => {
          const p = this.handleChunk(c, run.id).catch((e) => console.error('[LexNote] segment audio', e));
          this.inflight.add(p);
          void p.finally(() => this.inflight.delete(p));
        },
        onFatal: (m) => void this.fail('recorder', m, true),
      });
      this.recorder.start();
    }
    this.stream?.getAudioTracks().forEach((t) => {
      t.onended = () => void this.fail('device', 'Le microphone a été déconnecté ou retiré.', true);
    });

    this.startTimers();
    void this.acquireWakeLock();
    this.setStatus('RECORDING');
    void this.refreshStorage();
  }

  async pause(): Promise<void> {
    if (this.status !== 'RECORDING') return;
    await this.endRun('pause');
    try { await this.provider?.pause(); } catch (err) { console.warn('[LexNote] pause moteur', err); }
    this.releaseHardware();
    await this.flushSegments();
    this.setStatus('PAUSED');
    this.emitSummary();
  }

  /** Reprise après pause OU après interruption : nouveau run, micro ré-acquis. */
  async resume(): Promise<void> {
    if (this.status === 'RECORDING' || this.isActive) return;
    this.setStatus('REQUESTING_PERMISSION');
    let stream: MediaStream;
    try {
      stream = await this.deps.getUserMedia({ audio: { channelCount: 1 } });
    } catch (err) {
      this.setStatus('ERROR', this.classifyMediaError(err));
      return;
    }
    this.stream = stream;
    this.setStatus('STARTING');
    try {
      // Un moteur en pause saine est repris tel quel ; sinon on en recrée un (cf. beginRun).
      const healthy = this.provider?.getStatus().state === 'paused';
      if (healthy) {
        const keep = this.provider!;
        this.provider = null;
        await this.beginRun(keep);
      } else {
        this.provider?.dispose();
        this.provider = null;
        await this.beginRun();
      }
      this.resolveInterruptions();
    } catch (err) {
      this.releaseHardware();
      this.setStatus('ERROR', { kind: 'unknown', message: `Reprise impossible : ${(err as Error).message}`, recoverable: true });
    }
  }

  async stop(): Promise<void> {
    if (this.status === 'INACTIVE' || this.status === 'COMPLETED' || this.status === 'PROCESSING') return;
    this.setStatus('PROCESSING');
    try {
      await this.endRun('user');
      try { await this.provider?.stop(); } catch (err) { await this.addInterruption('provider', `Le moteur n’a pas pu finaliser : ${(err as Error).message}`, true); }
      // Laisse aboutir les chunks en cours de transcription (borné : on ne bloque jamais la fin du CM).
      await Promise.race([this.txQueue, new Promise<void>((r) => setTimeout(r, 60_000))]);
      await this.flushSegments();
      await this.flushAnchors(true);
    } catch (err) {
      console.error('[LexNote] arrêt de la capture', err);
    } finally {
      this.provider?.dispose();
      this.provider = null;
      this.releaseHardware();
      if (this.audio) { this.audio.status = 'COMPLETED'; await this.saveAudioSession(); }
      this.setStatus('COMPLETED');
      this.emitSummary();
    }
  }

  /** Marqueur instantané à l'instant courant. */
  mark(reasons: MarkerReason[] = [], note?: string): TimelineMarker | null {
    if (!this.audio || this.status !== 'RECORDING') return null;
    const marker: TimelineMarker = {
      id: newId('mk'), userId: this.deps.userId, sessionId: this.sessionId, atMs: this.cmNow(), reasons, note, createdAt: new Date(this.deps.now()).toISOString(),
    };
    this.markers = [...this.markers, marker].sort((a, b) => a.atMs - b.atMs);
    this.emit({ type: 'marker', marker });
    void this.deps.storage.putMarker(marker).catch((e) => console.error('[LexNote] marqueur non enregistré', e));
    this.emitSummary();
    return marker;
  }
  updateMarker(id: string, patch: { reasons?: MarkerReason[]; note?: string }) {
    const m = this.markers.find((x) => x.id === id);
    if (!m) return;
    const next = { ...m, ...patch };
    this.markers = this.markers.map((x) => (x.id === id ? next : x));
    this.emit({ type: 'marker', marker: next });
    void this.deps.storage.putMarker(next).catch((e) => console.error(e));
  }
  removeMarker(id: string) {
    this.markers = this.markers.filter((m) => m.id !== id);
    this.emit({ type: 'markerRemoved', id });
    void this.deps.storage.deleteMarker(id).catch((e) => console.error(e));
    this.emitSummary();
  }

  /** Ancrage note ↔ transcription (métadonnée uniquement). */
  recordAnchor(input: { notePosition: number; textSnippet: string; at?: number }): NoteAnchor | null {
    if (!this.audio || this.status !== 'RECORDING') return null;
    const ts = input.at !== undefined ? Math.max(0, input.at - this.audio.originAt) : this.cmNow();
    const anchor: NoteAnchor = {
      id: newId('an'), userId: this.deps.userId, sessionId: this.sessionId, timestamp: ts, notePosition: input.notePosition,
      textSnippet: input.textSnippet.slice(0, 120), nearbyTranscriptSegmentIds: nearbySegmentIds(this.segments, ts),
      createdAt: new Date(this.deps.now()).toISOString(),
    };
    this.anchors.push(anchor);
    this.anchorBuf.push(anchor);
    return anchor;
  }

  /** Relance la transcription des chunks audio dont le moteur avait échoué. */
  async retryFailedChunks(): Promise<number> {
    const provider = this.provider;
    if (!provider || provider.mode !== 'chunk') return 0;
    const failed = this.chunks.filter((c) => c.transcription === 'failed' || c.transcription === 'pending');
    for (const c of failed) {
      const blob = await this.deps.storage.getChunkBlob(c.id);
      if (blob) this.enqueueTranscription(c, blob);
    }
    return failed.length;
  }

  dispose() {
    this.disposed = true;
    this.stopTimers();
    this.provider?.dispose();
    this.releaseHardware();
    this.listeners.clear();
  }

  /* ---------- internes ---------- */
  private providerContext(): ProviderContext {
    return {
      sessionId: this.sessionId,
      language: this.deps.settings().language,
      now: () => this.cmNow(),
      onSegment: (d) => this.handleSegment(d),
      onInterim: (text) => this.emit({ type: 'interim', text }),
      onError: (e) => void this.handleProviderError(e),
    };
  }

  private handleSegment(d: SegmentDraft) {
    const text = d.text.trim();
    if (!text) return;
    const seg: TranscriptSegment = {
      id: newId('seg'), userId: this.deps.userId, sessionId: this.sessionId, startMs: d.startMs, endMs: Math.max(d.endMs, d.startMs), text,
      confidence: d.confidence, provider: this.provider?.id ?? this.audio?.providerId ?? 'unknown',
      status: 'final', source: 'TRANSCRIPTION', verification: 'UNVERIFIED', createdAt: new Date(this.deps.now()).toISOString(),
    };
    this.segments = insertSorted(this.segments, seg);
    this.segBuf.push(seg);
    this.resolveProviderInterruption();
    this.emit({ type: 'segment', segment: seg });
  }

  private async handleProviderError(e: ProviderError) {
    const kind: InterruptionKind = e.kind === 'network' ? 'network' : e.kind === 'permission' ? 'permission' : 'provider';
    if (this.openProviderInterruption) return; // déjà signalée, pas de doublon
    // L'audio continue : l'erreur du moteur ne coupe pas la capture.
    await this.addInterruption(kind, e.message, e.recoverable);
  }

  private async handleChunk(c: RecordedChunk, runId: string) {
    const a = this.audio;
    if (!a) return;
    const startMs = c.startAt - a.originAt, endMs = c.endAt - a.originAt;
    const meta: AudioChunk = {
      id: newId('chk'), sessionId: this.sessionId, sequence: ++this.seq, runId, startMs, endMs,
      durationMs: Math.max(0, endMs - startMs), mimeType: a.mimeType, size: c.blob.size, createdAt: new Date(this.deps.now()).toISOString(),
      status: 'stored', transcription: this.provider?.mode === 'chunk' ? 'pending' : 'none',
    };
    if (c.blob.size === 0) { // segment corrompu/vide : on garde la trace sans données
      meta.status = 'corrupt'; meta.transcription = 'none';
      this.chunks.push(meta);
      await this.deps.storage.updateChunk(meta).catch(() => undefined);
      this.emit({ type: 'chunk', chunk: meta });
      await this.addInterruption('recorder', 'Un segment audio est vide ou corrompu ; il est ignoré.', true, startMs);
      return;
    }

    let stored = false;
    if (!this.audioStopped && a.keepAudio) stored = await this.storeChunk(meta, c.blob);
    // keepAudio=false : le segment n'est transcrit qu'en mémoire puis oublié (aucune écriture audio).
    if (!a.keepAudio) meta.status = 'discarded';
    else if (!stored) meta.status = 'failed';
    this.chunks.push(meta);
    this.emit({ type: 'chunk', chunk: meta });
    if (this.provider?.mode === 'chunk') this.enqueueTranscription(meta, c.blob);
    void this.refreshStorage();
  }

  /** Écrit un segment audio ; en cas de stockage critique/saturé, on cesse de conserver l'audio (notes et texte continuent). */
  private async storeChunk(meta: AudioChunk, blob: Blob): Promise<boolean> {
    try {
      const info = await this.deps.estimate();
      if (info.level === 'critical') throw new DOMException('Stockage presque plein', 'QuotaExceededError');
      await this.deps.storage.putChunk(meta, blob);
      return true;
    } catch (err) {
      const full = (err as DOMException)?.name === 'QuotaExceededError';
      await this.stopAudio(full
        ? 'Stockage presque plein : l’audio n’est plus conservé. Vos notes et la transcription continuent. Libérez de l’espace (Réglages › Stockage audio).'
        : `Écriture audio impossible (${(err as Error).message}). Vos notes et la transcription continuent.`);
      meta.status = 'failed';
      return false;
    }
  }

  /** Cesse de conserver l'audio (stockage saturé) sans toucher à la transcription ni aux notes. */
  private async stopAudio(message: string) {
    if (this.audioStopped) return;
    this.audioStopped = true;
    const rec = this.recorder;
    this.recorder = null;
    await this.addInterruption('storage', message, true);
    void rec?.stop();
  }

  private enqueueTranscription(meta: AudioChunk, blob: Blob) {
    const provider = this.provider;
    if (!provider) return;
    this.txPending++;
    const delays = this.deps.retryDelaysMs ?? [1000, 4000];
    const job = async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
          await provider.processAudioChunk({ id: meta.id, startMs: meta.startMs, endMs: meta.endMs, blob, mimeType: meta.mimeType });
          meta.transcription = 'done';
          this.resolveProviderInterruption();
          await this.deps.storage.updateChunk(meta).catch(() => undefined);
          return;
        } catch (err) {
          lastErr = err;
          if (attempt < delays.length) await new Promise((r) => setTimeout(r, delays[attempt]));
        }
      }
      meta.transcription = 'failed';
      await this.deps.storage.updateChunk(meta).catch(() => undefined);
      if (!this.openProviderInterruption) {
        await this.addInterruption('provider', `Transcription impossible pour un segment : ${(lastErr as Error)?.message ?? 'erreur'}. L’audio est conservé, vous pourrez réessayer.`, true, meta.startMs);
      }
    };
    this.txQueue = this.txQueue.then(job).catch(() => undefined).finally(() => { this.txPending--; });
  }

  private async endRun(reason: 'user' | 'pause' | 'interrupted') {
    const a = this.audio;
    this.stopTimers();
    try { await this.recorder?.stop(); } catch (err) { console.warn('[LexNote] arrêt recorder', err); }
    this.recorder = null;
    await Promise.allSettled([...this.inflight]); // le dernier segment est écrit (et mis en file) avant de poursuivre
    const run = a?.runs.find((r) => r.id === this.runId);
    if (a && run && run.endMs === null) {
      run.endMs = Math.max(run.startMs, this.deps.now() - a.originAt);
      run.endReason = reason;
    }
    this.runId = null;
    await this.saveAudioSession();
    void this.releaseWakeLock();
  }

  /** Interruption (micro perdu, recorder tombé…) : on garde tout ce qui est valide et on passe en ERROR, prête à reprendre. */
  private async fail(kind: InterruptionKind, message: string, recoverable: boolean) {
    // Plusieurs signaux simultanés (recorder + micro) pour un même incident : une seule interruption.
    if (this.failing || !['RECORDING', 'STARTING'].includes(this.status)) return;
    this.failing = true;
    try {
      await this.addInterruption(kind, message, recoverable);
      await this.endRun('interrupted');
      try { await this.provider?.stop(); } catch { /* moteur déjà HS */ }
      this.provider?.dispose();
      this.provider = null;
      await this.flushSegments();
    } catch (err) {
      console.error('[LexNote] gestion d’interruption', err);
    } finally {
      this.failing = false;
      this.releaseHardware();
      this.setStatus('ERROR', { kind, message, recoverable });
      this.emitSummary();
    }
  }

  private classifyMediaError(err: unknown): CaptureError {
    const name = (err as DOMException)?.name ?? '';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      return { kind: 'permission', recoverable: false, message: 'Accès au microphone refusé. Autorisez-le dans les réglages du navigateur (icône à gauche de l’adresse), puis réessayez.' };
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return { kind: 'device', recoverable: true, message: 'Aucun microphone détecté. Branchez-en un puis réessayez.' };
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      return { kind: 'device', recoverable: true, message: 'Le microphone est utilisé par une autre application ou indisponible.' };
    }
    return { kind: 'unknown', recoverable: true, message: `Impossible d’accéder au microphone (${name || 'erreur inconnue'}).` };
  }

  private async addInterruption(kind: InterruptionKind, message: string, recoverable: boolean, atMs?: number) {
    if (!this.audio) return;
    const it: Interruption = { id: newId('int'), userId: this.deps.userId, sessionId: this.sessionId, atMs: atMs ?? this.cmNow(), kind, message, recoverable };
    this.interruptions = [...this.interruptions, it];
    if (kind === 'provider' || kind === 'network') this.openProviderInterruption = it;
    this.emit({ type: 'interruption', interruption: it });
    this.emitSummary();
    await this.deps.storage.putInterruption(it).catch((e) => console.error('[LexNote] interruption non enregistrée', e));
  }

  private resolveProviderInterruption() {
    const it = this.openProviderInterruption;
    if (!it) return;
    this.openProviderInterruption = null;
    const resolved = { ...it, resolvedAtMs: this.cmNow() };
    this.interruptions = this.interruptions.map((x) => (x.id === it.id ? resolved : x));
    this.emit({ type: 'interruption', interruption: resolved });
    void this.deps.storage.putInterruption(resolved).catch(() => undefined);
  }
  private resolveInterruptions() {
    // Les interruptions « reprenables » sont considérées résolues à la reprise.
    const t = this.cmNow();
    this.interruptions = this.interruptions.map((x) => {
      if (x.resolvedAtMs !== undefined || !x.recoverable) return x;
      const r = { ...x, resolvedAtMs: t };
      void this.deps.storage.putInterruption(r).catch(() => undefined);
      this.emit({ type: 'interruption', interruption: r });
      return r;
    });
  }

  private startTimers() {
    this.stopTimers();
    this.lastTick = this.deps.now();
    this.segTimer = setInterval(() => { void this.flushSegments(); void this.flushAnchors(false); }, SEGMENT_FLUSH_MS);
    this.watchdog = setInterval(() => this.tick(), 1000);
  }
  private stopTimers() {
    clearInterval(this.segTimer);
    clearInterval(this.watchdog);
    this.segTimer = this.watchdog = undefined;
  }

  /** Détecte la mise en veille (saut d'horloge) et un recorder tombé sans événement. */
  private tick() {
    const now = this.deps.now();
    const gap = now - this.lastTick;
    this.lastTick = now;
    if (this.status !== 'RECORDING') return;
    if (gap > (this.deps.sleepGapMs ?? 5000)) {
      const at = this.cmNow() - gap;
      const it: Interruption = {
        id: newId('int'), userId: this.deps.userId, sessionId: this.sessionId, atMs: at, kind: 'system-sleep', recoverable: true, resolvedAtMs: this.cmNow(),
        message: `Mise en veille détectée (~${Math.round(gap / 1000)} s sans enregistrement).`,
      };
      this.interruptions = [...this.interruptions, it];
      this.emit({ type: 'interruption', interruption: it });
      this.emitSummary();
      void this.deps.storage.putInterruption(it).catch(() => undefined);
    }
    if (this.recorder && this.recorder.state === 'inactive') void this.fail('recorder', 'L’enregistrement audio s’est arrêté.', true);
    const tracks = this.stream?.getAudioTracks() ?? [];
    if (this.stream && tracks.length && tracks.every((t) => t.readyState === 'ended')) void this.fail('device', 'Le microphone a été déconnecté.', true);
  }

  private async flushSegments() {
    if (!this.segBuf.length) return;
    const batch = this.segBuf.splice(0);
    try {
      await this.deps.storage.putSegments(batch);
    } catch (err) {
      this.segBuf.unshift(...batch); // on réessaiera : rien n'est perdu tant que la page vit
      console.error('[LexNote] segments non enregistrés', err);
    }
  }
  private async flushAnchors(refresh: boolean) {
    if (refresh) { // transcription complète : on recalcule les segments proches de chaque ancre
      this.anchors = this.anchors.map((a) => ({ ...a, nearbyTranscriptSegmentIds: nearbySegmentIds(this.segments, a.timestamp) }));
      this.anchorBuf = [...this.anchors];
    }
    if (!this.anchorBuf.length) return;
    const batch = this.anchorBuf.splice(0);
    try { await this.deps.storage.putAnchors(batch); } catch (err) { this.anchorBuf.unshift(...batch); console.error(err); }
  }

  private async saveAudioSession() {
    if (!this.audio) return;
    this.audio.updatedAt = new Date(this.deps.now()).toISOString();
    try {
      await this.deps.storage.putAudioSession(this.audio);
      this.emit({ type: 'audioSession', audioSession: structuredClone(this.audio) });
    } catch (err) { console.error('[LexNote] session audio non enregistrée', err); }
  }

  summary(): CaptureSummary {
    const stored = this.chunks.filter((c) => c.status === 'stored');
    const audioMs = stored.length ? stored.reduce((n, c) => n + c.durationMs, 0) : 0;
    return {
      audioMs, transcriptWords: segmentsWordCount(this.segments), segmentCount: this.segments.length,
      markerCount: this.markers.length, interruptionCount: this.interruptions.length,
      hasAudio: stored.length > 0, updatedAt: new Date(this.deps.now()).toISOString(),
    };
  }
  private emitSummary() { this.emit({ type: 'summary', summary: this.summary() }); }

  private async refreshStorage() {
    const info = await this.deps.estimate();
    this.emit({ type: 'storage', info, audioStopped: this.audioStopped });
    if (info.level === 'critical' && !this.audioStopped && this.status === 'RECORDING') {
      await this.stopAudio('Stockage presque plein : l’audio n’est plus conservé. Vos notes et la transcription continuent.');
      this.emit({ type: 'storage', info, audioStopped: this.audioStopped });
    }
  }

  private releaseHardware() {
    this.stream?.getTracks().forEach((t) => { t.onended = null; try { t.stop(); } catch { /* déjà arrêtée */ } });
    this.stream = null;
    void this.releaseWakeLock();
  }
  private async acquireWakeLock() {
    try { this.lock = (await this.deps.wakeLock?.request('screen')) ?? null; } catch { this.lock = null; }
  }
  private async releaseWakeLock() {
    const l = this.lock; this.lock = null;
    try { await l?.release(); } catch { /* déjà relâché */ }
  }
}

