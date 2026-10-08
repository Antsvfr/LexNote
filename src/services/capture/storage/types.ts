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

/** Tables de capture synchronisées avec le cloud (l'AUDIO, lui, reste local). */
export type CaptureTable = 'transcript_sessions' | 'transcript_segments' | 'timeline_markers' | 'note_anchors' | 'capture_interruptions';

export interface WriteOpts {
  /** Écriture issue du cloud : ni « à envoyer », ni pierre tombale. */
  remote?: boolean;
}

export interface CaptureTombstone { key: string; table: CaptureTable; id: string; deletedAt: string }

export interface CaptureDirty {
  audioSessions: AudioSession[];
  segments: TranscriptSegment[];
  markers: TimelineMarker[];
  anchors: NoteAnchor[];
  interruptions: Interruption[];
  tombstones: CaptureTombstone[];
}

/**
 * Stockage de la capture (audio, transcription, marqueurs…) d'UN utilisateur.
 * Volontairement SÉPARÉ du stockage des notes : base distincte, transactions distinctes.
 * Un quota saturé ou une panne ici ne peut pas faire échouer l'enregistrement des notes.
 */
export interface CaptureStorage {
  readonly kind: 'indexeddb' | 'memory';
  readonly persistent: boolean;

  getAudioSession(sessionId: string): Promise<AudioSession | undefined>;
  putAudioSession(a: AudioSession, opts?: WriteOpts): Promise<void>;

  putChunk(meta: AudioChunk, data: Blob): Promise<void>;
  updateChunk(meta: AudioChunk): Promise<void>;
  listChunks(sessionId: string): Promise<AudioChunk[]>;
  getChunkBlob(chunkId: string): Promise<Blob | undefined>;
  /** Supprime l'audio d'une séance (blobs + métadonnées de chunks), garde la transcription. */
  deleteAudio(sessionId: string): Promise<void>;
  /** Octets d'audio par séance. */
  audioUsage(): Promise<Record<string, number>>;

  putSegments(segs: TranscriptSegment[], opts?: WriteOpts): Promise<void>;
  listSegments(sessionId: string): Promise<TranscriptSegment[]>;
  /** Tous les segments (id, séance, temps, texte) — alimente la recherche globale. */
  listAllSegments(): Promise<TranscriptSegment[]>;

  putMarker(m: TimelineMarker, opts?: WriteOpts): Promise<void>;
  deleteMarker(id: string, opts?: WriteOpts): Promise<void>;
  listMarkers(sessionId: string): Promise<TimelineMarker[]>;

  putAnchors(a: NoteAnchor[], opts?: WriteOpts): Promise<void>;
  listAnchors(sessionId: string): Promise<NoteAnchor[]>;

  putInterruption(i: Interruption, opts?: WriteOpts): Promise<void>;
  listInterruptions(sessionId: string): Promise<Interruption[]>;

  /* --- synchronisation --- */
  listDirty(): Promise<CaptureDirty>;
  markSynced(table: CaptureTable, ids: string[]): Promise<void>;
  dropTombstone(key: string): Promise<void>;
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;

  /** Supprime TOUT ce qui concerne une séance (audio, transcription, marqueurs, ancrages). */
  deleteSession(sessionId: string): Promise<void>;
  exportSession(sessionId: string): Promise<CaptureExport>;
  clearAll(): Promise<void>;
  close(): void;
}
