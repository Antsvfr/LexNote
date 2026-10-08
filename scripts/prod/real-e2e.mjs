#!/usr/bin/env node
// Test de bout en bout RÉEL (deux vrais projets Supabase déployés) + tests d'attaque sur les passerelles déployées.
// À lancer depuis VOTRE machine, après déploiement. Aucune valeur secrète n'est jamais affichée (jetons, clé d'intégration, mots de passe).
//
// Variables d'environnement (toutes obligatoires sauf mention) :
//   LEXNOTE_SUPABASE_URL  LEXNOTE_ANON_KEY       REVEM_SUPABASE_URL  REVEM_ANON_KEY        (clés « anon » : publiques par conception)
//   REVEM_A_EMAIL REVEM_A_PASSWORD  REVEM_B_EMAIL REVEM_B_PASSWORD  LEXNOTE_A_EMAIL LEXNOTE_A_PASSWORD  LEXNOTE_B_EMAIL LEXNOTE_B_PASSWORD
//   INTEGRATION_KEY       clé partagée (pour forger des messages SIGNÉS et vérifier que les attaques échouent quand même) ; INTEGRATION_KEY_ID (défaut k1)
//   LEXNOTE_ORIGIN / REVEM_ORIGIN   (défauts : origines officielles)
//   WAIT_EXPIRY=1         attend 5 min 5 s pour tester une intention réellement expirée (sinon : SKIPPED)
//   CHECK_DELETE_ACCOUNT=1  vérifie le CORS de delete-account (requêtes OPTIONS uniquement : rien n'est supprimé)
// Les comptes de test A/B doivent exister, être confirmés, et NE PAS être déjà liés l'un à l'autre.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export async function loadBundle() { return import(join(here, '..', '..', 'supabase', 'functions', '_shared', 'integration', 'lexnote-revem-v1.mjs')); }

