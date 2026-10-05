import type { TranscriptionStatus } from '@/domain/capture';

/** Brouillon de segment produit par un moteur (l'orchestrateur lui ajoute id, session, provenance…). */
export interface SegmentDraft {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
}

export interface ProviderError {
  message: string;
  /** Faux : le moteur ne peut plus fonctionner (ex. service refusé). L'audio, lui, continue. */
  recoverable: boolean;
  kind: 'provider' | 'network' | 'permission';
}

/** Ce que LexNote fournit au moteur. Le moteur ne connaît ni l'UI, ni le stockage. */
export interface ProviderContext {
  sessionId: string;
  language: string;
  /** Ms depuis l'origine du CM (horloge murale). */
  now(): number;
  onSegment(draft: SegmentDraft): void;
  /** Texte provisoire (non conservé) pour l'affichage en direct. */
  onInterim(text: string): void;
  onError(err: ProviderError): void;
}

export interface AudioChunkInput {
  id: string;
  startMs: number;
  endMs: number;
  blob: Blob;
  mimeType: string;
}

export type ProviderState = 'idle' | 'ready' | 'running' | 'paused' | 'error' | 'disposed';
export interface ProviderStatus {
  state: ProviderState;
  /** File d'attente (moteurs par chunks). */
  pending?: number;
  detail?: string;
}

export type ProviderPrivacy = 'local' | 'cloud' | 'configurable';
export type ProviderMode = 'live' | 'chunk';

export interface ProviderAvailability {
  available: boolean;
  /** Pourquoi indisponible / ce qu'il faut configurer. */
  reason?: string;
}

/**
 * Contrat de tous les moteurs de transcription (Web Speech, Whisper local WASM/WebGPU,
 * API Whisper, etc.). L'interface de LexNote ne dépend jamais d'un moteur particulier.
 *
 *  - mode 'live'  : le moteur écoute lui-même le micro (Web Speech) ; `processAudioChunk` est ignoré.
 *  - mode 'chunk' : le moteur reçoit chaque chunk audio terminé via `processAudioChunk`.
 */
export interface TranscriptionProvider {
  readonly id: string;
  readonly label: string;
  readonly mode: ProviderMode;
  readonly privacy: ProviderPrivacy;
  /** Libellé honnête de la confidentialité, affiché à l'utilisateur. */
  privacyNote(): string;
  availability(): ProviderAvailability;

  initialize(ctx: ProviderContext): Promise<void>;
  start(): Promise<void>;
  /** Doit rejeter en cas d'échec (l'orchestrateur réessaie puis marque le chunk « failed »). */
  processAudioChunk(chunk: AudioChunkInput): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Termine proprement : segments en cours finalisés avant la résolution. */
  stop(): Promise<void>;
  dispose(): void;
  getStatus(): ProviderStatus;
}

export type { TranscriptionStatus };
