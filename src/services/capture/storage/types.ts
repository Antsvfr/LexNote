import type {
  AudioChunk, AudioSession, Interruption, NoteAnchor, TimelineMarker, TranscriptSegment,
} from '@/domain/capture';

export interface CaptureExport {
  sessionId: string;
  audioSession?: AudioSession;
  segments: TranscriptSegment[];
  markers: TimelineMarker[];
  anchors: NoteAnchor[];
  interruptions: Interruption[];
  /** Les fichiers audio ne sont pas inclus dans l'export (volumineux) : seulement leurs métadonnées. */
  chunks: AudioChunk[];
}

/**
 * Stockage de la capture (audio, transcription, marqueurs…).
 * Volontairement SÉPARÉ du stockage des notes : base distincte, transactions distinctes.
 * Un quota saturé ou une panne ici ne peut pas faire échouer l'enregistrement des notes.
 */
export interface CaptureStorage {
  readonly kind: 'indexeddb' | 'memory';
  readonly persistent: boolean;

  getAudioSession(sessionId: string): Promise<AudioSession | undefined>;
  putAudioSession(a: AudioSession): Promise<void>;

  putChunk(meta: AudioChunk, data: Blob): Promise<void>;
  updateChunk(meta: AudioChunk): Promise<void>;
  listChunks(sessionId: string): Promise<AudioChunk[]>;
  getChunkBlob(chunkId: string): Promise<Blob | undefined>;
  /** Supprime l'audio d'un CM (blobs + métadonnées de chunks), garde la transcription. */
  deleteAudio(sessionId: string): Promise<void>;
  /** Octets d'audio par CM. */
  audioUsage(): Promise<Record<string, number>>;

  putSegments(segs: TranscriptSegment[]): Promise<void>;
  listSegments(sessionId: string): Promise<TranscriptSegment[]>;
  /** Tous les segments (id, session, temps, texte) — alimente la recherche globale. */
  listAllSegments(): Promise<TranscriptSegment[]>;

  putMarker(m: TimelineMarker): Promise<void>;
  deleteMarker(id: string): Promise<void>;
  listMarkers(sessionId: string): Promise<TimelineMarker[]>;

  putAnchors(a: NoteAnchor[]): Promise<void>;
  listAnchors(sessionId: string): Promise<NoteAnchor[]>;

  putInterruption(i: Interruption): Promise<void>;
  listInterruptions(sessionId: string): Promise<Interruption[]>;

  /** Supprime TOUT ce qui concerne un CM (audio, transcription, marqueurs, ancrages). */
  deleteSession(sessionId: string): Promise<void>;
  exportSession(sessionId: string): Promise<CaptureExport>;
  clearAll(): Promise<void>;
}
