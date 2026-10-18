import { useCallback, useEffect, useState } from 'react';
import type { ConnectionState } from '@/integration/contracts';
import { getBackend } from '@/services/backend';
import type { IntegrationFailureBody } from '@/services/integration/types';

/**
 * Libellés pour l'étudiant (le message technique de l'erreur n'est jamais affiché tel quel).
 * « Session expirée » ne désigne plus QUE la session LexNote de l'étudiant (SESSION_REQUIRED, produit par le navigateur après vérification) :
 * un refus entre les deux SERVEURS (PEER_AUTH_FAILED) a son propre message — c'était la cause masquée du « Votre session a expiré ».
 */
export const ERROR_TEXT: Record<string, string> = {
  LINK_EXPIRED: 'Cette demande de connexion a expiré. Retournez dans REV-EM et relancez la connexion.',
  GONE: 'Cette demande de connexion a déjà été utilisée ou annulée. Relancez la connexion depuis REV-EM.',
  FORBIDDEN: 'Cette demande de connexion n’est pas valide. Relancez la connexion depuis REV-EM.',
  NOT_FOUND: 'Cette demande de connexion est introuvable. Relancez la connexion depuis REV-EM.',
  CONFLICT: 'Un compte REV-EM est déjà connecté à votre compte LexNote. Déconnectez-le d’abord dans les Réglages.',
  SESSION_REQUIRED: 'Votre session LexNote a expiré. Reconnectez-vous : la demande en cours sera reprise.',
  UNAUTHENTICATED: 'Votre session LexNote n’a pas été reconnue. Reconnectez-vous.',
  PEER_AUTH_FAILED: 'Les serveurs de LexNote et de REV-EM n’ont pas pu s’authentifier mutuellement (configuration du service). Votre session n’est pas en cause : réessayez plus tard ou signalez le code ci-dessous.',
  OFFLINE: 'Vous êtes hors ligne. Reconnectez-vous à Internet puis réessayez.',
  UNAVAILABLE: 'Le service de connexion est momentanément indisponible. Réessayez dans un instant.',
  TIMEOUT: 'REV-EM ne répond pas. Réessayez dans un instant.',
  RATE_LIMITED: 'Trop de tentatives. Patientez un instant puis réessayez.',
};
export const errorText = (e: IntegrationFailureBody) => ERROR_TEXT[e.code] ?? 'La connexion n’a pas pu être établie. Réessayez.';
/** Code court pour le support (ex. « PEER_AUTH_FAILED · gateway-verify-jwt ») : jamais de secret ni de donnée personnelle. */
export const errorCodeLabel = (e: IntegrationFailureBody) => (e.details?.reason ? `${e.code} · ${e.details.reason}` : e.code);

/** État de la connexion avec REV-EM, VÉRIFIÉ auprès du serveur (jamais déduit d'un simple stockage local). */
export function useConnection() {
  const [state, setState] = useState<ConnectionState | null>(null);
  const [error, setError] = useState<IntegrationFailureBody | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try { const r = await (await getBackend()).integration.call('status'); if (r.ok && r.state) { setState(r.state); setError(null); } else if (!r.ok) { setError(r.error); if (r.error.code === 'SESSION_REQUIRED') setState(null); } }
    catch { setError({ code: 'UNAVAILABLE', message: '', retryable: true }); }
    finally { setBusy(false); }
  }, []);
  const revoke = useCallback(async () => {
    setBusy(true);
    try { const r = await (await getBackend()).integration.call('revoke'); if (r.ok && r.state) { setState(r.state); setError(null); return r; } if (!r.ok) setError(r.error); return r; }
    finally { setBusy(false); }
  }, []);
  /** Active / retire la seule connexion automatique (la liaison reste). Effet immédiat côté serveur. */
  const setAutoLogin = useCallback(async (enabled: boolean) => {
    setBusy(true);
    try {
      const r = await (await getBackend()).integration.call('auto-login', { enabled });
      if (!r.ok) { setError(r.error); return r; }
      await refresh();
      return r;
    } finally { setBusy(false); }
  }, [refresh]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { state, error, busy, refresh, revoke, setAutoLogin };
}
