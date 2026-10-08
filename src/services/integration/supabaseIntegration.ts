import type { SupabaseClient } from '@supabase/supabase-js';
import type { IntegrationApi, IntegrationReply } from './types';

/** Appelle l'Edge Function `integration-link` avec le jeton Supabase de l'utilisateur (ajouté par supabase-js). */
export function createSupabaseIntegration(client: SupabaseClient): IntegrationApi {
  return {
    async call(action, body = {}) {
      const { data, error } = await client.functions.invoke('integration-link', { body: { ...body, action } });
      if (error) {
        // Les erreurs métier de la fonction portent un corps JSON {ok:false,error}; on le préfère au message technique de supabase-js.
        try { const j = (await (error as { context?: Response }).context?.json()) as IntegrationReply; if (j && j.ok === false) return j; } catch { /* corps absent */ }
        return { ok: false, error: { code: 'UNAVAILABLE', message: 'Service indisponible.', retryable: true } };
      }
      return data as IntegrationReply;
    },
  };
}
export const unavailableIntegration: IntegrationApi = { call: async () => ({ ok: false, error: { code: 'UNAVAILABLE', message: 'LexNote n’est pas connecté à un projet Supabase.', retryable: false } }) };
