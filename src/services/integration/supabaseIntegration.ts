import type { SupabaseClient } from '@supabase/supabase-js';
import { CLIENT_ERROR, type IntegrationAction, type IntegrationApi, type IntegrationReply } from './types';

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const failure = (code: string, message: string, retryable = false): IntegrationReply => ({ ok: false, error: { code, message, retryable } });
/** Actions utilisables SANS session (connexion automatique depuis REV-EM). */
const PUBLIC: ReadonlySet<IntegrationAction> = new Set(['launch-signin']);

/**
 * Jeton d'accès VALIDE de l'utilisateur, ou null.
 * Cause racine corrigée : `functions.invoke` de supabase-js retombe SILENCIEUSEMENT sur la clé publique (anon) quand la session ne peut pas
 * être lue ou rafraîchie (réseau instable, jeton de rafraîchissement refusé…). La fonction serveur répondait alors « jeton invalide »,
 * affiché comme « Votre session a expiré », alors que l'interface se croyait connectée. Ici la session est vérifiée — et rafraîchie si elle
 * expire dans moins de 60 s — AVANT l'appel, puis transmise explicitement.
 */
async function accessToken(client: SupabaseClient): Promise<string | null> {
  const { data } = await client.auth.getSession();                         // rafraîchit déjà un jeton expiré quand c'est possible
  let s = data.session;
  if (s && (s.expires_at ?? 0) * 1000 < Date.now() + 60_000) s = (await client.auth.refreshSession()).data.session ?? null;
  return s?.access_token ?? null;
}

/** Appelle l'Edge Function `integration-link` avec le jeton Supabase de l'utilisateur. */
export function createSupabaseIntegration(client: SupabaseClient): IntegrationApi {
  async function invoke(action: IntegrationAction, body: Record<string, unknown>, token: string | null): Promise<IntegrationReply> {
    const { data, error } = await client.functions.invoke('integration-link', { body: { ...body, action }, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) });
    if (error) {
      // Les erreurs métier de la fonction portent un corps JSON {ok:false,error}; on le préfère au message technique de supabase-js.
      const ctx = (error as { context?: Response }).context;
      try { const j = (await ctx?.clone().json()) as IntegrationReply; if (j && j.ok === false) return j; } catch { /* corps absent */ }
      // Réponse de la PLATEFORME (et non de notre fonction) : la cause n'est plus masquée.
      if (ctx?.status === 401) return { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Jeton refusé par la plateforme.', retryable: false, details: { reason: 'platform-401' } } };
      if (ctx?.status === 404) return { ok: false, error: { code: 'UNAVAILABLE', message: 'Fonction integration-link non déployée.', retryable: false, details: { reason: 'function-not-found' } } };
      return offline() ? failure(CLIENT_ERROR.OFFLINE, 'Hors ligne.', true) : failure('UNAVAILABLE', 'Service indisponible.', true);
    }
    return data as IntegrationReply;
  }
  return {
    async call(action, body = {}) {
      if (offline()) return failure(CLIENT_ERROR.OFFLINE, 'Hors ligne.', true);
      if (PUBLIC.has(action)) return invoke(action, body, null);
      const token = await accessToken(client);
      if (!token) return failure(CLIENT_ERROR.SESSION_REQUIRED, 'Aucune session LexNote valide.');
      const r = await invoke(action, body, token);
      // Serveur pas encore redéployé : un refus du PARTENAIRE arrivait en `UNAUTHENTICATED` (« …du partenaire… »). Ce n'est pas la session.
      if (!r.ok && r.error.code === 'UNAUTHENTICATED' && /partenaire/i.test(r.error.message)) return { ok: false, error: { ...r.error, code: 'PEER_AUTH_FAILED', details: { reason: 'legacy-peer-401', ...(r.error.details ?? {}) } } };
      // Jeton refusé par la fonction (révoqué entre-temps) : UN rafraîchissement explicite, puis UNE seule nouvelle tentative.
      if (!r.ok && r.error.code === 'UNAUTHENTICATED') {
        const { data } = await client.auth.refreshSession();
        if (!data.session) return failure(CLIENT_ERROR.SESSION_REQUIRED, 'Session LexNote révoquée ou expirée.');
        const again = await invoke(action, body, data.session.access_token);
        if (!again.ok && again.error.code === 'UNAUTHENTICATED') return failure(CLIENT_ERROR.SESSION_REQUIRED, 'Session LexNote refusée.');
        return again;
      }
      return r;
    },
  };
}
export const unavailableIntegration: IntegrationApi = { call: async () => ({ ok: false, error: { code: 'UNAVAILABLE', message: 'LexNote n’est pas connecté à un projet Supabase.', retryable: false } }) };
