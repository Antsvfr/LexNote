#!/usr/bin/env node
// SMOKE TEST RÉEL de l'Edge Function `study-ai` (fournisseur IA réel, projet Supabase déployé).
// À lancer depuis VOTRE machine, APRÈS déploiement, idéalement d'abord sur un projet de pré-production.
// Par défaut : DRY-RUN (affiche le plan, n'appelle rien). Les appels réels sont PAYANTS : il faut SMOKE_CONFIRM=1.
// Aucune valeur secrète n'est affichée (jeton, mot de passe). Aucune clé du fournisseur IA n'est nécessaire ici : elle reste un secret serveur.
//
// Variables d'environnement :
//   LEXNOTE_SUPABASE_URL  LEXNOTE_ANON_KEY  (clé « anon » : publique par conception)
//   LEXNOTE_A_EMAIL  LEXNOTE_A_PASSWORD     compte de test confirmé (ses quotas study-ai seront consommés)
//   SMOKE_CONFIRM=1                         exécute réellement les appels (sinon : dry-run)
//   SMOKE_RATE_LIMIT=1                      rafale d'appels simultanés → attend un 429 « concurrent » (≈ 3 appels courts)
//   SMOKE_EXPECT_TIMEOUT=1                  projet configuré avec STUDY_AI_TIMEOUT_MS très bas → attend un 504 « timeout »
//   SMOKE_EXPECT_PROVIDER_ERROR=1           projet configuré avec une clé fournisseur invalide → attend un 503 propre, sans détail interne
//   SMOKE_EXPECT_DISABLED=1                 projet avec STUDY_AI_ENABLED=false (interrupteur d'urgence) → attend 503 ai_disabled pour tout le monde, aucun appel payant
//   SMOKE_EXPECT_CAPACITY=1                 projet dont le budget GLOBAL du jour est consommé (ex. STUDY_AI_GLOBAL_MAX_REQUESTS_DAY=1 après un 1er appel) → attend 503 ai_capacity + Retry-After
// Refus du modèle : non provocable de façon fiable et éthique sur un vrai modèle → SKIP ici ; couvert par les tests Deno (handler.test.ts).
//
// Usage : node scripts/prod/study-ai-smoke.mjs     (code de sortie 1 si un contrôle échoue)
import { fileURLToPath } from 'node:url';

const LINE = 'Le juge administratif contrôle la légalité des actes de l’administration ; le recours pour excès de pouvoir est ouvert même sans texte. ';
export const sample = (chars) => { let s = ''; let k = 0; while (s.length < chars) s += `${LINE}(${++k}) `; return s.slice(0, chars); };
const SHORT = sample(1800);

/** Contrôle minimal du JSON structuré renvoyé par le modèle (même forme que `parseModelDoc` côté application). */
export function validDoc(text) {
  try {
    const j = JSON.parse(text);
    return !!j && Array.isArray(j.blocks) && j.blocks.length > 0 && j.blocks.every((b) => b && typeof b.kind === 'string' && typeof b.text === 'string');
  } catch { return false; }
}

export const PLAN = [
  { id: 'unauth', title: 'sans jeton → 401', paid: false },
  { id: 'bad', title: 'tâche inconnue → 400', paid: false },
  { id: 'too-large', title: 'texte > 80 000 caractères → 413 (avec limite), sans appel au modèle', paid: false },
  { id: 'express', title: 'résumé express → 200, JSON structuré valide', paid: true },
  { id: 'detailed', title: 'résumé détaillé → 200, JSON structuré valide', paid: true },
  { id: 'translate', title: 'traduction (fr → en) → 200, JSON structuré valide', paid: true },
  { id: 'structure', title: 'structuration → 200, JSON structuré valide', paid: true },
  { id: 'long', title: 'transcription longue (~70 000 caractères, synthèse intermédiaire) → 200, non tronquée', paid: true },
  { id: 'rate', title: 'rafale simultanée → 429 « concurrent » + Retry-After', paid: true, flag: 'SMOKE_RATE_LIMIT' },
  { id: 'timeout', title: 'délai fournisseur dépassé → 504 « timeout »', paid: true, flag: 'SMOKE_EXPECT_TIMEOUT' },
  { id: 'provider', title: 'erreur fournisseur → 503 propre (aucun détail interne)', paid: true, flag: 'SMOKE_EXPECT_PROVIDER_ERROR' },
  { id: 'refusal', title: 'refus du modèle → 422 « refused », sans repli', paid: false, manual: 'non provocable de façon fiable sur un vrai modèle : couvert par supabase/functions/study-ai/handler.test.ts' },
];

