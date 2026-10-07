import { PROVIDERS, resolveProvider } from '@/services/transcription';
import { loadEngineSettings } from '@/services/transcription/settings';
import { TranscriptIndex } from '@/services/search/transcriptSearch';
import { insertSorted, type MarkerReason, type NoteAnchor, type TimelineMarker } from '@/domain/capture';
import { captureSet, initialCapture, useCapture } from '@/store/capture';
import { onLibraryWiped, onSessionsRemoved, useLibrary } from '@/store/library';
import { toast } from '@/store/toasts';
import { CaptureController, type CaptureDeps, type CaptureEvent } from './controller';
import { estimateStorage } from './quota';
import { ChunkPlayer } from './playback';
import { createCaptureStorage, type CaptureStorage } from './storage';
import { enqueueCaptureCloud } from '@/services/sync/captureCloud';

export const FLUSH_ANCHORS_EVENT = 'lexnote:flush-anchors';

/**
 * Point d'entrée UNIQUE de l'UI vers la capture. Vit hors de React.
 * Un contrôleur par CM ouvert ; au plus une capture active à la fois.
 */
class CaptureManager {
  private storage: CaptureStorage | null = null;
  private controllers = new Map<string, CaptureController>();
  private unsubs = new Map<string, () => void>();
  readonly index = new TranscriptIndex();
  private player: ChunkPlayer | null = null;
  private lastSummaryAt = 0;
  private hooksInstalled = false;

  async init(storage?: CaptureStorage) {
    if (this.storage && this.storage !== storage) await this.reset();
    this.storage = storage ?? (await createCaptureStorage());
    if (!this.hooksInstalled) {
      this.hooksInstalled = true;
      onSessionsRemoved((ids) => this.removeSessions(ids));
      onLibraryWiped(async () => {
        for (const c of this.controllers.values()) c.dispose();
        this.controllers.clear();
        await this.storage?.clearAll();
        this.index.clear();
        captureSet({ ...initialCapture });
      });
      window.addEventListener('beforeunload', (e) => {
        if (this.activeController()) { e.preventDefault(); }
      });
    }
  }

  async reset() {
    for (const c of this.controllers.values()) {
      try {
        if (c.isActive) await c.stop();
      } catch {
        // Déconnexion : on privilégie l'isolement du compte, même si le micro s'est déjà interrompu.
      }
      c.dispose();
    }
    this.controllers.clear();
    for (const off of this.unsubs.values()) off();
    this.unsubs.clear();
    await this.player?.dispose();
    this.player = null;
    this.storage = null;
    this.index.clear();
    captureSet({ ...initialCapture });
  }
  getStorage(): CaptureStorage {
    if (!this.storage) throw new Error('Stockage de capture non initialisé');
    return this.storage;
  }
  get persistent() { return this.storage?.persistent ?? false; }

  private deps(): CaptureDeps {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    return {
      storage: this.getStorage(),
      getUserMedia: (c) => {
        if (!md?.getUserMedia) return Promise.reject(new DOMException('API micro indisponible (contexte non sécurisé ?)', 'NotFoundError'));
        return md.getUserMedia(c);
      },
      MediaRecorderCtor: typeof MediaRecorder !== 'undefined' ? MediaRecorder : undefined,
      isTypeSupported: typeof MediaRecorder !== 'undefined' ? (t) => MediaRecorder.isTypeSupported(t) : undefined,
      now: () => Date.now(),
      estimate: estimateStorage,
      providerFactory: () => resolveProvider(),
      settings: loadEngineSettings,
      chunkMs: loadEngineSettings().chunkMs,
      wakeLock: (navigator as Navigator & { wakeLock?: CaptureDeps['wakeLock'] }).wakeLock,
    };
  }

  activeController(): CaptureController | null {
    for (const c of this.controllers.values()) if (c.isActive) return c;
    return null;
  }
  controllerFor(sessionId: string) { return this.controllers.get(sessionId) ?? null; }

