/**
 * Connexion automatique depuis REV-EM (CAS C : aucune session LexNote dans ce navigateur, consentement « connexion automatique » donné).
 *
 * Le navigateur ne présente QUE l'intention et le nonce reçus de REV-EM (fragment d'URL → sessionStorage). Le serveur LexNote vérifie
 * tout (liaison, consentement, fraîcheur ≤ 120 s, usage unique) puis remet une session Supabase ORDINAIRE dans le corps de la réponse ;
 * elle est installée par supabase-js (`setSession`) exactement comme après une connexion par mot de passe.
 * Une seule tentative par intention et par onglet (double clic, double montage) ; les autres onglets partagent la session installée.
 */
import { getBackend } from '@/services/backend';
import type { IntegrationFailureBody } from '@/services/integration/types';
import { useAuth } from '@/store/auth';
import { clearPendingLaunch, saveLaunchResult } from './launchPending';

export type AutoSignInResult = { ok: true; sessionId: string } | { ok: false; error: IntegrationFailureBody };
/** Refus qui laissent l'intention INTACTE (rien n'a été consommé) : la connexion manuelle reprend le même lancement. */
export const LAUNCH_STILL_USABLE = new Set(['AUTO_LOGIN_DISABLED', 'SESSION_REQUIRED', 'OFFLINE', 'UNAVAILABLE', 'TIMEOUT', 'PEER_AUTH_FAILED', 'RATE_LIMITED', 'INVALID_PAYLOAD', 'WRONG_ACCOUNT']);

const inflight = new Map<string, Promise<AutoSignInResult>>();

export function autoSignIn(intent: string, nonce: string): Promise<AutoSignInResult> {
  let p = inflight.get(intent);
  if (!p) {
    p = (async (): Promise<AutoSignInResult> => {
      const r = await (await getBackend()).integration.call('launch-signin', { launchIntentId: intent, nonce });
      if (!r.ok) {
        if (!LAUNCH_STILL_USABLE.has(r.error.code)) clearPendingLaunch();
        return { ok: false, error: r.error };
      }
      if (!r.session) return { ok: false, error: { code: 'UNAVAILABLE', message: 'Réponse incomplète.', retryable: true } };
      // Serveur réel : l'intention est consommée et la séance créée → résultat mémorisé AVANT d'installer la session (un rechargement reprend
      // l'ouverture). Backend simulé des tests : session seule → la page d'ouverture consomme ensuite l'intention, connecté.
      if (r.sessionId) { saveLaunchResult(intent, r.sessionId); clearPendingLaunch(); }
      await useAuth.getState().adoptSession({ access_token: r.session.access_token, refresh_token: r.session.refresh_token });
      return { ok: true, sessionId: r.sessionId ?? '' };
    })().catch((): AutoSignInResult => ({ ok: false, error: { code: 'UNAVAILABLE', message: '', retryable: true } }));
    inflight.set(intent, p);
  }
  return p;
}
