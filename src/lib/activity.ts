import { useCapture } from '@/store/capture';
import { useSaveStatus, type SaveState } from '@/features/editor/saveStatus';
import { useSync, type SyncState } from '@/store/sync';
import type { TranscriptionStatus } from '@/domain/capture';

/**
 * « Est-on en plein travail ? » — source unique pour décider si l'application peut être rechargée (mise à jour PWA, fermeture d'onglet).
 * Règle : on ne recharge jamais automatiquement ; on ne propose pas non plus de recharger pendant une prise de notes, une
 * transcription ou une synchronisation en cours.
 */
export interface Activity { capture: TranscriptionStatus; save: SaveState; sync: SyncState; pending: number }
export type BlockReason = 'recording' | 'unsaved' | 'syncing';

const LIVE_CAPTURE: readonly TranscriptionStatus[] = ['REQUESTING_PERMISSION', 'STARTING', 'RECORDING', 'PAUSED', 'PROCESSING'];

export function blockReason(a: Activity): BlockReason | null {
  if (LIVE_CAPTURE.includes(a.capture)) return 'recording';
  if (a.save === 'saving') return 'unsaved';
  if (a.sync === 'syncing') return 'syncing';
  return null;
}

export const BLOCK_MESSAGE: Record<BlockReason, string> = {
  recording: 'Une transcription est en cours. La mise à jour sera possible quand vous l’aurez terminée.',
  unsaved: 'Vos notes sont en cours d’enregistrement. Réessayez dans un instant.',
  syncing: 'Une synchronisation est en cours. Réessayez dans un instant.',
};

export const activitySnapshot = (): Activity => ({
  capture: useCapture.getState().status, save: useSaveStatus.getState().state,
  sync: useSync.getState().state, pending: useSync.getState().pending,
});
export const currentBlockReason = () => blockReason(activitySnapshot());
