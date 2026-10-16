#!/usr/bin/env node
// DIAGNOSTIC de la liaison REV-EM ⇄ LexNote : passerelles déployées, signature HMAC, identifiant de clé (kid), décalage d'horloge, URLs/CORS.
// Envoie seulement des messages STATUS signés pour une liaison inexistante (aucune écriture, aucune donnée réelle) ; n'affiche JAMAIS la clé.
//
//   INTEGRATION_KEY  INTEGRATION_KEY_ID (défaut k1)
//   LEXNOTE_SUPABASE_URL  REVEM_SUPABASE_URL          (au moins un des deux)
//   LEXNOTE_ORIGIN / REVEM_ORIGIN                      (défauts : origines officielles)
//   node scripts/prod/integration-diagnostic.mjs      → code 0 si aucun FAIL
// Chaque anomalie porte un code d'erreur (INT-…) documenté dans docs/PRODUCTION_RUNBOOK.md §Codes d'erreur.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const loadBundle = () => import(pathToFileURL(join(here, '..', '..', 'supabase', 'functions', '_shared', 'integration', 'lexnote-revem-v1.mjs')).href);
export const REASON_CODES = {
  'unknown-key': ['INT-KID-401', 'identifiant de clé (kid) inconnu de la passerelle : INTEGRATION_KEY_ID ou INTEGRATION_KEYS différents des deux côtés'],
  'bad-signature': ['INT-HMAC-401', 'signature refusée : INTEGRATION_KEY différente entre les deux projets (ou mal copiée, espace/retour à la ligne)'],
  expired: ['INT-CLOCK-401', 'horodatage refusé : horloge du serveur ou de cette machine décalée de plus de quelques minutes'],
  'unknown-sender': ['INT-PEER-401', 'expéditeur inconnu : passerelle configurée pour un autre partenaire (INTEGRATION_PEER_REF / environnement)'],
  'wrong-recipient': ['INT-PEER-401', 'destinataire inattendu : les projets lexnote / revem sont inversés'],
  replay: ['INT-REPLAY-401', 'nonce déjà vu'],
  'missing-header': ['INT-HDR-401', 'en-têtes de signature absents (proxy qui les supprime ?)'],
};

export async function diagnose(env, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const I = await loadBundle();
  const out = []; const add = (level, id, msg) => out.push({ level, id, msg });
  const key = env.INTEGRATION_KEY; const kid = env.INTEGRATION_KEY_ID || 'k1';
  const mask = (s) => (key ? String(s).replaceAll(key, '‹clé›') : String(s));
  if (!key) { add('FAIL', 'INT-CONFIG', 'INTEGRATION_KEY absente de l’environnement'); return out; }
  if (key.length < 32) add('FAIL', 'INT-CONFIG', 'INTEGRATION_KEY trop courte (< 32 caractères)');
  const targets = [
    env.LEXNOTE_SUPABASE_URL && { self: 'lexnote', sender: 'revem', url: env.LEXNOTE_SUPABASE_URL.replace(/\/$/, ''), origin: env.LEXNOTE_ORIGIN || 'https://lex-note-svfr.vercel.app' },
    env.REVEM_SUPABASE_URL && { self: 'revem', sender: 'lexnote', url: env.REVEM_SUPABASE_URL.replace(/\/$/, ''), origin: env.REVEM_ORIGIN || 'https://antsvfr.github.io' },
  ].filter(Boolean);
  if (!targets.length) { add('FAIL', 'INT-CONFIG', 'aucune URL de projet (LEXNOTE_SUPABASE_URL / REVEM_SUPABASE_URL)'); return out; }

  for (const t of targets) {
    const gw = `${t.url}/functions/v1/integration-gateway`; const tag = t.self;
    let get; try { get = await fetchImpl(gw, { method: 'GET' }); } catch { add('FAIL', 'INT-GW-DOWN', `${tag} : passerelle injoignable`); continue; }
    if (get.status === 404) { add('FAIL', 'INT-GW-404', `${tag} : integration-gateway non déployée`); continue; }
    if (get.status === 401 && /jwt/i.test(await get.clone().text().catch(() => ''))) { add('FAIL', 'INT-GW-JWT', `${tag} : verify_jwt actif sur integration-gateway (redéployer avec --no-verify-jwt ; supabase/config.toml)`); continue; }
    add('PASS', 'INT-GW', `${tag} : passerelle déployée et joignable`);

    // décalage d'horloge : en-tête Date du serveur vs cette machine
    const date = get.headers.get('date');
    if (date) { const skew = Math.round((now().getTime() - new Date(date).getTime()) / 1000); add(Math.abs(skew) > 120 ? 'FAIL' : Math.abs(skew) > 30 ? 'WARN' : 'PASS', 'INT-CLOCK', `${tag} : décalage d’horloge ≈ ${skew} s (tolérance de la passerelle : quelques minutes)`); }

    // message STATUS légitime pour une liaison inexistante : une réponse métier 404 prouve que HMAC + kid + expéditeur sont corrects
    const payload = { integrationVersion: I.INTEGRATION_VERSION, kind: 'link-request', operation: 'STATUS', linkId: 'lnk_' + 'a'.repeat(30), senderReference: 'ref_' + 'b'.repeat(30) };
    const body = JSON.stringify(I.makeEnvelope({ from: t.sender, to: t.self, linkId: 'pairing', payload }));
    const headers = { 'content-type': 'application/json', ...(await I.signRequest({ body, from: t.sender, to: t.self, kid, secret: key })) };
    const res = await fetchImpl(gw, { method: 'POST', headers, body }); const j = await res.json().catch(() => null);
    const reason = j?.details?.reason;
    if (res.status === 404) add('PASS', 'INT-HMAC', `${tag} : signature HMAC, kid « ${kid} » et expéditeur acceptés`);
    else if (reason && REASON_CODES[reason]) add('FAIL', REASON_CODES[reason][0], `${tag} : ${REASON_CODES[reason][1]}`);
    else add('FAIL', 'INT-GW-UNEXPECTED', mask(`${tag} : réponse inattendue HTTP ${res.status}`));

    // URLs : l'origine officielle de l'autre application doit être autorisée (CORS) par integration-link
    const pre = await fetchImpl(`${t.url}/functions/v1/integration-link`, { method: 'OPTIONS', headers: { origin: t.origin, 'access-control-request-method': 'POST' } }).catch(() => null);
    if (!pre) add('FAIL', 'INT-LINK-DOWN', `${tag} : integration-link injoignable`);
    else if (pre.headers.get('access-control-allow-origin') === t.origin) add('PASS', 'INT-URL', `${tag} : origine ${t.origin} autorisée (APP_ORIGINS)`);
    else add('FAIL', 'INT-URL', `${tag} : origine ${t.origin} NON autorisée → corriger APP_ORIGINS du projet ${tag}`);
  }
  return out;
}

export async function main(env, log = console.log, deps = {}) {
  const r = await diagnose(env, deps);
  for (const x of r) log(`[${x.level}] ${x.id} — ${x.msg}`);
  return r.some((x) => x.level === 'FAIL') ? 1 : 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.env).then((c) => process.exit(c), (e) => { console.error(`ERREUR : ${String(e.message).slice(0, 200)}`); process.exit(2); });
