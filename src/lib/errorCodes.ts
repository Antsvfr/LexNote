/**
 * Codes d'erreur de diagnostic : courts, stables, sans donnée personnelle. Affichés à l'étudiant (« code AI-503 ») et cités par le support
 * et par docs/PRODUCTION_RUNBOOK.md. Ajouter un code = l'ajouter ici ET dans le runbook (un test vérifie que les deux concordent).
 */
export type ErrorArea = 'AUTH' | 'SYNC' | 'INT' | 'AI' | 'STORE' | 'TRANS' | 'PWA' | 'UI';
export interface ErrorInfo { area: ErrorArea; title: string; hint: string }

export const ERROR_CODES = {
  'AUTH-SESSION-01': { area: 'AUTH', title: 'Session expirée', hint: 'Reconnectez-vous. Vos notes locales ne sont pas perdues.' },
  'AUTH-REVOKED-02': { area: 'AUTH', title: 'Appareil déconnecté à distance', hint: 'Cet appareil a été révoqué depuis un autre appareil. Reconnectez-vous.' },
  'SYNC-OFFLINE-01': { area: 'SYNC', title: 'Hors connexion', hint: 'Les modifications sont conservées sur cet appareil et partiront au retour du réseau.' },
  'SYNC-CONFLICT-02': { area: 'SYNC', title: 'Conflit de synchronisation', hint: 'Deux versions d’une note existent : choisissez laquelle garder (ou gardez les deux).' },
  'SYNC-AUTH-03': { area: 'SYNC', title: 'Synchronisation non autorisée', hint: 'Reconnectez-vous pour reprendre la synchronisation.' },
  'SYNC-REMOTE-04': { area: 'SYNC', title: 'Erreur du serveur de synchronisation', hint: 'Réessayez dans quelques minutes. Vos données restent sur cet appareil.' },
  'INT-PEER-401': { area: 'INT', title: 'Application partenaire non reconnue', hint: 'Configuration de la liaison REV-EM ⇄ LexNote incohérente côté serveur.' },
  'INT-HMAC-401': { area: 'INT', title: 'Signature de la liaison refusée', hint: 'La clé d’intégration diffère entre REV-EM et LexNote.' },
  'INT-KID-401': { area: 'INT', title: 'Clé de liaison inconnue', hint: 'L’identifiant de clé (kid) diffère entre REV-EM et LexNote.' },
  'INT-CLOCK-401': { area: 'INT', title: 'Horloge décalée', hint: 'L’horloge d’un serveur est décalée : la liaison est refusée par sécurité.' },
  'INT-GW-404': { area: 'INT', title: 'Passerelle d’intégration absente', hint: 'La fonction integration-gateway n’est pas déployée.' },
  'INT-GW-JWT': { area: 'INT', title: 'Passerelle protégée par JWT', hint: 'integration-gateway doit être déployée avec verify_jwt = false.' },
  'INT-URL': { area: 'INT', title: 'Origine non autorisée', hint: 'APP_ORIGINS du projet ne contient pas l’adresse de l’application.' },
  'AI-DISABLED': { area: 'AI', title: 'IA désactivée', hint: 'Les fonctions IA sont temporairement indisponibles.' },
  'AI-CAPACITY': { area: 'AI', title: 'Capacité IA du jour atteinte', hint: 'Le budget global du jour est consommé. Réessayez plus tard.' },
  'AI-429': { area: 'AI', title: 'Trop de demandes IA', hint: 'Attendez un instant avant de relancer.' },
  'AI-503': { area: 'AI', title: 'Fournisseur IA indisponible', hint: 'Réessayez dans un instant.' },
  'AI-504': { area: 'AI', title: 'Délai IA dépassé', hint: 'Essayez sur un passage plus court.' },
  'AI-502': { area: 'AI', title: 'Réponse IA incomplète', hint: 'Essayez sur un passage plus court.' },
  'AI-422': { area: 'AI', title: 'Contenu refusé par le moteur IA', hint: 'Reformulez ou réduisez la sélection.' },
  'AI-CONFIG': { area: 'AI', title: 'IA non configurée', hint: 'La clé du moteur n’est pas définie côté serveur.' },
  'STORE-IDB-01': { area: 'STORE', title: 'Stockage local indisponible', hint: 'Navigation privée ou stockage plein : exportez vos notes depuis Réglages.' },
  'STORE-WRITE-02': { area: 'STORE', title: 'Écriture locale impossible', hint: 'Libérez de l’espace puis réessayez. Exportez vos notes par précaution.' },
  'TRANS-MIC-01': { area: 'TRANS', title: 'Micro inaccessible', hint: 'Autorisez le micro dans le navigateur.' },
  'TRANS-ENGINE-02': { area: 'TRANS', title: 'Moteur de transcription indisponible', hint: 'Prenez vos notes normalement ; la transcription pourra reprendre.' },
  'PWA-UPDATE-01': { area: 'PWA', title: 'Mise à jour en attente', hint: 'Une nouvelle version s’appliquera quand vous aurez terminé la séance.' },
  'UI-CRASH-01': { area: 'UI', title: 'Erreur d’interface', hint: 'Réessayez ou revenez à l’accueil. Vos notes sont enregistrées sur cet appareil.' },
} as const satisfies Record<string, ErrorInfo>;

export type ErrorCode = keyof typeof ERROR_CODES;
export const isErrorCode = (c: string): c is ErrorCode => c in ERROR_CODES;
export const errorInfo = (c: string): ErrorInfo | null => (isErrorCode(c) ? ERROR_CODES[c] : null);

/** Code de diagnostic d'une erreur d'interface : stable pour un même type d'erreur, sans message ni donnée de l'utilisateur. */
export function crashCode(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `UI-CRASH-01/${h.toString(16).slice(0, 4).padStart(4, '0')}`;
}

/** Code de synchronisation selon l'état et le message d'erreur (HTTP). */
export function syncErrorCode(status: { state: string; error: string | null; conflicts: number }): ErrorCode | null {
  if (status.state === 'offline') return 'SYNC-OFFLINE-01';
  if (status.state === 'error') return /\b(401|403)\b|jwt|auth/i.test(status.error ?? '') ? 'SYNC-AUTH-03' : 'SYNC-REMOTE-04';
  return status.conflicts > 0 ? 'SYNC-CONFLICT-02' : null;
}