export async function run(env, { log = console.log, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const I = await loadBundle();
  const results = [];
  const mask = (s) => String(s).replaceAll(env.INTEGRATION_KEY ?? '\u0000', '‹clé›');
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); log(`${ok ? 'PASS' : 'FAIL'} — ${name}${ok || !detail ? '' : `  [${mask(detail).slice(0, 200)}]`}`); };
  const skip = (name, why) => { results.push({ name, ok: true, skipped: true }); log(`SKIP — ${name} (${why})`); };
  const need = (k) => { if (!env[k]) throw new Error(`variable manquante : ${k}`); return env[k]; };

  const P = {
    lex: { url: need('LEXNOTE_SUPABASE_URL').replace(/\/$/, ''), anon: need('LEXNOTE_ANON_KEY'), origin: env.LEXNOTE_ORIGIN || 'https://lex-note-svfr.vercel.app', self: 'lexnote' },
    rev: { url: need('REVEM_SUPABASE_URL').replace(/\/$/, ''), anon: need('REVEM_ANON_KEY'), origin: env.REVEM_ORIGIN || 'https://antsvfr.github.io', self: 'revem' },
  };
  const key = need('INTEGRATION_KEY'); const kid = env.INTEGRATION_KEY_ID || 'k1';

  const login = async (p, who) => {
    const r = await fetchImpl(`${p.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: p.anon, 'content-type': 'application/json' }, body: JSON.stringify({ email: need(`${who}_EMAIL`), password: need(`${who}_PASSWORD`) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`connexion impossible pour ${who} (HTTP ${r.status})`);
    return j.access_token;                                  // jamais journalisé
  };
  const tok = { rA: await login(P.rev, 'REVEM_A'), rB: await login(P.rev, 'REVEM_B'), lA: await login(P.lex, 'LEXNOTE_A'), lB: await login(P.lex, 'LEXNOTE_B') };

  const link = async (p, token, body, origin = p.origin) => {
    const r = await fetchImpl(`${p.url}/functions/v1/integration-link`, { method: 'POST', headers: { apikey: p.anon, authorization: `Bearer ${token}`, 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null), acao: r.headers.get('access-control-allow-origin') };
  };
  const parse = (confirmUrl) => { const u = new URL(confirmUrl); return { intent: u.searchParams.get('intent'), nonce: u.hash.replace('#n=', '') }; };
  const errCode = (r) => r.json?.error?.code;

  // ---- État initial : on part d'un état propre (révoque d'éventuelles liaisons de test précédentes) ----
  for (const [p, t] of [[P.rev, tok.rA], [P.rev, tok.rB], [P.lex, tok.lA], [P.lex, tok.lB]]) await link(p, t, { action: 'revoke' });

  // =============== Scénario A : REV-EM A ↔ LexNote A ===============
  log('\n── Scénario A ──');
  const sA = await link(P.rev, tok.rA, { action: 'start' });
  check('A : REV-EM crée l’intention (HTTP 200, URL LexNote officielle)', sA.status === 200 && sA.json?.confirmUrl?.startsWith(P.lex.origin + '/integrations/revem/connect?intent='), `${sA.status} ${JSON.stringify(sA.json?.error ?? '')}`);
  const a = sA.json?.confirmUrl ? parse(sA.json.confirmUrl) : { intent: '', nonce: '' };
  check('A : le nonce est dans le fragment, pas dans la requête', !!a.nonce && !new URL(sA.json.confirmUrl).search.includes(a.nonce));
  const iA = await link(P.lex, tok.lA, { action: 'inspect', linkIntentId: a.intent, nonce: a.nonce });
  check('A : LexNote inspecte la demande (nom du compte REV-EM affiché)', iA.status === 200 && typeof iA.json?.displayHint === 'string', `${iA.status} ${JSON.stringify(iA.json?.error ?? '')}`);

  // Intention de B créée pendant que celle de A est ouverte (attaques croisées)
  const sB = await link(P.rev, tok.rB, { action: 'start' });
  const b = sB.json?.confirmUrl ? parse(sB.json.confirmUrl) : { intent: '', nonce: '' };
  check('B : REV-EM crée l’intention de B', sB.status === 200 && !!b.intent);

  const x1 = await link(P.lex, tok.lB, { action: 'confirm', linkIntentId: a.intent, nonce: b.nonce });
  check('ATTAQUE — B (LexNote) utilise l’intention de A avec son propre nonce → refusé', x1.status === 403 && errCode(x1) === 'FORBIDDEN', `${x1.status} ${errCode(x1)}`);
  const x2 = await link(P.lex, tok.lA, { action: 'confirm', linkIntentId: b.intent, nonce: a.nonce });
  check('ATTAQUE — A (LexNote) utilise l’intention de B avec le nonce de A → refusé', x2.status === 403 && errCode(x2) === 'FORBIDDEN', `${x2.status} ${errCode(x2)}`);
  const x3 = await link(P.lex, tok.lA, { action: 'confirm', linkIntentId: a.intent, nonce: 'x'.repeat(43) });
  check('ATTAQUE — nonce deviné → refusé, et l’intention de A n’est pas consommée', x3.status === 403, `${x3.status}`);

  const cA = await link(P.lex, tok.lA, { action: 'confirm', linkIntentId: a.intent, nonce: a.nonce });
  check('A : LexNote A autorise → CONNECTED vérifié', cA.status === 200 && cA.json?.state?.state === 'CONNECTED' && cA.json.state.verified === true, `${cA.status} ${JSON.stringify(cA.json?.error ?? '')}`);
  check('A : returnUrl pointe vers REV-EM officiel', (cA.json?.returnUrl ?? '').startsWith('https://antsvfr.github.io/REV-EM/') && (cA.json?.returnUrl ?? '').includes('lexnote_link=connected'), cA.json?.returnUrl);
  const rA = await link(P.rev, tok.rA, { action: 'status', probe: true });
  check('A : REV-EM « Vérifier » → CONNECTED vérifié des deux côtés', rA.json?.state?.state === 'CONNECTED' && rA.json.state.verified && rA.json.state.peerStatus === 'CONNECTED', JSON.stringify(rA.json?.state ?? rA.json));
  const lA = await link(P.lex, tok.lA, { action: 'status', probe: true });
  check('A : LexNote affiche REV-EM connecté', lA.json?.state?.state === 'CONNECTED' && lA.json.state.verified, JSON.stringify(lA.json?.state ?? lA.json));
  check('A : même integrationLinkId des deux côtés', !!rA.json?.state?.linkId && rA.json.state.linkId === lA.json?.state?.linkId);
  const x4 = await link(P.lex, tok.lB, { action: 'confirm', linkIntentId: a.intent, nonce: a.nonce });
  check('ATTAQUE — intention de A déjà consommée → refusée (même avec le bon nonce, par B)', x4.status === 410 && errCode(x4) === 'GONE', `${x4.status} ${errCode(x4)}`);

  // =============== Scénario B : REV-EM B ↔ LexNote B ===============
  log('\n── Scénario B ──');
  const cB = await link(P.lex, tok.lB, { action: 'confirm', linkIntentId: b.intent, nonce: b.nonce });
  check('B : LexNote B autorise → CONNECTED vérifié', cB.status === 200 && cB.json?.state?.state === 'CONNECTED' && cB.json.state.verified, `${cB.status} ${JSON.stringify(cB.json?.error ?? '')}`);
  const rB = await link(P.rev, tok.rB, { action: 'status', probe: true }); const lB = await link(P.lex, tok.lB, { action: 'status', probe: true });
  check('B : les deux côtés CONNECTED', rB.json?.state?.state === 'CONNECTED' && lB.json?.state?.state === 'CONNECTED');
  check('A ≠ B : liaisons distinctes', rA.json?.state?.linkId !== rB.json?.state?.linkId);

  // Isolation base : A ne voit que sa ligne et jamais les références (PostgREST direct avec le JWT de A)
  for (const [p, t, mine, other, label] of [[P.rev, tok.rA, rA.json?.state?.linkId, rB.json?.state?.linkId, 'REV-EM'], [P.lex, tok.lA, lA.json?.state?.linkId, lB.json?.state?.linkId, 'LexNote']]) {
    const rest = await fetchImpl(`${p.url}/rest/v1/integration_links?select=link_id,status`, { headers: { apikey: p.anon, authorization: `Bearer ${t}` } });
    const rows = await rest.json().catch(() => []);
    check(`ISOLATION ${label} — A (PostgREST) ne voit que sa liaison`, rest.ok && Array.isArray(rows) && rows.length === 1 && rows[0].link_id === mine && !rows.some((r) => r.link_id === other), `${rest.status} ${JSON.stringify(rows).slice(0, 120)}`);
    const refs = await fetchImpl(`${p.url}/rest/v1/integration_links?select=local_reference,external_reference`, { headers: { apikey: p.anon, authorization: `Bearer ${t}` } });
    check(`ISOLATION ${label} — les pseudonymes ne sont pas lisibles`, refs.status === 401 || refs.status === 403, `${refs.status}`);
    for (const tbl of ['integration_link_intents', 'integration_nonces']) { const r = await fetchImpl(`${p.url}/rest/v1/${tbl}?select=*`, { headers: { apikey: p.anon, authorization: `Bearer ${t}` } }); const j = await r.json().catch(() => []); check(`ISOLATION ${label} — ${tbl} inaccessible`, r.status === 401 || r.status === 403 || (r.ok && Array.isArray(j) && j.length === 0), `${r.status}`); }
    const w = await fetchImpl(`${p.url}/rest/v1/integration_links?link_id=eq.${other}`, { method: 'PATCH', headers: { apikey: p.anon, authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'REVOKED' }) });
    check(`ISOLATION ${label} — A ne peut pas révoquer la liaison de B via l’API de données`, w.status === 401 || w.status === 403 || w.status === 404, `${w.status}`);
    const rpc = await fetchImpl(`${p.url}/rest/v1/rpc/integration_revoke_link`, { method: 'POST', headers: { apikey: p.anon, authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_link_id: other, p_partner_ref: null, p_by: 'self' }) });
    check(`ISOLATION ${label} — la fonction SQL integration_revoke_link n’est pas appelable depuis un navigateur`, rpc.status === 401 || rpc.status === 403 || rpc.status === 404, `${rpc.status}`);
  }
  // A ne peut pas lire/utiliser l'état de B en fournissant son identifiant : l'identité vient du jeton
  const spoof = await link(P.rev, tok.rA, { action: 'status', linkId: rB.json?.state?.linkId, userId: 'x' });
  check('ISOLATION — status avec un linkId de B fourni par A : renvoie l’état de A', spoof.json?.state?.linkId === rA.json?.state?.linkId);

  // =============== Attaques sur les passerelles DÉPLOYÉES ===============
  log('\n── Attaques sur les passerelles déployées ──');
  for (const [target, sender] of [[P.rev, 'lexnote'], [P.lex, 'revem']]) {
    const gw = `${target.url}/functions/v1/integration-gateway`; const tag = target.self === 'revem' ? 'passerelle REV-EM' : 'passerelle LexNote';
    const payload = { integrationVersion: I.INTEGRATION_VERSION, kind: 'link-request', operation: 'STATUS', linkId: 'lnk_' + 'a'.repeat(30), senderReference: 'ref_' + 'b'.repeat(30) };
    const forge = async (o = {}) => {
      const from = o.from ?? sender; const to = o.to ?? target.self;
      const body = o.body ?? JSON.stringify(I.makeEnvelope({ from: sender, to: target.self, linkId: 'pairing', payload }));
      const h = await I.signRequest({ body, from, to, kid: o.kid ?? kid, secret: o.secret ?? key, now: o.now, nonce: o.nonce });
      if (o.mutate) o.mutate(h);
      return { body, headers: { 'content-type': 'application/json', ...h, ...(o.origin ? { origin: o.origin } : {}) } };
    };
    const send = async (r) => { const res = await fetchImpl(gw, { method: 'POST', headers: r.headers, body: r.body }); const j = await res.json().catch(() => null); return { status: res.status, reason: j?.details?.reason, code: j?.code ?? j?.payload?.code }; };
    const expectDeny = (name, r, reason, statuses = [401, 403]) => check(`ATTAQUE ${tag} — ${name}`, statuses.includes(r.status) && (!reason || r.reason === reason), `HTTP ${r.status} raison=${r.reason}`);

    const ok = await send(await forge());
    check(`${tag} — message légitime signé : authentifié (réponse métier 404 « liaison inconnue », pas 401)`, ok.status === 404, `HTTP ${ok.status} raison=${ok.reason}`);
    const first = await forge(); const copy = { body: first.body, headers: { ...first.headers } };
    await send(first); expectDeny('nonce rejoué (message identique)', await send(copy), 'replay');
    expectDeny('signature modifiée', await send(await forge({ mutate: (h) => { h['x-lnrv-signature'] = h['x-lnrv-signature'].slice(0, -2) + 'AA'; } })), 'bad-signature');
    const good = await forge(); expectDeny('payload modifié après signature', await send({ headers: good.headers, body: good.body.replace('STATUS', 'REVOKE') }), 'payload-hash');
    expectDeny('timestamp trop ancien (10 min), pourtant signé avec la bonne clé', await send(await forge({ now: new Date(Date.now() - 600_000) })), 'expired');
    expectDeny('timestamp dans le futur (10 min)', await send(await forge({ now: new Date(Date.now() + 600_000) })), 'expired');
    expectDeny('mauvais expéditeur (signé comme étant ' + target.self + ' lui-même)', await send(await forge({ from: target.self, to: sender })), 'unknown-sender');
    expectDeny('mauvais destinataire', await send(await forge({ to: sender })), 'wrong-recipient');
    expectDeny('mauvais identifiant de clé', await send(await forge({ kid: 'k-inconnue' })), 'unknown-key');
    expectDeny('mauvaise clé (secret différent)', await send(await forge({ secret: 'z'.repeat(48) })), 'bad-signature');
    expectDeny('appelée depuis un navigateur (Origin officiel) avec message signé', await send(await forge({ origin: P.lex.origin })), 'browser-origin');
    expectDeny('appelée depuis un navigateur sans signature', await send({ headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' }));
    expectDeny('requête sans aucune signature (hors navigateur)', await send({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }), 'missing-header');
    const huge = await send({ headers: (await forge()).headers, body: 'x'.repeat(20000) }); check(`ATTAQUE ${tag} — corps de 20 Ko refusé`, huge.status === 400, `HTTP ${huge.status}`);
    const get = await fetchImpl(gw, { method: 'GET' }); check(`ATTAQUE ${tag} — GET refusé`, get.status >= 400 && get.status < 500, `HTTP ${get.status}`);
  }

  // =============== CORS des fonctions appelées par un navigateur ===============
  log('\n── CORS ──');
  for (const [p, fn] of [[P.rev, 'integration-link'], [P.lex, 'integration-link'], ...(env.CHECK_DELETE_ACCOUNT === '1' ? [[P.lex, 'delete-account']] : [])]) {
    const pre = (origin) => fetchImpl(`${p.url}/functions/v1/${fn}`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
    const good = await pre(p.origin); const evil = await pre('https://evil.example'); const near = await pre(p.origin + '.evil.io'); const star = await pre('null');
    check(`CORS ${fn} (${p.self}) — origine officielle : écho exact`, good.headers.get('access-control-allow-origin') === p.origin, good.headers.get('access-control-allow-origin'));
    for (const [n, r] of [['origine inconnue', evil], ['domaine ressemblant', near], ['origine « null »', star]]) check(`CORS ${fn} (${p.self}) — ${n} : aucune autorisation`, !r.headers.get('access-control-allow-origin') && r.status !== 200, `${r.status} ${r.headers.get('access-control-allow-origin')}`);
    check(`CORS ${fn} (${p.self}) — jamais « * »`, ![good, evil, near, star].some((r) => r.headers.get('access-control-allow-origin') === '*'));
  }
  const noTok = await fetchImpl(`${P.lex.url}/functions/v1/integration-link`, { method: 'POST', headers: { apikey: P.lex.anon, 'content-type': 'application/json', origin: P.lex.origin }, body: JSON.stringify({ action: 'start' }) });
  check('ATTAQUE — integration-link sans jeton utilisateur → refusé', noTok.status === 401, `HTTP ${noTok.status}`);

  // =============== Intention expirée ===============
  log('\n── Intention expirée ──');
  await link(P.rev, tok.rA, { action: 'revoke' });                                    // A est encore lié : on libère le compte avant de tester une nouvelle intention
  if (env.WAIT_EXPIRY === '1') {
    const e = await link(P.rev, tok.rA, { action: 'start' }); const ex = parse(e.json.confirmUrl);
    log('attente de 5 min 5 s…'); await sleep(305_000);
    const r = await link(P.lex, tok.lA, { action: 'confirm', linkIntentId: ex.intent, nonce: ex.nonce });
    check('ATTAQUE — intention expirée (5 min) → refusée', r.status === 410 && errCode(r) === 'LINK_EXPIRED', `${r.status} ${errCode(r)}`);
  } else skip('intention expirée (5 min)', 'WAIT_EXPIRY=1 pour attendre 5 min ; couverte par SQL (tests/db) et par les tests simulés');

  // =============== Révocation ===============
  log('\n── Révocation ──');
  const rv = await link(P.rev, tok.rB, { action: 'revoke' });
  check('B : révocation depuis REV-EM → notifie LexNote', rv.status === 200 && rv.json?.state?.state === 'REVOKED' && rv.json.peerNotified === true, `${rv.status} ${JSON.stringify(rv.json?.error ?? '')}`);
  const lAfter = await link(P.lex, tok.lB, { action: 'status', probe: true });
  check('B : LexNote constate la révocation (révoquée par le partenaire)', lAfter.json?.state?.state === 'REVOKED' && lAfter.json.state.revokedBy === 'partner', JSON.stringify(lAfter.json?.state ?? lAfter.json));
  const rAfter = await link(P.rev, tok.rB, { action: 'status', probe: true });
  check('B : REV-EM n’affiche plus « Connecté »', rAfter.json?.state?.state === 'REVOKED');
  const lA2 = await link(P.lex, tok.lA, { action: 'status', probe: true });
  check('A (déjà révoqué avant) reste cohérent des deux côtés', lA2.json?.state?.state === 'REVOKED' || lA2.json?.state?.state === 'NOT_CONNECTED');

  const fails = results.filter((r) => !r.ok).length;
  log(`\n${results.filter((r) => r.ok && !r.skipped).length} PASS, ${results.filter((r) => r.skipped).length} SKIP, ${fails} FAIL`);
  return { results, fails };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run(process.env).then(({ fails }) => process.exit(fails ? 1 : 0)).catch((e) => { console.error(`ERREUR : ${e.message}`); process.exit(2); });
}
