#!/usr/bin/env node
// SMOKE TEST sur un VRAI projet Supabase de TEST (jamais la production) : authentification, données (RLS), révocation de session, nettoyage.
// Ce script CRÉE puis SUPPRIME deux comptes jetables (…@smoke.lexnote.invalid). Il refuse de tourner sans garde-fous explicites :
//
//   SMOKE_CONFIRM=1                       obligatoire (sans lui : plan affiché, rien n'est appelé, code 2)
//   SMOKE_SUPABASE_URL                    https://<réf>.supabase.co  du projet de TEST
//   SMOKE_EXPECTED_REF                    la référence attendue (doit être identique à celle de l'URL : évite de viser un autre projet par erreur)
//   SMOKE_PRODUCTION_REFS                 références de PRODUCTION (séparées par des virgules) : le script refuse si l'URL en fait partie
//   SMOKE_ANON_KEY  SMOKE_SERVICE_ROLE_KEY   clés du projet de TEST (jamais affichées) ; leur claim `ref` doit correspondre à l'URL
//   SMOKE_LOCAL=1                         Supabase LOCAL (`supabase start`) : URL http://127.0.0.1:<port> seulement ; les contrôles de référence ne s'appliquent pas
//   SMOKE_MAX_USERS (défaut 10)           un projet qui contient plus de comptes « réels » est refusé (probablement la production)
//   --with-integration                    enchaîne ensuite scripts/prod/real-e2e.mjs (deux projets de test, variables LEXNOTE_* / REVEM_*, voir son en-tête)
// Couvert ici : authentification (création, connexion, rafraîchissement, persistance, déconnexion locale puis globale), RLS, version serveur, suppression douce, nettoyage.
// NON couvert ici (portes MANUELLES, voir docs/TEST_ENVIRONMENT.md §6) : liaison REV-EM ⇄ LexNote (scripts/prod/real-e2e.mjs, deux projets) et connexion automatique depuis un évènement REV-EM réel.
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';

const REF_URL = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/;
const jwtClaims = (t) => { try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); } catch { return {}; } };
export const SMOKE_DOMAIN = '@smoke.lexnote.invalid';

/** Garde-fous : renvoie { ref } ou lève une erreur SANS jamais citer une clé. */
export function assertSafeTarget(env) {
  const need = (k) => { if (!env[k]) throw new Error(`variable manquante : ${k}`); return env[k]; };
  if (env.SMOKE_CONFIRM !== '1') throw new Error('SMOKE_CONFIRM=1 requis : ce script crée et supprime des comptes sur un vrai projet');
  // Mode LOCAL (`supabase start` sur votre machine) : l'URL doit être une boucle locale ; pas de référence de projet à contrôler.
  if (env.SMOKE_LOCAL === '1') {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/?$/.test(need('SMOKE_SUPABASE_URL'))) throw new Error('SMOKE_LOCAL=1 : SMOKE_SUPABASE_URL doit être http://127.0.0.1:<port> ou http://localhost:<port>');
    if (jwtClaims(need('SMOKE_ANON_KEY')).role !== 'anon') throw new Error('SMOKE_ANON_KEY n\'est pas une clé anon');
    if (jwtClaims(need('SMOKE_SERVICE_ROLE_KEY')).role !== 'service_role') throw new Error('SMOKE_SERVICE_ROLE_KEY n\'est pas une clé service_role');
    return { ref: 'local' };
  }
  const m = REF_URL.exec(need('SMOKE_SUPABASE_URL')); if (!m) throw new Error('SMOKE_SUPABASE_URL doit être https://<réf>.supabase.co');
  const ref = m[1];
  if (need('SMOKE_EXPECTED_REF') !== ref) throw new Error('SMOKE_EXPECTED_REF ≠ référence de l\'URL : mauvais projet visé');
  const prod = need('SMOKE_PRODUCTION_REFS').split(',').map((s) => s.trim()).filter(Boolean);
  if (!prod.length) throw new Error('SMOKE_PRODUCTION_REFS vide : indiquez la/les références de production à protéger');
  if (prod.includes(ref)) throw new Error('REFUSÉ : ce projet est déclaré comme PRODUCTION');
  const anon = jwtClaims(need('SMOKE_ANON_KEY')); const svc = jwtClaims(need('SMOKE_SERVICE_ROLE_KEY'));
  if (anon.role !== 'anon') throw new Error('SMOKE_ANON_KEY n\'est pas une clé anon');
  if (svc.role !== 'service_role') throw new Error('SMOKE_SERVICE_ROLE_KEY n\'est pas une clé service_role');
  if (anon.ref !== ref || svc.ref !== ref) throw new Error('une clé n\'appartient pas au projet visé (claim ref différent)');
  return { ref };
}

