/**
 * Modèle de capture d'un CM : audio, transcription, marqueurs, ancrages notes↔transcription.
 *
 * Horloge : tous les temps `*Ms` sont des millisecondes depuis `AudioSession.originAt`
 * (instant du tout premier démarrage de capture du CM). C'est une horloge « murale » :
 * les pauses et interruptions apparaissent donc naturellement comme des trous.
 */
import type { Provenance, VerificationStatus } from './legal';

export type TranscriptionStatus =
  | 'INACTIVE'
  | 'REQUESTING_PERMISSION'
  | 'STARTING'
  | 'RECORDING'
  | 'PAUSED'
  | 'PROCESSING'
  | 'ERROR'
  | 'COMPLETED';

export const STATUS_LABELS: Record<TranscriptionStatus, string> = {
  INACTIVE: 'Inactive',
  REQUESTING_PERMISSION: 'Autorisation du micro…',
  STARTING: 'Démarrage…',
  RECORDING: 'Enregistrement',
  PAUSED: 'En pause',
  PROCESSING: 'Finalisation…',
  ERROR: 'Interrompue',
  COMPLETED: 'Terminée',
};

export type RunEndReason = 'user' | 'pause' | 'interrupted';

/** Portion continue d'enregistrement. Une pause ou une interruption la termine ; la reprise en ouvre une nouvelle. */
export interface RecordingRun {
  id: string;
  startMs: number;
  endMs: number | null;
  endReason: RunEndReason | null;
}

export interface AudioSession {
  /** = id du CM (une seule AudioSession par CM). */
  id: string;
  sessionId: string;
  /** Epoch ms du premier démarrage. */
  originAt: number;
  mimeType: string;
  bitsPerSecond: number;
  chunkMs: number;
  /** L'audio est-il conservé (sinon : transcription seule, aucun chunk stocké). */
  keepAudio: boolean;
  providerId: string | null;
  runs: RecordingRun[];
  status: TranscriptionStatus;
  createdAt: string;
  updatedAt: string;
}

/** stored = écrit ; failed = écriture impossible ; corrupt = vide/illisible ; discarded = volontairement non conservé (keepAudio désactivé). */
export type ChunkStatus = 'stored' | 'failed' | 'corrupt' | 'discarded';
export type ChunkTranscriptionState = 'none' | 'pending' | 'done' | 'failed';

export interface AudioChunk {
  id: string;
  sessionId: string;
  sequence: number;
  runId: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  mimeType: string;
  size: number;
  createdAt: string;
  status: ChunkStatus;
  transcription: ChunkTranscriptionState;
}

export interface TranscriptSegment {
  id: string;
  sessionId: string;
  startMs: number;
  endMs: number;
  text: string;
  /** Absent si le moteur ne la fournit pas. */
  confidence?: number;
  provider: string;
  status: 'final' | 'edited';
  /** Toujours 'TRANSCRIPTION' : le moteur a entendu cela, rien de plus. */
  source: Extract<Provenance, 'TRANSCRIPTION'>;
  /** Toujours 'UNVERIFIED' à la création, même si le texte cite « l'article 1128 ». */
  verification: Extract<VerificationStatus, 'UNVERIFIED'>;
  chunkId?: string;
  createdAt: string;
}

export type MarkerReason = 'exam' | 'important' | 'review' | 'example';
export const MARKER_REASONS: { id: MarkerReason; label: string }[] = [
  { id: 'exam', label: 'Examen' },
  { id: 'important', label: 'Important' },
  { id: 'review', label: 'À revoir' },
  { id: 'example', label: 'Exemple' },
];

export interface TimelineMarker {
  id: string;
  sessionId: string;
  atMs: number;
  reasons: MarkerReason[];
  note?: string;
  createdAt: string;
}

export type InterruptionKind =
  | 'permission'
  | 'device'
  | 'recorder'
  | 'provider'
  | 'storage'
  | 'system-sleep'
  | 'app-closed'
  | 'network'
  | 'unknown';

