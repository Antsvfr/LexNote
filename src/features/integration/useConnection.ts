import { useCallback, useEffect, useState } from 'react';
import type { ConnectionState } from '@/integration/contracts';
import { getBackend } from '@/services/backend';
import type { IntegrationFailureBody } from '@/services/integration/types';

/** Libellés pour l'étudiant (le message technique de l'erreur n'est jamais affiché tel quel). */
export const ERROR_TEXT: Record<string, string> = {
  LINK_EXPIRED: 'Cette demande de connexion a expiré. Retournez dans REV-EM et relancez la connexion.',
  GONE: 'Cette demande de connexion a déjà été utilisée ou annulée. Relancez la connexion depuis REV-EM.',
  FORBIDDEN: 'Cette demande de connexion n’est pas valide. Relancez la connexion depuis REV-EM.',
  NOT_FOUND: 'Cette demande de connexion est introuvable. Relancez la connexion depuis REV-EM.',
  CONFLICT: 'Un compte REV-EM est déjà connecté à votre compte LexNote. Déconnectez-le d’abord dans les Réglages.',
  UNAUTHENTICATED: 'Votre session a expiré. Reconnectez-vous à LexNote.',
  UNAVAILABLE: 'Le service de connexion est momentanément indisponible. Réessayez dans un instant.',
  TIMEOUT: 'REV-EM ne répond pas. Réessayez dans un instant.',
};
export const errorText = (e: IntegrationFailureBody) => ERROR_TEXT[e.code] ?? 'La connexion n’a pas pu être établie. Réessayez.';

/** État de la connexion avec REV-EM, VÉRIFIÉ auprès du serveur (jamais déduit d'un simple stockage local). */
export function useConnection() {
  const [state, setState] = useState<ConnectionState | null>(null);
  const [error, setError] = useState<IntegrationFailureBody | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try { const r = await (await getBackend()).integration.call('status'); if (r.ok && r.state) { setState(r.state); setError(null); } else if (!r.ok) setError(r.error); }
    catch { setError({ code: 'UNAVAILABLE', message: '', retryable: true }); }
    finally { setBusy(false); }
  }, []);
  const revoke = useCallback(async () => {
    setBusy(true);
    try { const r = await (await getBackend()).integration.call('revoke'); if (r.ok && r.state) { setState(r.state); setError(null); return r; } if (!r.ok) setError(r.error); return r; }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { state, error, busy, refresh, revoke };
}
