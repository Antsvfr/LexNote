import { useEffect } from 'react';
import { captureManager } from '@/services/capture/manager';
import { useCapture } from '@/store/capture';

export const REQUEST_RECORD_EVENT = 'lexnote:request-record';

/**
 * Raccourcis globaux de l'éditeur :
 *   Ctrl/⌘ + Alt + R → démarrer / mettre en pause / reprendre la transcription
 *   Ctrl/⌘ + Alt + S → marquer ce moment
 *
 * Choisis après examen des conflits : Ctrl/⌘+Maj+R recharge la page (Chrome/Firefox) ou ouvre le mode Lecture
 * (Safari) ; Ctrl/⌘+Maj+M change de profil (Chrome) ou ouvre le mode responsive (Firefox). On utilise `event.code`
 * car, avec Alt, `event.key` varie selon le clavier (ex. ® sur Mac).
 */
export function useCaptureShortcuts(sessionId: string, requestStart: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey) return;
      if (e.code === 'KeyR') {
        e.preventDefault();
        const st = useCapture.getState().status;
        if (st === 'RECORDING') void captureManager.pause(sessionId);
        else if (st === 'PAUSED') void captureManager.resume(sessionId);
        else if (!['REQUESTING_PERMISSION', 'STARTING', 'PROCESSING'].includes(st)) requestStart();
      } else if (e.code === 'KeyS') {
        e.preventDefault();
        captureManager.mark(sessionId);
      }
    };
    // La palette de commandes passe par le même chemin (avertissement de première utilisation inclus).
    const onRequest = () => {
      const st = useCapture.getState().status;
      if (!['REQUESTING_PERMISSION', 'STARTING', 'PROCESSING', 'RECORDING'].includes(st)) requestStart();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(REQUEST_RECORD_EVENT, onRequest);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(REQUEST_RECORD_EVENT, onRequest); };
  }, [sessionId, requestStart]);
}
