// Edge Function « course-engine » — moteur de cours DISTANT (facultatif).
//
// ⚠ Non testée contre un vrai modèle dans l'environnement de développement (aucune clé disponible) : à valider après déploiement.
//
// Rôle : recevoir le plan + les connaissances SÉLECTIONNÉES (pas la transcription brute), appeler un modèle d'IA avec une clé
// détenue UNIQUEMENT ici (secret Supabase), renvoyer du JSON. Le client revalide tout (voir src/services/engine/validator.ts).
//
// Déploiement :
//   supabase secrets set ANTHROPIC_API_KEY=... COURSE_ENGINE_MODEL=<identifiant du modèle>
//   supabase functions deploy course-engine
// Côté application : VITE_ENGINE_URL=https://<ref>.supabase.co/functions/v1/course-engine
//
// Le fournisseur de modèle est interchangeable : seule la fonction `callModel` change.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SYSTEM, buildUserPrompt } from './prompts.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function callModel(userPrompt: string): Promise<unknown> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  const model = Deno.env.get('COURSE_ENGINE_MODEL');
  if (!key || !model) throw new Error('moteur non configuré');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 8000, system: SYSTEM, messages: [{ role: 'user', content: userPrompt }] }),
  });
  if (!res.ok) throw new Error(`modèle : ${res.status}`);
  const data = await res.json();
  const text: string = data?.content?.[0]?.text ?? '';
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  return JSON.parse(text.slice(start, end + 1));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'unauthorized' }, 401);
  // L'appelant est identifié avec SON jeton ; aucune donnée d'un autre utilisateur n'est accessible ici.
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data, error } = await supa.auth.getUser();
  if (error || !data.user) return json({ error: 'unauthorized' }, 401);
  try {
    const body = await req.json();
    if (body?.task !== 'compose' || !body.input) return json({ error: 'bad request' }, 400);
    if (JSON.stringify(body.input).length > 400_000) return json({ error: 'payload too large' }, 413);
    return json(await callModel(buildUserPrompt(body.input)));
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