  /** Ouvre le CM : charge ce qui a été capturé (transcription, marqueurs, audio…) sans toucher au micro. */
  async open(sessionId: string, focusMs: number | null = null) {
    let c = this.controllers.get(sessionId);
    captureSet({ ...initialCapture, viewSessionId: sessionId, loaded: false, focusMs, active: useCapture.getState().active });
    if (!c) {
      c = new CaptureController(sessionId, this.deps());
      this.controllers.set(sessionId, c);
      this.unsubs.set(sessionId, c.subscribe((e) => this.onEvent(sessionId, e)));
      try { await c.load(); } catch (err) { console.error('[LexNote] chargement de la capture', err); }
    }
    this.syncView(c);
    await this.player?.dispose();
    this.player = null;
    // Les transcriptions d'un CM ouvert alimentent la recherche.
    void this.index.ensure(() => this.getStorage().listAllSegments()).catch(() => undefined);
    return c;
  }

  private syncView(c: CaptureController) {
    if (useCapture.getState().viewSessionId !== c.sessionId) return;
    const p = resolveProvider();
    captureSet({
      loaded: true, status: c.status, error: c.error, audio: c.audio ? structuredClone(c.audio) : null,
      segments: c.segments, markers: c.markers, interruptions: c.interruptions, chunks: c.chunks,
      failedChunks: c.chunks.filter((x) => x.transcription === 'failed').length,
      audioStopped: c.audioStopped, providerLabel: p?.label ?? null, providerPrivacy: p?.privacyNote() ?? null,
    });
  }

  private onEvent(sessionId: string, e: CaptureEvent) {
    const c = this.controllers.get(sessionId)!;
    const viewing = useCapture.getState().viewSessionId === sessionId;
    switch (e.type) {
      case 'status': {
        const active = c.isActive || e.status === 'PAUSED' || e.status === 'ERROR'
          ? { sessionId, status: e.status, audio: c.audio ?? null } : null;
        captureSet(active || useCapture.getState().active?.sessionId === sessionId ? { active } : {});
        if (viewing) captureSet({ status: e.status, error: e.error, audioStopped: c.audioStopped });
        if (e.status === 'RECORDING' && viewing) this.syncView(c);
        if (['PAUSED', 'COMPLETED', 'ERROR'].includes(e.status)) this.persistSummary(sessionId, true);
        break;
      }
      case 'segment':
        enqueueCaptureCloud({ kind: 'segment', data: e.segment });
        this.index.add(e.segment);
        if (viewing) captureSet((s) => ({ segments: insertSorted(s.segments, e.segment) }));
        break;
      case 'interim': if (viewing) captureSet({ interim: e.text }); break;
      case 'marker':
        enqueueCaptureCloud({ kind: 'marker', data: e.marker });
        if (viewing) captureSet((s) => ({
          markers: s.markers.some((m) => m.id === e.marker.id) ? s.markers.map((m) => (m.id === e.marker.id ? e.marker : m)) : insertByAt(s.markers, e.marker),
          lastMarkerId: s.markers.some((m) => m.id === e.marker.id) ? s.lastMarkerId : e.marker.id,
        }));
        break;
      case 'markerRemoved': if (viewing) captureSet((s) => ({ markers: s.markers.filter((m) => m.id !== e.id) })); break;
      case 'interruption':
        enqueueCaptureCloud({ kind: 'interruption', data: e.interruption });
        if (viewing) captureSet((s) => ({
          interruptions: s.interruptions.some((i) => i.id === e.interruption.id)
            ? s.interruptions.map((i) => (i.id === e.interruption.id ? e.interruption : i)) : [...s.interruptions, e.interruption],
        }));
        break;
      case 'chunk':
        if (viewing) captureSet((s) => ({ chunks: [...s.chunks.filter((x) => x.id !== e.chunk.id), e.chunk], failedChunks: c.chunks.filter((x) => x.transcription === 'failed').length }));
        break;
      case 'audioSession': {
        enqueueCaptureCloud({ kind: 'audio', data: e.audioSession });
        if (viewing) captureSet({ audio: e.audioSession });
        const act = useCapture.getState().active;
        if (act?.sessionId === sessionId) captureSet({ active: { ...act, audio: e.audioSession } });
        break;
      }
      case 'storage': if (viewing) captureSet({ storage: e.info, audioStopped: e.audioStopped }); break;
      case 'summary': this.persistSummary(sessionId, false); break;
    }
  }

  /** Résumé de capture copié sur le CM (base des notes) — espacé pour ne rien alourdir. */
  private persistSummary(sessionId: string, force: boolean) {
    const now = Date.now();
    if (!force && now - this.lastSummaryAt < 10_000) return;
    this.lastSummaryAt = now;
    const c = this.controllers.get(sessionId);
    if (!c) return;
    void useLibrary.getState().setCaptureSummary(sessionId, c.summary()).catch(() => undefined);
  }

