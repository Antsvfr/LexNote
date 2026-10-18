import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToasts } from '@/store/toasts';
import { BLOCK_MESSAGE, currentBlockReason } from '@/lib/activity';
import { log } from '@/lib/log';

/**
 * Enregistre le service worker. Une nouvelle version est proposée, JAMAIS imposée : pas de rechargement automatique, et le bouton
 * « Mettre à jour » refuse de recharger pendant une transcription, un enregistrement de notes ou une synchronisation (voir activity.ts).
 */
export function usePwaUpdate() {
  const { needRefresh: [needRefresh], offlineReady: [offlineReady], updateServiceWorker } = useRegisterSW({
    onRegisterError: (e) => log.pwa.warn('service worker', e),
    // Vérifie périodiquement (1 h) s'il existe une nouvelle version ; sans effet hors ligne.
    onRegisteredSW: (_url, reg) => { if (reg) setInterval(() => { if (navigator.onLine) void reg.update().catch(() => undefined); }, 3_600_000); },
  });
  useEffect(() => {
    if (!needRefresh) return;
    useToasts.getState().push({
      tone: 'info', message: 'Une nouvelle version de LexNote est disponible.', sticky: true,
      action: {
        label: 'Mettre à jour',
        run: () => {
          const reason = currentBlockReason();
          if (reason) { useToasts.getState().push({ tone: 'info', message: BLOCK_MESSAGE[reason] }); return; }
          void updateServiceWorker(true);
        },
      },
    });
  }, [needRefresh, updateServiceWorker]);
  useEffect(() => {
    if (offlineReady) useToasts.getState().push({ tone: 'success', message: 'LexNote est prête à fonctionner hors connexion.' });
  }, [offlineReady]);
}

/** Avertit avant de fermer / recharger l'onglet pendant une transcription ou un enregistrement en cours (jamais autrement). */
export function useUnloadGuard() {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!currentBlockReason()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}