export async function run(env, { log = console.log, fetchImpl = fetch } = {}) {
  const { ref } = assertSafeTarget(env);
  const url = env.SMOKE_SUPABASE_URL.replace(/\/$/, ''); const anon = env.SMOKE_ANON_KEY; const svc = env.SMOKE_SERVICE_ROLE_KEY;
  const results = [];
  const mask = (s) => [anon, svc].reduce((x, k) => x.replaceAll(k, '‹clé›'), String(s));
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); log(`${ok ? 'PASS' : 'FAIL'} — ${name}${ok || !detail ? '' : `  [${mask(detail).slice(0, 160)}]`}`); };
  const call = async (path, { method = 'GET', key = anon, token, body, headers = {} } = {}) => {
    const r = await fetchImpl(`${url}${path}`, { method, headers: { apikey: key, authorization: `Bearer ${token ?? key}`, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* corps non JSON */ }
    return { status: r.status, json: j };
  };
  const admin = (path, o = {}) => call(path, { ...o, key: svc });

  // Projet « vide » : un projet contenant beaucoup de comptes réels est probablement la production.
  const existing = await admin('/auth/v1/admin/users?per_page=50');
  const users = existing.json?.users ?? [];
  const foreign = users.filter((u) => !String(u.email ?? '').endsWith(SMOKE_DOMAIN));
  if (existing.status !== 200) throw new Error(`impossible de lister les comptes (HTTP ${existing.status}) : clé de service invalide ?`);
  if (foreign.length > Number(env.SMOKE_MAX_USERS ?? 10)) throw new Error(`REFUSÉ : ${foreign.length} comptes non-jetables présents (> SMOKE_MAX_USERS) — projet de production ?`);
  log(`Cible : ${ref === 'local' ? 'Supabase LOCAL' : `projet de TEST ${ref}`} (${foreign.length} compte(s) existant(s), conservés intacts)`);

  const created = [];
  const mk = async (tag) => {
    const email = `smoke-${tag}-${randomBytes(4).toString('hex')}${SMOKE_DOMAIN}`; const password = randomBytes(18).toString('base64url');
    const r = await admin('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } });
    if (r.status !== 200 && r.status !== 201) throw new Error(`création du compte ${tag} impossible (HTTP ${r.status})`);
    created.push(r.json.id);
    const s = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    return { id: r.json.id, email, password, token: s.json?.access_token, refresh: s.json?.refresh_token, status: s.status };
  };
  try {
    const h = await call('/functions/v1/health');
    check('health : fonction publique déployée, base joignable', h.status === 200 && h.json?.services?.database === 'ok', `HTTP ${h.status}`);
    check('health : schéma complet (toutes les migrations)', h.json?.services?.schema === 'ok', JSON.stringify(h.json?.missing ?? h.json?.services ?? ''));
    check('health : aucune donnée sensible exposée', !/eyJ|secret|service_role|@/.test(JSON.stringify(h.json ?? {})));

    const A = await mk('a'); const B = await mk('b');
    check('AUTH — connexion de A et B', A.status === 200 && !!A.token && B.status === 200 && !!B.token, `${A.status}/${B.status}`);
    const prof = await admin(`/rest/v1/profiles?id=eq.${A.id}&select=id`);
    check('AUTH — profil créé automatiquement à l\'inscription', prof.json?.length === 1);
    const user = await call('/auth/v1/user', { token: A.token });
    check('AUTH — le jeton de A identifie A', user.json?.id === A.id);
    const anonRead = await call('/rest/v1/subjects?select=id');
    check('RLS — sans connexion : aucune donnée', anonRead.status === 401 || (anonRead.status === 200 && anonRead.json?.length === 0), `HTTP ${anonRead.status}`);

    const sid = randomUUID();
    const ins = await call('/rest/v1/subjects', { method: 'POST', token: A.token, headers: { prefer: 'return=representation' }, body: { id: sid, name: 'Smoke — matière jetable' } });
    check('DONNÉES — A crée une matière', ins.status === 201 && ins.json?.[0]?.version === 1, `HTTP ${ins.status} ${JSON.stringify(ins.json ?? '').slice(0, 80)}`);
    const readB = await call(`/rest/v1/subjects?id=eq.${sid}&select=id`, { token: B.token });
    check('RLS — B ne voit pas la matière de A', readB.status === 200 && readB.json?.length === 0);
    const upd = await call(`/rest/v1/subjects?id=eq.${sid}`, { method: 'PATCH', token: B.token, headers: { prefer: 'return=representation' }, body: { name: 'piraté' } });
    check('RLS — B ne peut pas modifier la matière de A', (upd.json ?? []).length === 0, `HTTP ${upd.status}`);
    const usurp = await call('/rest/v1/subjects', { method: 'POST', token: B.token, body: { id: randomUUID(), user_id: A.id, name: 'usurpation' } });
    check('RLS — B ne peut pas écrire au nom de A', usurp.status >= 400, `HTTP ${usurp.status}`);
    const up2 = await call(`/rest/v1/subjects?id=eq.${sid}`, { method: 'PATCH', token: A.token, headers: { prefer: 'return=representation' }, body: { name: 'Smoke — v2' } });
    check('DONNÉES — la version serveur s\'incrémente (curseur de synchronisation)', up2.json?.[0]?.version === 2, JSON.stringify(up2.json ?? '').slice(0, 80));
    for (const fn of ['study_ai_acquire', 'app_health', 'integration_revoke_link']) {
      const rpc = await call(`/rest/v1/rpc/${fn}`, { method: 'POST', token: A.token, body: {} });
      check(`SÉCURITÉ — la fonction ${fn} n'est pas appelable par un utilisateur`, [401, 403, 404].includes(rpc.status), `HTTP ${rpc.status}`);
    }
    // --- SESSION : rafraîchissement, persistance, déconnexion locale (autres appareils épargnés) puis globale
    const r1 = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: A.refresh } });
    check('SESSION — un jeton de rafraîchissement valide donne une nouvelle session (scénario « refresh token valide »)', r1.status === 200 && !!r1.json?.access_token && !!r1.json?.refresh_token, `HTTP ${r1.status}`);
    const r2 = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: r1.json?.refresh_token } });
    check('SESSION — session persistante : le jeton renouvelé se renouvelle à son tour (usage prolongé, appareil de confiance)', r2.status === 200 && !!r2.json?.refresh_token, `HTTP ${r2.status}`);
    const sec = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: A.email, password: A.password } });   // 2e appareil
    check('SESSION — 2e appareil du même compte connecté', sec.status === 200 && !!sec.json?.refresh_token);
    const lo = await call('/auth/v1/logout?scope=local', { method: 'POST', token: r2.json?.access_token });
    const afterLocal1 = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: r2.json?.refresh_token } });
    const afterLocal2 = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: sec.json?.refresh_token } });
    check('SESSION — déconnexion LOCALE : cet appareil est déconnecté, l\'autre appareil reste connecté (vraie session expirée seulement ici)', lo.status < 300 && afterLocal1.status >= 400 && afterLocal2.status === 200, `${lo.status}/${afterLocal1.status}/${afterLocal2.status}`);
    const tok2 = afterLocal2.json?.access_token;
    const out = await call('/auth/v1/logout?scope=global', { method: 'POST', token: tok2 });
    const reuse = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: afterLocal2.json?.refresh_token } });
    check('SESSION — déconnexion GLOBALE : plus aucun jeton de rafraîchissement ne fonctionne (vraie session expirée)', out.status < 300 && reuse.status >= 400, `${out.status}/${reuse.status}`);
    const after = await admin(`/rest/v1/subjects?id=eq.${sid}&select=id`);
    check('DONNÉES — la matière de A survit aux déconnexions', after.json?.length === 1);

    // --- DONNÉES : suppression « douce » (ce que fait l'application) et visibilité
    const A2 = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: A.email, password: A.password } });
    const del = await call(`/rest/v1/subjects?id=eq.${sid}`, { method: 'PATCH', token: A2.json?.access_token, headers: { prefer: 'return=representation' }, body: { deleted_at: new Date().toISOString() } });
    check('DONNÉES — suppression douce (deleted_at) acceptée pour le propriétaire', del.json?.[0]?.deleted_at != null, `HTTP ${del.status}`);
    const pull = await call(`/rest/v1/subjects?select=id,deleted_at&server_updated_at=gte.1970-01-01`, { token: A2.json?.access_token });
    check('DONNÉES — l\'autre appareil voit la suppression au prochain tirage (pierre tombale conservée)', (pull.json ?? []).some((r) => r.id === sid && r.deleted_at));

    // --- INSCRIPTION PUBLIQUE (si la confirmation par e-mail est désactivée sur le projet de test)
    const pubEmail = `smoke-pub-${randomBytes(4).toString('hex')}${SMOKE_DOMAIN}`;
    const su = await call('/auth/v1/signup', { method: 'POST', body: { email: pubEmail, password: randomBytes(18).toString('base64url') } });
    if (su.json?.id) created.push(su.json.id); else if (su.json?.user?.id) created.push(su.json.user.id);
    if (su.json?.access_token) check('AUTH — inscription publique : session immédiate (confirmation e-mail désactivée sur ce projet de test)', true);
    else log(`INFO — inscription publique non testable de bout en bout (HTTP ${su.status} : confirmation e-mail activée ou domaine refusé) — l'inscription est couverte par la création administrateur ci-dessus`);
  } finally {
    for (const id of created) await admin(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
    const left = await admin('/auth/v1/admin/users?per_page=50');
    const remaining = (left.json?.users ?? []).filter((u) => created.includes(u.id));
    check('NETTOYAGE — comptes jetables supprimés', remaining.length === 0, `${remaining.length} restant(s)`);
  }
  const failed = results.filter((r) => !r.ok);
  log(`\n${results.length - failed.length}/${results.length} contrôles réussis`);
  if (env.WITH_INTEGRATION === '1') log('Intégration : lancer scripts/prod/real-e2e.mjs (deux projets de test) — non enchaînée automatiquement.');
  return failed.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = { ...process.env, WITH_INTEGRATION: process.argv.includes('--with-integration') ? '1' : '' };
  try { assertSafeTarget(env); } catch (e) { console.error(`REFUSÉ : ${e.message}`); process.exit(2); }
  run(env).then((c) => process.exit(c), (e) => { console.error(`ERREUR : ${String(e.message).slice(0, 200)}`); process.exit(2); });
}
