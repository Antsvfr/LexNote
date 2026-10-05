import type {
  AudioChunkInput, ProviderAvailability, ProviderContext, ProviderStatus, TranscriptionProvider,
} from '../types';

/* Types minimaux de l'API (absents de lib.dom). */
interface SRAlternative { transcript: string; confidence: number }
interface SRResult { isFinal: boolean; length: number; [i: number]: SRAlternative }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRErrorEvent { error: string; message?: string }
interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SRCtor = (new () => SpeechRecognitionLike) & {
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
};

function getCtor(): SRCtor | undefined {
  const w = globalThis as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Erreurs après lesquelles il est inutile de relancer. */
const FATAL = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported']);
const MAX_RAPID_RESTARTS = 5;

/**
 * Moteur « Web Speech API » : live, sans clé, sans configuration.
 *
 * ⚠ Confidentialité : sur Chrome, l'audio est envoyé aux serveurs du navigateur (Google) pour être transcrit,
 * sauf reconnaissance sur l'appareil (`processLocally`) lorsque le navigateur l'expose pour la langue. Sur Safari,
 * Apple. Firefox n'implémente pas l'API. Aucune garantie de continuité : le navigateur coupe la session
 * régulièrement ; ce provider la relance automatiquement.
 */
export class WebSpeechProvider implements TranscriptionProvider {
  readonly id = 'webspeech';
  readonly label = 'Reconnaissance vocale du navigateur';
  readonly mode = 'live' as const;
  readonly privacy = 'cloud' as const;

  private ctx!: ProviderContext;
  private rec: SpeechRecognitionLike | null = null;
  private state: ProviderStatus['state'] = 'idle';
  private wanted = false;
  private local = false;
  private utteranceStart: number | null = null;
  private lastStart = 0;
  private rapidRestarts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private stopResolvers: (() => void)[] = [];
  private onlineHandler = () => { if (this.wanted && this.state === 'error') this.spawn(); };

  privacyNote() {
    return this.local
      ? 'Reconnaissance sur l’appareil (le navigateur annonce un traitement local).'
      : 'Le navigateur peut envoyer l’audio à ses serveurs (Google sur Chrome, Apple sur Safari) pour le transcrire.';
  }

  availability(): ProviderAvailability {
    return getCtor() ? { available: true } : { available: false, reason: 'Ce navigateur n’implémente pas la reconnaissance vocale (ex. Firefox).' };
  }

  async initialize(ctx: ProviderContext) {
    this.ctx = ctx;
    const Ctor = getCtor();
    if (!Ctor) throw new Error('Reconnaissance vocale indisponible dans ce navigateur.');
    // Chrome récent : reconnaissance sur l'appareil si le modèle de la langue est déjà installé.
    try {
      const st = await Ctor.available?.({ langs: [ctx.language], processLocally: true });
      this.local = st === 'available';
    } catch { this.local = false; }
    this.state = 'ready';
  }

  async start() {
    this.wanted = true;
    this.rapidRestarts = 0;
    globalThis.addEventListener?.('online', this.onlineHandler);
    this.spawn();
  }

  private spawn() {
    const Ctor = getCtor();
    if (!Ctor || !this.wanted) return;
    const rec = new Ctor();
    rec.lang = this.ctx.language;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    if (this.local) rec.processLocally = true;

    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const alt = res[0];
        if (!alt) continue;
        const text = alt.transcript.trim();
        if (this.utteranceStart === null && text) this.utteranceStart = this.ctx.now();
        if (res.isFinal) {
          if (text) {
            const end = this.ctx.now();
            this.ctx.onSegment({
              startMs: Math.min(this.utteranceStart ?? end, end), endMs: end, text,
              // Web Speech renvoie parfois 0 quand la confiance est inconnue : on l'omet alors.
              confidence: alt.confidence > 0 ? alt.confidence : undefined,
            });
          }
          this.utteranceStart = null;
          this.ctx.onInterim('');
        } else {
          this.ctx.onInterim(text);
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // normal
      if (e.error === 'network') {
        this.state = 'error';
        this.ctx.onError({ kind: 'network', recoverable: true, message: 'Connexion perdue : la transcription reprendra au retour du réseau. L’audio continue d’être enregistré.' });
        return;
      }
      if (FATAL.has(e.error)) {
        this.wanted = false;
        this.state = 'error';
        this.ctx.onError({ kind: e.error === 'not-allowed' ? 'permission' : 'provider', recoverable: false, message: `Reconnaissance vocale refusée (${e.error}).` });
        return;
      }
      this.ctx.onError({ kind: 'provider', recoverable: true, message: `Erreur du moteur de reconnaissance (${e.error}).` });
    };
    rec.onend = () => {
      this.rec = null;
      if (this.state === 'error' && this.wanted) return; // on attend le retour réseau
      if (!this.wanted) { this.resolveStop(); return; }
      // Le navigateur coupe régulièrement la session : on relance, avec garde-fou anti-boucle.
      const now = Date.now();
      this.rapidRestarts = now - this.lastStart < 1500 ? this.rapidRestarts + 1 : 0;
      if (this.rapidRestarts > MAX_RAPID_RESTARTS) {
        this.wanted = false;
        this.state = 'error';
        this.ctx.onError({ kind: 'provider', recoverable: false, message: 'Le moteur de reconnaissance s’arrête en boucle.' });
        return;
      }
      this.restartTimer = setTimeout(() => this.spawn(), 250);
    };

    this.rec = rec;
    this.lastStart = Date.now();
    try {
      rec.start();
      this.state = 'running';
    } catch (err) {
      this.state = 'error';
      this.ctx.onError({ kind: 'provider', recoverable: true, message: `Démarrage impossible : ${(err as Error).message}` });
    }
  }

  async processAudioChunk(_chunk: AudioChunkInput) { /* mode live : ignoré */ }

  async pause() {
    this.wanted = false;
    clearTimeout(this.restartTimer);
    this.state = 'paused';
    await this.halt();
  }
  async resume() {
    this.wanted = true;
    this.rapidRestarts = 0;
    this.spawn();
  }
  async stop() {
    this.wanted = false;
    clearTimeout(this.restartTimer);
    globalThis.removeEventListener?.('online', this.onlineHandler);
    await this.halt();
    this.state = 'idle';
  }
  /** `stop()` (et non abort) : le navigateur finalise le dernier énoncé avant `onend`. Timeout de sécurité. */
  private halt(): Promise<void> {
    const rec = this.rec;
    if (!rec) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 2500);
      this.stopResolvers.push(() => { clearTimeout(t); resolve(); });
      try { rec.stop(); } catch { resolve(); }
    });
  }
  private resolveStop() {
    const rs = this.stopResolvers.splice(0);
    rs.forEach((r) => r());
  }
  dispose() {
    this.wanted = false;
    clearTimeout(this.restartTimer);
    globalThis.removeEventListener?.('online', this.onlineHandler);
    try { this.rec?.abort(); } catch { /* déjà arrêté */ }
    this.rec = null;
    this.state = 'disposed';
  }
  getStatus(): ProviderStatus { return { state: this.state }; }
}
