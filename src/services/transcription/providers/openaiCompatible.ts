import { loadEngineSettings } from '../settings';
import type {
  AudioChunkInput, ProviderAvailability, ProviderContext, ProviderStatus, TranscriptionProvider,
} from '../types';

/** Extension de fichier attendue par les API pour un type MIME audio. */
export function extensionFor(mime: string): string {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4') || mime.includes('aac')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

interface VerboseResponse {
  text?: string;
  segments?: { start: number; end: number; text: string; avg_logprob?: number; no_speech_prob?: number }[];
}

/**
 * Moteur « API compatible OpenAI /audio/transcriptions ».
 * Fonctionne avec : l'API Whisper d'OpenAI (clé requise) OU un serveur Whisper LOCAL
 * (whisper.cpp server, faster-whisper-server, LocalAI…) — dans ce cas rien ne quitte votre Mac.
 *
 * Aucune clé n'est fournie ni codée en dur : elle est saisie par l'utilisateur (Réglages) et ne vit que
 * dans le localStorage de cet appareil.
 */
export class OpenAICompatibleProvider implements TranscriptionProvider {
  readonly id = 'openai-compatible';
  readonly label = 'Whisper (API compatible OpenAI)';
  readonly mode = 'chunk' as const;
  readonly privacy = 'configurable' as const;

  private ctx!: ProviderContext;
  private state: ProviderStatus['state'] = 'idle';
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private aborter = new AbortController();

  privacyNote() {
    const { baseUrl } = loadEngineSettings();
    let host = baseUrl;
    try { host = new URL(baseUrl).host; } catch { /* URL invalide : affichée telle quelle */ }
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
    return local
      ? `Serveur local (${host}) : l’audio ne quitte pas votre appareil.`
      : `L’audio est envoyé à ${host || 'le serveur configuré'} pour être transcrit.`;
  }

  availability(): ProviderAvailability {
    const s = loadEngineSettings();
    if (!s.baseUrl) return { available: false, reason: 'Non configuré : indiquez l’adresse d’une API Whisper (Réglages › Transcription).' };
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(s.baseUrl);
    if (!local && !s.apiKey) return { available: false, reason: 'Clé d’API manquante (Réglages › Transcription).' };
    return { available: true };
  }

  async initialize(ctx: ProviderContext) {
    this.ctx = ctx;
    this.aborter = new AbortController();
    this.state = 'ready';
  }
  async start() { this.state = 'running'; }
  async pause() { this.state = 'paused'; }
  async resume() { this.state = 'running'; }

  /** Les chunks sont traités un par un, dans l'ordre, sans jamais bloquer l'enregistrement. */
  processAudioChunk(chunk: AudioChunkInput): Promise<void> {
    this.pending++;
    const job = this.queue.then(() => this.transcribe(chunk)).finally(() => { this.pending--; });
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async transcribe(chunk: AudioChunkInput) {
    const s = loadEngineSettings();
    const form = new FormData();
    form.append('file', chunk.blob, `chunk-${chunk.id}.${extensionFor(chunk.mimeType)}`);
    form.append('model', s.model);
    form.append('language', this.ctx.language.split('-')[0] ?? 'fr');
    form.append('response_format', 'verbose_json');
    const headers: Record<string, string> = {};
    if (s.apiKey) headers.Authorization = `Bearer ${s.apiKey}`;

    const res = await fetch(`${s.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
      method: 'POST', body: form, headers, signal: this.aborter.signal,
    });
    if (!res.ok) throw new Error(`Le serveur de transcription a répondu ${res.status}.`);
    const json = (await res.json()) as VerboseResponse;

    const base = chunk.startMs;
    const segs = json.segments?.length
      ? json.segments
      : json.text?.trim() ? [{ start: 0, end: (chunk.endMs - chunk.startMs) / 1000, text: json.text }] : [];
    for (const seg of segs) {
      const text = seg.text.trim();
      if (!text) continue;
      this.ctx.onSegment({
        startMs: base + Math.round(seg.start * 1000),
        endMs: base + Math.round(seg.end * 1000),
        text,
        // avg_logprob (≤ 0) → pseudo-confiance (0..1), seulement si fournie.
        confidence: typeof seg.avg_logprob === 'number' ? Math.max(0, Math.min(1, Math.exp(seg.avg_logprob))) : undefined,
      });
    }
  }

  async stop() {
    await this.queue; // laisse finir les chunks en cours
    this.state = 'idle';
  }
  dispose() { this.aborter.abort(); this.state = 'disposed'; }
  getStatus(): ProviderStatus { return { state: this.state, pending: this.pending }; }
}
