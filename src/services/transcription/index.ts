/**
 * Transcription — NON implémentée en V1.
 *
 * Emplacement prévu pour Whisper local, Web Speech, ou un STT cloud.
 * L'enregistrement n'aura lieu qu'avec une autorisation explicite
 * (`AudioRef.consentGivenAt`) : beaucoup d'enseignants l'interdisent.
 */
import type { Transcript } from '@/domain/types';

export type TranscriptionState = 'idle' | 'recording' | 'processing' | 'error';

export interface TranscriptionProvider {
  readonly id: string;
  isAvailable(): boolean;
  start(opts: { language: string; sessionId: string }): Promise<void>;
  stop(): Promise<Transcript>;
}

export const NullTranscription: TranscriptionProvider = {
  id: 'none',
  isAvailable: () => false,
  async start() {
    throw new Error("La transcription n'est pas encore disponible.");
  },
  async stop() {
    throw new Error("La transcription n'est pas encore disponible.");
  },
};

export const transcriptionService: { provider: TranscriptionProvider } = { provider: NullTranscription };