  /* ---------- actions UI ---------- */
  private async ensureController(sessionId: string) {
    return this.controllers.get(sessionId) ?? (await this.open(sessionId));
  }

  async start(sessionId: string) {
    const other = this.activeController();
    if (other && other.sessionId !== sessionId) {
      toast.error('Une transcription est déjà en cours dans un autre CM. Arrêtez-la d’abord.');
      return;
    }
    const c = await this.ensureController(sessionId);
    if (c.status === 'PAUSED' || c.status === 'ERROR' || (c.status === 'COMPLETED' && c.audio)) await c.resume();
    else await c.start();
  }
  /** Avant pause/arrêt : les ancrages en attente (pause d'écriture pas encore atteinte) sont enregistrés. */
  private flushAnchors() { window.dispatchEvent(new Event(FLUSH_ANCHORS_EVENT)); }
  async pause(sessionId: string) { this.flushAnchors(); await this.controllers.get(sessionId)?.pause(); }
  async resume(sessionId: string) { await this.controllers.get(sessionId)?.resume(); }
  async stop(sessionId: string) { this.flushAnchors(); await this.controllers.get(sessionId)?.stop(); }
  mark(sessionId: string): TimelineMarker | null { return this.controllers.get(sessionId)?.mark() ?? null; }
  updateMarker(sessionId: string, id: string, patch: { reasons?: MarkerReason[]; note?: string }) { this.controllers.get(sessionId)?.updateMarker(id, patch); }
  removeMarker(sessionId: string, id: string) { this.controllers.get(sessionId)?.removeMarker(id); }
  recordAnchor(sessionId: string, input: { notePosition: number; textSnippet: string; at?: number }): NoteAnchor | null {
    const anchor = this.controllers.get(sessionId)?.recordAnchor(input) ?? null;
    if (anchor) enqueueCaptureCloud({ kind: 'anchor', data: anchor });
    return anchor;
  }
  async retryFailed(sessionId: string) { return (await this.controllers.get(sessionId)?.retryFailedChunks()) ?? 0; }

  /* ---------- lecture ---------- */
  async getPlayer(sessionId: string): Promise<ChunkPlayer> {
    if (this.player) return this.player;
    this.player = new ChunkPlayer(this.getStorage(), sessionId);
    await this.player.load();
    return this.player;
  }
  refreshPlayer() { this.player?.dispose(); this.player = null; }

  /* ---------- données ---------- */
  async removeSessions(ids: string[]) {
    for (const id of ids) {
      const c = this.controllers.get(id);
      if (c) { c.dispose(); this.controllers.delete(id); this.unsubs.get(id)?.(); this.unsubs.delete(id); }
      await this.getStorage().deleteSession(id);
      this.index.removeSession(id);
    }
    const v = useCapture.getState();
    if (v.viewSessionId && ids.includes(v.viewSessionId)) captureSet({ ...initialCapture });
    if (v.active && ids.includes(v.active.sessionId)) captureSet({ active: null });
  }
  async deleteAudio(sessionId: string) {
    await this.getStorage().deleteAudio(sessionId);
    const c = this.controllers.get(sessionId);
    if (c) { c.chunks = []; this.syncView(c); }
    this.refreshPlayer();
    const c2 = this.controllers.get(sessionId);
    if (c2) void useLibrary.getState().setCaptureSummary(sessionId, { ...c2.summary(), hasAudio: false, audioMs: 0 });
  }
  async exportAll() {
    const ids = useLibrary.getState().sessions.map((s) => s.id);
    const out = [];
    for (const id of ids) {
      const ex = await this.getStorage().exportSession(id);
      if (ex.audioSession || ex.segments.length || ex.markers.length) out.push(ex);
    }
    return out;
  }
  async searchTranscripts(query: string) {
    await this.index.ensure(() => this.getStorage().listAllSegments());
    return this.index.search(query);
  }
  providers() { return PROVIDERS; }
}

const insertByAt = (list: TimelineMarker[], m: TimelineMarker) => [...list, m].sort((a, b) => a.atMs - b.atMs);

export const captureManager = new CaptureManager();
