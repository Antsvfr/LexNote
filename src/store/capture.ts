import { create } from 'zustand';
import type {
  AudioChunk, AudioSession, Interruption, MarkerReason, TimelineMarker, TranscriptionStatus, TranscriptSegment,
} from '@/domain/capture';
import { insertSorted } from '@/domain/capture';
import type { StorageInfo } from '@/services/capture/quota';
import type { CaptureError } from '@/services/capture/controller';

/** Miroir réactif du contrôleur de capture, pour l'UI. Aucune logique ici : voir `services/capture/manager.ts`. */
export interface CaptureState {
  viewSessionId: string | null;
  loaded: boolean;
  status: TranscriptionStatus;
  error: CaptureError | null;
  audio: AudioSession | null;
  segments: TranscriptSegment[];
  markers: TimelineMarker[];
  interruptions: Interruption[];
  chunks: AudioChunk[];
  interim: string;
  storage: StorageInfo | null;
  audioStopped: boolean;
  failedChunks: number;
  providerLabel: string | null;
  providerPrivacy: string | null;
  /** Dernier marqueur créé (affiche « Pourquoi ? » quelques secondes). */
  lastMarkerId: string | null;
  /** Segment à mettre en évidence (ouverture depuis la recherche). */
  focusMs: number | null;
  /** Capture active n'importe où dans l'app (pastille REC globale). */
  active: { sessionId: string; status: TranscriptionStatus; audio: AudioSession | null } | null;
}

export const initialCapture: CaptureState = {
  viewSessionId: null, loaded: false, status: 'INACTIVE', error: null, audio: null, segments: [], markers: [],
  interruptions: [], chunks: [], interim: '', storage: null, audioStopped: false, failedChunks: 0,
  providerLabel: null, providerPrivacy: null, lastMarkerId: null, focusMs: null, active: null,
};

export const useCapture = create<CaptureState>(() => ({ ...initialCapture }));

export const captureSet = (p: Partial<CaptureState> | ((s: CaptureState) => Partial<CaptureState>)) => useCapture.setState(p);
export const addSegment = (seg: TranscriptSegment) => useCapture.setState((s) => ({ segments: insertSorted(s.segments, seg) }));
export type { MarkerReason };