export interface Interruption {
  id: string;
  sessionId: string;
  atMs: number;
  kind: InterruptionKind;
  message: string;
  /** La capture a-t-elle pu continuer malgré tout (ex. moteur HS mais audio OK) ? */
  recoverable: boolean;
  resolvedAtMs?: number;
}

/** Lien métadonnée « mes notes ↔ ce que disait le professeur ». Jamais écrit dans le texte des notes. */
export interface NoteAnchor {
  id: string;
  sessionId: string;
  /** Instant d'écriture (ms CM). */
  timestamp: number;
  /** Position ProseMirror au moment de l'écriture (peut dériver si le texte avant est modifié). */
  notePosition: number;
  /** Début du paragraphe concerné, pour pouvoir relocaliser l'ancre si la position dérive. */
  textSnippet: string;
  nearbyTranscriptSegmentIds: string[];
  createdAt: string;
}

/** Résumé stocké sur le CM (base des notes) : affichage rapide sans ouvrir la base de capture. */
export interface CaptureSummary {
  audioMs: number;
  transcriptWords: number;
  segmentCount: number;
  markerCount: number;
  interruptionCount: number;
  hasAudio: boolean;
  updatedAt: string;
}

/* ---------- utilitaires purs ---------- */

/** Durée enregistrée = somme des runs (le run ouvert compte jusqu'à `nowMs`). */
export function recordedMs(runs: RecordingRun[], nowMs: number): number {
  return runs.reduce((n, r) => n + Math.max(0, (r.endMs ?? nowMs) - r.startMs), 0);
}

/** Index du premier segment dont startMs >= t (segments triés par startMs). */
function lowerBound(segs: Pick<TranscriptSegment, 'startMs'>[], t: number): number {
  let lo = 0, hi = segs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((segs[mid]?.startMs ?? 0) < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Segments « autour » de t. Un segment est proche s'il chevauche [t-before, t+after].
 * `before` est large : un segment final n'apparaît qu'après avoir été prononcé.
 */
export function nearbySegmentIds(
  segs: Pick<TranscriptSegment, 'id' | 'startMs' | 'endMs'>[],
  t: number,
  before = 20_000,
  after = 5_000,
): string[] {
  const from = t - before, to = t + after;
  const out: string[] = [];
  // Les segments sont courts (< 60 s) : on recule d'une marge avant de filtrer.
  for (let i = Math.max(0, lowerBound(segs, from - 60_000)); i < segs.length; i++) {
    const s = segs[i]!;
    if (s.startMs > to) break;
    if (s.endMs >= from) out.push(s.id);
  }
  return out;
}

export function segmentAt<T extends Pick<TranscriptSegment, 'startMs' | 'endMs'>>(segs: T[], t: number): T | undefined {
  const i = lowerBound(segs, t + 1) - 1;
  const s = segs[i];
  return s && t <= s.endMs + 1500 ? s : undefined;
}

/** Insère en conservant l'ordre par startMs (cas courant : ajout en fin). */
export function insertSorted<T extends { startMs: number }>(list: T[], item: T): T[] {
  const last = list[list.length - 1];
  if (!last || last.startMs <= item.startMs) return [...list, item];
  const i = lowerBound(list, item.startMs);
  return [...list.slice(0, i), item, ...list.slice(i)];
}

export function segmentsWordCount(segs: Pick<TranscriptSegment, 'text'>[]): number {
  return segs.reduce((n, s) => n + (s.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0), 0);
}

/** `HH:MM:SS` depuis une durée en ms. */
export function formatHMS(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Heure murale (HH:MM:SS) d'un instant du CM. */
export function wallClock(originAt: number, ms: number): string {
  return new Date(originAt + ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} Ko`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 100 * 1024 * 1024 ? 1 : 0)} Mo`;
  return `${(n / 1024 ** 3).toFixed(2)} Go`;
}