export async function run(env, { log = console.log, fetchImpl = fetch } = {}) {
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); log(`${ok ? 'PASS' : 'FAIL'} — ${name}${ok || !detail ? '' : `  [${String(detail).slice(0, 200)}]`}`); };
  const skip = (name, why) => { results.push({ name, ok: true, skipped: true }); log(`SKIP — ${name} (${why})`); };
  const need = (k) => { if (!env[k]) throw new Error(`variable manquante : ${k}`); return env[k]; };

  if (env.SMOKE_CONFIRM !== '1') {
    log('DRY-RUN (aucun appel). Plan du smoke test study-ai :');
    for (const p of PLAN) log(`  - ${p.title}${p.paid ? ' [payant]' : ''}${p.flag ? ` [si ${p.flag}=1]` : ''}${p.manual ? ` [non automatisé : ${p.manual}]` : ''}`);
    log('Relancez avec SMOKE_CONFIRM=1 pour exécuter réellement (consomme des quotas et des crédits IA).');
    return { results, dryRun: true, ok: true };
  }

  const url = need('LEXNOTE_SUPABASE_URL').replace(/\/$/, ''); const anon = need('LEXNOTE_ANON_KEY');
  const r = await fetchImpl(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email: need('LEXNOTE_A_EMAIL'), password: need('LEXNOTE_A_PASSWORD') }) });
  const tj = await r.json().catch(() => ({}));
  if (!r.ok || !tj.access_token) throw new Error(`connexion impossible (HTTP ${r.status})`);
  const token = tj.access_token;                              // jamais journalisé

  const call = async (task, input, options = {}, { auth = true } = {}) => {
    const t0 = Date.now();
    const res = await fetchImpl(`${url}/functions/v1/study-ai`, {
      method: 'POST', headers: { apikey: anon, 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ task, input, options }),
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* corps non JSON */ }
    return { status: res.status, json, raw: text, retryAfter: res.headers.get('retry-after'), ms: Date.now() - t0 };
  };
  const brief = (x) => `${x.status} ${JSON.stringify(x.json?.error ?? '')} ${x.json?.reason ?? ''}`;
  const noLeak = (x) => !/anthropic_api_key|sk-ant|stack|at\s+\w+\s+\(/i.test(x.raw);

  // ---- interrupteur d'urgence : tout est refusé AVANT l'authentification et avant tout appel payant
  if (env.SMOKE_EXPECT_DISABLED === '1') {
    const anon1 = await call('summarize', SHORT, {}, { auth: false }); const authed = await call('summarize', SHORT, {});
    for (const [label, x] of [['sans jeton', anon1], ['avec jeton', authed]]) {
      check(`INTERRUPTEUR — ${label} : 503 ai_disabled, Retry-After présent, aucun détail interne`, x.status === 503 && x.json?.error === 'ai_disabled' && Number(x.retryAfter) > 0 && noLeak(x), brief(x));
    }
    for (const p of PLAN.slice(0, 11)) skip(p.title, 'SMOKE_EXPECT_DISABLED=1 : l\'IA est coupée');
    const f = results.filter((x) => !x.ok); log(`\n${results.filter((x) => x.ok && !x.skipped).length} PASS, ${f.length} FAIL`);
    return { results, ok: f.length === 0 };
  }

  // ---- gratuits (rejetés avant tout appel au modèle)
  const u = await call('summarize', SHORT, {}, { auth: false });
  check(PLAN[0].title, u.status === 401, brief(u));
  const b = await call('jailbreak', SHORT);
  check(PLAN[1].title, b.status === 400, brief(b));
  const big = await call('summarize', sample(80_001));
  check(PLAN[2].title, big.status === 413 && big.json?.limit === 80_000, brief(big));

  // ---- appels réels
  const structured = async (p, task, options) => {
    const x = await call(task, SHORT, { outputLanguage: 'fr', sourceLanguage: 'fr', ...options });
    check(`${p.title} (${x.ms} ms, modèle ${x.json?.model ?? '?'})`, x.status === 200 && typeof x.json?.text === 'string' && validDoc(x.json.text),
      x.status === 200 ? 'JSON structuré invalide ou vide' : brief(x));
  };
  const expecting = env.SMOKE_EXPECT_TIMEOUT || env.SMOKE_EXPECT_PROVIDER_ERROR || env.SMOKE_EXPECT_CAPACITY;
  if (!expecting) {
    await structured(PLAN[3], 'summarize', { mode: 'express' });
    await structured(PLAN[4], 'summarize', { mode: 'detailed' });
    await structured(PLAN[5], 'translate', { targetLanguage: 'en', outputLanguage: 'en' });
    await structured(PLAN[6], 'structure', {});
    const long = await call('digest', sample(70_000), { outputLanguage: 'fr', part: 1, parts: 2 });
    check(`${PLAN[7].title} (${long.ms} ms)`, long.status === 200 && typeof long.json?.text === 'string' && long.json.text.trim().length > 200, brief(long));
  } else {
    for (const p of PLAN.slice(3, 8)) skip(p.title, 'projet configuré pour provoquer une erreur');
  }

  if (env.SMOKE_RATE_LIMIT === '1') {
    const burst = await Promise.all([0, 1, 2, 3].map(() => call('digest', SHORT, { outputLanguage: 'fr' })));
    const limited = burst.find((x) => x.status === 429);
    check(PLAN[8].title, !!limited && limited.json?.error === 'rate_limited' && limited.json?.reason === 'concurrent' && Number(limited.retryAfter) > 0,
      burst.map((x) => x.status).join(','));
  } else skip(PLAN[8].title, 'SMOKE_RATE_LIMIT=1 non défini');

  if (env.SMOKE_EXPECT_TIMEOUT === '1') {
    const x = await call('summarize', SHORT, { mode: 'detailed', outputLanguage: 'fr' });
    check(PLAN[9].title, x.status === 504 && x.json?.error === 'timeout' && noLeak(x), brief(x));
  } else skip(PLAN[9].title, 'SMOKE_EXPECT_TIMEOUT=1 non défini (nécessite STUDY_AI_TIMEOUT_MS bas sur un projet de test)');

  if (env.SMOKE_EXPECT_PROVIDER_ERROR === '1') {
    const x = await call('summarize', SHORT, { mode: 'express', outputLanguage: 'fr' });
    check(PLAN[10].title, x.status === 503 && ['not_configured', 'unavailable', 'provider_busy'].includes(x.json?.error) && noLeak(x), brief(x));
  } else skip(PLAN[10].title, 'SMOKE_EXPECT_PROVIDER_ERROR=1 non défini (nécessite une clé fournisseur invalide sur un projet de test)');

  if (env.SMOKE_EXPECT_CAPACITY === '1') {
    const x = await call('summarize', SHORT, { mode: 'express', outputLanguage: 'fr' });
    check('budget GLOBAL consommé → 503 ai_capacity (pas 429), Retry-After, aucun détail interne', x.status === 503 && x.json?.error === 'ai_capacity' && Number(x.retryAfter) >= 1 && noLeak(x), brief(x));
  } else skip('budget GLOBAL consommé → 503 ai_capacity', 'SMOKE_EXPECT_CAPACITY=1 non défini');

  skip(PLAN[11].title, PLAN[11].manual);

  const failed = results.filter((x) => !x.ok);
  const skipped = results.filter((x) => x.skipped).length;
  log(`\n${results.length - failed.length - skipped} PASS, ${failed.length} FAIL, ${skipped} SKIP (un SKIP n'est PAS un succès)`);
  return { results, ok: failed.length === 0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run(process.env).then((r) => process.exit(r.ok ? 0 : 1), (e) => { console.error(`ERREUR — ${e.message}`); process.exit(1); });
}
