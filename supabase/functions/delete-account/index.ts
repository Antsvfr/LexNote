// Edge Function « delete-account » — suppression DÉFINITIVE du compte de l'utilisateur qui l'appelle.
//
// Pourquoi une fonction serveur : supprimer un utilisateur Auth exige la clé « service role », qui ne doit
// JAMAIS être exposée au navigateur. Les données liées (profil, matières, séances, transcriptions…) sont
// supprimées en cascade par les clés étrangères `on delete cascade` vers auth.users.
//
// Déploiement : supabase functions deploy delete-account
// (SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournies automatiquement par Supabase.)
// @ts-nocheck — le paquet d'intégration généré n'a pas de déclarations de types.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeadersFor, readBrowserOrigins } from '../_shared/integration/lexnote-revem-v1.mjs';

// CORS : liste blanche centralisée (même configuration que l'intégration REV-EM) — production : https://lex-note-svfr.vercel.app ;
// développement : INTEGRATION_ENV=development autorise localhost explicitement. Jamais « * ». Configuration invalide ⇒ aucun navigateur autorisé.
let ORIGINS: string[] = [];
try { ORIGINS = readBrowserOrigins('lexnote', (k: string) => Deno.env.get(k)); }
catch (e) { console.error('[delete-account] configuration CORS invalide :', (e as Error).message); }

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin');
  const cors = corsHeadersFor(ORIGINS, origin);
  // Un navigateur d'une origine non autorisée est refusé AVANT toute lecture du jeton et toute suppression.
  if (origin && !ORIGINS.includes(origin)) return new Response(JSON.stringify({ error: 'forbidden_origin' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const auth = req.headers.get('Authorization');
  if (!auth) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: cors });

  // 1) Identifier l'appelant avec SON jeton (jamais avec un identifiant fourni dans le corps de la requête).
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data, error } = await asUser.auth.getUser();
  if (error || !data.user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: cors });

  // 2) Supprimer CET utilisateur uniquement, avec la clé service role (côté serveur).
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { error: delErr } = await admin.auth.admin.deleteUser(data.user.id);
  if (delErr) return new Response(JSON.stringify({ error: delErr.message }), { status: 500, headers: cors });
  return new Response(JSON.stringify({ deleted: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
});
