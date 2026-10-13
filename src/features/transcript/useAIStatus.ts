import { useSyncExternalStore } from 'react';
import { aiService } from '@/services/ai';

export type AIStatus = 'ready' | 'offline' | 'not-configured';

const subscribe = (cb: () => void) => {
  const off = aiService.subscribe(cb);
  window.addEventListener('online', cb); window.addEventListener('offline', cb);
  return () => { off(); window.removeEventListener('online', cb); window.removeEventListener('offline', cb); };
};
const snapshot = (): AIStatus => (!aiService.isAvailable() ? 'not-configured' : typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'ready');

/** État RÉEL du moteur IA (branché ? en ligne ?) — jamais supposé. */
export function useAIStatus(): AIStatus {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export const AI_STATUS_LABELS: Record<AIStatus, string> = {
  ready: 'IA disponible',
  offline: 'Hors ligne',
  'not-configured': 'Fonction IA non configurée',
};
