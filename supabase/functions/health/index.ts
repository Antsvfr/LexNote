// Edge Function « health » — point d'entrée. Publique (verify_jwt = false), lecture seule, sans donnée sensible : voir handler.ts.
//   supabase functions deploy health --no-verify-jwt
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleHealth } from './handler.ts';

const env = (n: string) => Deno.env.get(n);

Deno.serve((req) => handleHealth(req, {
  env,
  appHealth: async () => {
    const url = env('SUPABASE_URL'); const key = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return null;
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc('app_health');
    return error ? null : (data as Record<string, unknown>);
  },
  probeFunction: async (name) => {
    const url = env('SUPABASE_URL');
    if (!url) return null;
    try { return (await fetch(`${url}/functions/v1/${name}`, { method: 'GET', signal: AbortSignal.timeout(4000) })).status; } catch { return null; }
  },
}));
