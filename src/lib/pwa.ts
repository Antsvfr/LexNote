import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToasts } from '@/store/toasts';

/** Enregistre le service worker. Une nouvelle version est proposée, jamais imposée (pas de rechargement en plein CM). */
export function usePwaUpdate() {
  const { needRefresh: [needRefresh], offlineReady: [offlineReady], updateServiceWorker } = useRegisterSW({
    onRegisterError: (e) => console.warn('[LexNote] service worker', e),
  });
  useEffect(() => {
    if (needRefresh) {
      useToasts.getState().push({ tone: 'info', message: 'Une nouvelle version de LexNote est disponible.', sticky: true, action: { label: 'Mettre à jour', run: () => void updateServiceWorker(true) } });
    }
  }, [needRefresh, updateServiceWorker]);
  useEffect(() => {
    if (offlineReady) useToasts.getState().push({ tone: 'success', message: 'LexNote est prête à fonctionner hors connexion.' });
  }, [offlineReady]);
}
