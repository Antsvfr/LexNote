import { confirm } from '@/components/confirm';
import { currentBlockReason } from '@/lib/activity';
import { flushSyncBeforeExit } from '@/services/workspace';
import { useSync } from '@/store/sync';

/**
 * Déconnexion SANS PERTE : avant de quitter, on tente d'envoyer ce qui n'est pas encore synchronisé, et on prévient l'étudiant si une
 * transcription est en cours ou si des éléments resteront sur l'appareil. Rien n'est jamais supprimé par la déconnexion
 * (les données du compte restent dans le stockage local de cet appareil, isolées par compte).
 * Renvoie `false` si l'étudiant renonce.
 */
export async function confirmSafeLogout(): Promise<boolean> {
  if (currentBlockReason() === 'recording' && !await confirm({
    title: 'Une transcription est en cours',
    message: 'Se déconnecter arrête la transcription. Ce qui a été capturé reste enregistré sur cet appareil.',
    confirmLabel: 'Arrêter et se déconnecter', danger: true,
  })) return false;
  if (useSync.getState().state === 'disabled') return true;
  const left = await flushSyncBeforeExit();
  if (left > 0 && !await confirm({
    title: 'Des modifications ne sont pas encore envoyées',
    message: `${left} élément${left > 1 ? 's' : ''} ${left > 1 ? 'ne sont' : 'n’est'} pas encore synchronisé${left > 1 ? 's' : ''} (réseau indisponible ?). ${left > 1 ? 'Ils restent' : 'Il reste'} sur cet appareil et ${left > 1 ? 'partiront' : 'partira'} à votre prochaine connexion ici. Rien n’est perdu.`,
    confirmLabel: 'Se déconnecter quand même',
  })) return false;
  return true;
}
