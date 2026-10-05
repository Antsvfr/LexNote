/**
 * Enregistrement audio par SEGMENTS indépendants.
 *
 * Pourquoi pas un `MediaRecorder` avec `timeslice` ? Les fragments d'un même flux ne sont pas lisibles
 * isolément (seul le premier porte l'en-tête) : impossible de les réécouter ou de les envoyer à un moteur STT
 * un par un. Ici, un nouveau `MediaRecorder` est démarré toutes les `chunkMs` AVANT d'arrêter le précédent
 * (chevauchement de quelques ms, aucun trou) : chaque segment est un fichier complet et autonome.
 *
 * Durée par défaut : 30 s.
 *  - fenêtre native de Whisper (30 s) ;
 *  - perte maximale en cas de crash du navigateur : un seul segment en cours (≤ 30 s) ;
 *  - ≈ 120 Ko par segment à 32 kbit/s Opus : ~360 segments pour 3 h, écritures IndexedDB légères.
 */
export const DEFAULT_CHUNK_MS = 30_000;
export const DEFAULT_BITS_PER_SECOND = 32_000;

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus', // Chrome, Edge, Firefox
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2', // Safari
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

export function pickMimeType(isSupported: (t: string) => boolean): string | undefined {
  return MIME_CANDIDATES.find((t) => { try { return isSupported(t); } catch { return false; } });
}

export interface RecordedChunk {
  blob: Blob;
  /** Epoch ms. */
  startAt: number;
  endAt: number;
}

export interface RecorderHandlers {
  onChunk(chunk: RecordedChunk): void;
  /** Arrêt inattendu du recorder (périphérique perdu, erreur interne…). */
  onFatal(message: string): void;
}

export interface RecorderConfig {
  MediaRecorderCtor: typeof MediaRecorder;
  mimeType: string;
  bitsPerSecond: number;
  chunkMs: number;
  now: () => number;
}

interface Active {
  rec: MediaRecorder;
  startAt: number;
  parts: Blob[];
  /** Arrêt demandé par nous (rotation ou stop) — sinon c'est une interruption. */
  expected: boolean;
  done: Promise<void>;
  resolveDone: () => void;
}

export class ChunkedRecorder {
  private current: Active | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(private stream: MediaStream, private cfg: RecorderConfig, private h: RecorderHandlers) {}

  start() {
    this.stopped = false;
    this.begin();
  }

  private begin() {
    const { MediaRecorderCtor, mimeType, bitsPerSecond, now, chunkMs } = this.cfg;
    const rec = new MediaRecorderCtor(this.stream, { mimeType, audioBitsPerSecond: bitsPerSecond });
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => { resolveDone = r; });
    const active: Active = { rec, startAt: now(), parts: [], expected: false, done, resolveDone };

    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) active.parts.push(e.data); };
    rec.onerror = () => { if (!active.expected) this.h.onFatal('Erreur du MediaRecorder.'); };
    rec.onstop = () => {
      const blob = new Blob(active.parts, { type: mimeType });
      this.h.onChunk({ blob, startAt: active.startAt, endAt: now() });
      active.resolveDone();
      if (!active.expected && !this.stopped && this.current === active) {
        this.current = null;
        clearTimeout(this.timer);
        this.h.onFatal('L’enregistrement s’est arrêté de lui-même (micro déconnecté ou ressource retirée).');
      }
    };
    rec.start();
    this.current = active;
    this.timer = setTimeout(() => this.rotate(), chunkMs);
  }

  private rotate() {
    const old = this.current;
    if (!old || this.stopped) return;
    try {
      this.begin(); // le nouveau démarre avant l'arrêt de l'ancien : pas de trou
    } catch (err) {
      this.h.onFatal(`Impossible de poursuivre l’enregistrement : ${(err as Error).message}`);
      return;
    }
    old.expected = true;
    try { old.rec.stop(); } catch { old.resolveDone(); }
  }

  /** Arrête et attend que le dernier segment soit émis. */
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    const cur = this.current;
    this.current = null;
    if (!cur) return;
    cur.expected = true;
    try {
      if (cur.rec.state !== 'inactive') cur.rec.stop(); else cur.resolveDone();
    } catch { cur.resolveDone(); }
    await Promise.race([cur.done, new Promise<void>((r) => setTimeout(r, 4000))]);
  }

  get state(): RecordingState {
    return this.current?.rec.state ?? 'inactive';
  }
}
type RecordingState = 'inactive' | 'recording' | 'paused';
