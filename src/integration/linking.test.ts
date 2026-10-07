// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KEY, EMAIL, U, makeWorld, type World } from './testkit';
import { H } from './signing';
import { handleGatewayRequest } from './gateway';
import { findSecrets } from './security';
import { INTEGRATION_VERSION, makeEnvelope, signRequest, readIntegrationConfig } from './index';

let w: World;
beforeAll(async () => { w = await makeWorld(); }, 60_000);
beforeEach(async () => { await w.reset(); });

const intentOf = (confirmUrl: string) => { const u = new URL(confirmUrl); return { intent: u.searchParams.get('intent')!, nonce: u.hash.replace('#n=', '') }; };
async function start(ru: string) { const s = await w.userReq('R', ru, { action: 'start' }); return { s, ...(s.json.confirmUrl ? intentOf(s.json.confirmUrl) : { intent: '', nonce: '' }) }; }
const confirm = (lu: string, intent: string, nonce: string) => w.userReq('L', lu, { action: 'confirm', linkIntentId: intent, nonce });
async function link(ru: string, lu: string) { const st = await start(ru); const c = await confirm(lu, st.intent, st.nonce); return { ...st, c }; }
const state = async (side: 'R' | 'L', user: string, probe = true) => (await w.userReq(side, user, { action: 'status', probe })).json.state;
const rows = async (side: 'R' | 'L', table = 'integration_links') => (await w[side].db.query<Record<string, any>>(`select * from ${table}${table === 'integration_nonces' ? '' : ' order by created_at'}`)).rows;

describe('flux nominal : REV-EM A ↔ LexNote A', () => {
  it('intention → inspection → autorisation → les DEUX côtés CONNECTED et vérifiés', async () => {
    const { s, intent, nonce } = await start(U.revemA);
    expect(s.status).toBe(200);
    expect(s.json.confirmUrl).toMatch(/^https:\/\/lexnote\.example\.app\/integrations\/revem\/connect\?intent=/);
    expect(s.json.confirmUrl).not.toContain('?n=');               // le nonce est dans le FRAGMENT, jamais dans la requête
    expect(new URL(s.json.confirmUrl).search).not.toContain(nonce);
    expect(await state('R', U.revemA)).toMatchObject({ state: 'NOT_CONNECTED', localStatus: null, verified: false });

    const ins = await w.userReq('L', U.lexA, { action: 'inspect', linkIntentId: intent, nonce });
    expect(ins.json).toMatchObject({ ok: true, displayHint: 'Alice' });
    const c = await confirm(U.lexA, intent, nonce);
    expect(c.status).toBe(200);
    expect(c.json.state).toMatchObject({ state: 'CONNECTED', verified: true, peerStatus: 'CONNECTED', partner: 'revem' });
    expect(c.json.returnUrl).toBe('https://antsvfr.github.io/REV-EM/?lexnote_link=connected');

    const r = await state('R', U.revemA); const l = await state('L', U.lexA);
    expect(r).toMatchObject({ state: 'CONNECTED', verified: true, partner: 'lexnote' });
    expect(l).toMatchObject({ state: 'CONNECTED', verified: true, partner: 'revem' });
    expect(r.linkId).toBe(l.linkId);                               // integrationLinkId partagé
    expect(r.linkId).toMatch(/^lnk_/);
  });

  it('références opaques croisées ; UUID, e-mails et secrets ne traversent jamais la frontière', async () => {
    await link(U.revemA, U.lexA);
    const R = (await rows('R'))[0]!; const L = (await rows('L'))[0]!;
    expect(R.user_id).toBe(U.revemA); expect(L.user_id).toBe(U.lexA);
    expect(R.local_reference).toBe(L.external_reference); expect(L.local_reference).toBe(R.external_reference);
    expect(R.local_reference).not.toBe(L.local_reference);
    expect(R.link_id).toBe(L.link_id);
    expect([R, L].every((x) => x.status === 'CONNECTED' && x.linked_at)).toBe(true);
    const wire = w.traffic.map((t) => t.body + JSON.stringify(t.headers)).join('\n');
    for (const forbidden of [...Object.values(U), ...Object.values(EMAIL), KEY]) expect(wire).not.toContain(forbidden);
    expect(findSecrets(w.traffic.map((t) => JSON.parse(t.body)))).toEqual([]);
    // pas de colonne e-mail / jeton dans les tables d'intégration
    const cols = (await w.R.db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name in ('integration_links','integration_link_intents','integration_nonces')`)).rows.map((x) => x.column_name).join(' ');
    expect(cols).not.toMatch(/email|token|password|secret|service_role/);
  });

  it('la réponse destinée au navigateur ne contient aucune clé, aucun pseudonyme, aucun secret', async () => {
    const st = await start(U.revemA); const c = await confirm(U.lexA, st.intent, st.nonce);
    for (const out of [st.s.json, c.json, (await w.userReq('R', U.revemA, { action: 'status' })).json, (await w.userReq('L', U.lexA, { action: 'revoke' })).json]) {
      const t = JSON.stringify(out);
      expect(t).not.toContain(KEY); expect(t).not.toMatch(/ref_[A-Za-z0-9_-]{20,}|local_reference|external_reference|service_role|refresh|access_token/);
      expect(findSecrets(out)).toEqual([]);
    }
  });
});

describe('User A / User B', () => {
  it('deux liaisons indépendantes ; A ne voit, ne révoque ni ne lie jamais B', async () => {
    const a = await link(U.revemA, U.lexA); const b = await link(U.revemB, U.lexB);
    expect(a.c.status).toBe(200); expect(b.c.status).toBe(200);
    const sa = await state('R', U.revemA); const sb = await state('R', U.revemB);
    expect(sa.linkId).not.toBe(sb.linkId);

    // A révoque : B est intact des deux côtés
    await w.userReq('R', U.revemA, { action: 'revoke' });
    expect((await state('R', U.revemB)).state).toBe('CONNECTED'); expect((await state('L', U.lexB)).state).toBe('CONNECTED');
    expect((await state('L', U.lexA)).state).toBe('REVOKED');

    // le lien d'un utilisateur est lu depuis SON identité (jeton), pas depuis le corps : un linkId fourni est ignoré
    const spoof = await w.userReq('R', U.revemA, { action: 'status', linkId: sb.linkId, userId: U.revemB });
    expect(spoof.json.state.linkId).toBe(sa.linkId);
  });

  it('A ne peut pas utiliser l’intention de B (ni sans nonce, ni avec le sien) ; l’intention de B reste utilisable par B', async () => {
    const a = await start(U.revemA); const b = await start(U.revemB);
    const wrongNonce = await confirm(U.lexA, b.intent, a.nonce);                    // intention de B + nonce de A
    expect(wrongNonce.status).toBe(403); expect(wrongNonce.json.error.code).toBe('FORBIDDEN');
    const guess = await confirm(U.lexA, b.intent, 'x'.repeat(43));                  // devinette
    expect(guess.json.error.code).toBe('FORBIDDEN');
    expect((await rows('R', 'integration_link_intents')).find((i) => i.user_id === U.revemB)!.status).toBe('PENDING');   // non consommée par l'échec
    expect((await confirm(U.lexB, b.intent, b.nonce)).status).toBe(200);
    expect((await state('R', U.revemB)).state).toBe('CONNECTED');
    expect((await state('R', U.revemA)).state).toBe('NOT_CONNECTED');
  });

  it('la passerelle refuse de révoquer / lire / activer la liaison de B avec la référence de A', async () => {
    await link(U.revemA, U.lexA); const b = await link(U.revemB, U.lexB);
    const aRow = (await rows('L')).find((x) => x.user_id === U.lexA)!; const bRow = (await rows('L')).find((x) => x.user_id === U.lexB)!;
    const send = (op: string, linkId: string, ref: string) => w.L.service.handlePeerRequest({ integrationVersion: INTEGRATION_VERSION, kind: 'link-request', operation: op as never, linkId, senderReference: ref });
    await expect(send('REVOKE', bRow.link_id, aRow.external_reference)).rejects.toMatchObject({ error: { code: 'NOT_FOUND' } });
    await expect(send('STATUS', bRow.link_id, aRow.external_reference)).rejects.toMatchObject({ error: { code: 'NOT_FOUND' } });
    await expect(send('ACTIVATE', bRow.link_id, aRow.external_reference)).rejects.toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect((await state('L', U.lexB)).state).toBe('CONNECTED');
    expect(b.c.status).toBe(200);
  });

  it('une liaison est 1-1 : pas de deuxième liaison pour A, ni A lié à deux comptes partenaires', async () => {
    await link(U.revemA, U.lexA);
    expect((await w.userReq('R', U.revemA, { action: 'start' })).json.error.code).toBe('CONFLICT');          // A est déjà lié
    const b = await start(U.revemB);
    expect((await confirm(U.lexA, b.intent, b.nonce)).json.error.code).toBe('CONFLICT');                         // LexNote A déjà lié
    expect((await state('R', U.revemB)).state).toBe('NOT_CONNECTED');
  });
});

describe('intentions à usage unique', () => {
  it('intention expirée → LINK_EXPIRED ; aucune liaison créée', async () => {
    const st = await start(U.revemA);
    await w.R.db.query(`update integration_link_intents set created_at = now() - interval '10 minutes', expires_at = now() - interval '1 second'`);
    const c = await confirm(U.lexA, st.intent, st.nonce);
    expect(c.status).toBe(410); expect(c.json.error.code).toBe('LINK_EXPIRED');
    expect(await rows('R')).toHaveLength(0); expect(await rows('L')).toHaveLength(0);
    expect((await rows('R', 'integration_link_intents'))[0]!.status).toBe('EXPIRED');
  });
  it('intention déjà consommée → GONE (même avec le bon nonce)', async () => {
    const st = await start(U.revemA);
    expect((await confirm(U.lexA, st.intent, st.nonce)).status).toBe(200);
    const again = await confirm(U.lexB, st.intent, st.nonce);
    expect(again.json.error.code).toBe('GONE');
    expect((await rows('R', 'integration_link_intents'))[0]!.status).toBe('USED');
    expect(await rows('L')).toHaveLength(1);
  });
  it('annulée / remplacée par une nouvelle intention → GONE', async () => {
    const st = await start(U.revemA);
    await w.userReq('R', U.revemA, { action: 'cancel' });
    expect((await confirm(U.lexA, st.intent, st.nonce)).json.error.code).toBe('GONE');
    const first = await start(U.revemA); const second = await start(U.revemA);
    expect((await confirm(U.lexA, first.intent, first.nonce)).json.error.code).toBe('GONE');
    expect((await confirm(U.lexA, second.intent, second.nonce)).status).toBe(200);
  });
  it('seule l’EMPREINTE du nonce est stockée ; durée de vie ≤ 15 min (contrainte en base)', async () => {
    const st = await start(U.revemA);
    const i = (await rows('R', 'integration_link_intents'))[0]!;
    expect(JSON.stringify(i)).not.toContain(st.nonce);
    expect(i.nonce_hash).toMatch(/^[0-9a-f]{64}$/);
    await expect(w.R.db.query(`insert into integration_link_intents (user_id, nonce_hash, expires_at) values ($1, repeat('a',64), now() + interval '2 hours')`, [U.revemA])).rejects.toThrow();
  });
  it('échec d’activation : compensation, aucune liaison à moitié créée', async () => {
    const st = await start(U.revemA);
    w.hook.before = (op) => { if (op === 'ACTIVATE') w.netDown.value = true; };
    const c = await confirm(U.lexA, st.intent, st.nonce);
    w.netDown.value = false;
    expect(c.status).toBeGreaterThanOrEqual(500);
    expect((await rows('L'))[0]!).toMatchObject({ status: 'ERROR', error_code: 'ACTIVATE_FAILED' });
    expect((await state('R', U.revemA, false)).state).toBe('PENDING');            // le côté initiateur n'est jamais « connecté »
    expect((await state('L', U.lexA)).state).toBe('ERROR');
    // et l'étudiant peut recommencer
    const st2 = await start(U.revemA);
    expect(st2.s.status).toBe(200);
  });
});

describe('passerelle : authenticité', () => {
  async function signedRequest(over: { body?: string; mutate?: (h: Record<string, string>) => void; now?: Date; kid?: string; secret?: string; from?: 'lexnote' | 'revem'; to?: 'lexnote' | 'revem'; origin?: string } = {}) {
    const cfg = w.L.cfg;                                                                    // L parle à R
    const env = makeEnvelope({ from: 'lexnote', to: 'revem', linkId: 'pairing', now: w.clock.now, payload: { integrationVersion: INTEGRATION_VERSION, kind: 'link-request', operation: 'STATUS', linkId: 'lnk_' + 'a'.repeat(30), senderReference: 'ref_' + 'b'.repeat(30) } });
    const body = over.body ?? JSON.stringify(env);
    const headers = await signRequest({ body, from: over.from ?? 'lexnote', to: over.to ?? 'revem', kid: over.kid ?? 'k1', secret: over.secret ?? KEY, now: over.now ?? w.clock.now });
    over.mutate?.(headers);
    if (over.origin) headers.origin = over.origin;
    void cfg;
    return new Request('https://rev.supabase.co/functions/v1/integration-gateway', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  }
  const send = async (req: Request) => { const r = await handleGatewayRequest(req, w.R.gw); return { status: r.status, json: JSON.parse(await r.text()) }; };

  it('requête valide mais liaison inconnue → NOT_FOUND signé (la signature, seule, ne donne aucun droit)', async () => {
    const r = await handleGatewayRequest(await signedRequest(), w.R.gw);
    expect(r.headers.get(H.signature)).toBeTruthy();
    expect(r.status).toBe(404);
  });
  it('rejeu du même message (même nonce) → refusé', async () => {
    const req = await signedRequest(); const again = req.clone();
    expect((await send(req)).status).toBe(404);
    const r = await send(again);
    expect(r.status).toBe(401); expect(r.json.details.reason).toBe('replay');
  });
  it('nonce rejoué avec un NOUVEAU corps signé → refusé', async () => {
    const a = await signedRequest(); const orig = a.clone(); await send(a);
    const h = Object.fromEntries(orig.headers.entries());
    const body2 = JSON.stringify({ ...JSON.parse(await orig.text()), messageId: 'autre-message-12345' });
    const headers = await signRequest({ body: body2, from: 'lexnote', to: 'revem', kid: 'k1', secret: KEY, now: w.clock.now, nonce: h[H.nonce] });
    const r = await send(new Request(orig.url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body2 }));
    expect(r.json.details.reason).toBe('replay');
  });
  it('signature incorrecte / mauvais secret / signature altérée', async () => {
    expect((await send(await signedRequest({ secret: 'z'.repeat(40) }))).json.details.reason).toBe('bad-signature');
    expect((await send(await signedRequest({ mutate: (h) => { h[H.signature] = h[H.signature]!.slice(0, -2) + 'AA'; } }))).json.details.reason).toBe('bad-signature');
    expect((await send(await signedRequest({ mutate: (h) => { delete h[H.signature]; } }))).json.details.reason).toBe('missing-header');
  });
  it('payload modifié après signature → refusé ; corps remplacé + empreinte recalculée sans la clé → refusé', async () => {
    const good = await signedRequest();
    const tampered = new Request(good.url, { method: 'POST', headers: good.headers, body: (await good.clone().text()).replace('STATUS', 'REVOKE') });
    expect((await send(tampered)).json.details.reason).toBe('payload-hash');
    const body = (await good.clone().text()).replace('STATUS', 'REVOKE');
    const { sha256Hex } = await import('./signing');
    const h = Object.fromEntries(good.headers.entries()); h[H.bodySha] = await sha256Hex(body);
    expect((await send(new Request(good.url, { method: 'POST', headers: h, body }))).json.details.reason).toBe('bad-signature');
  });
  it('message expiré (horodatage hors fenêtre) → refusé ; légère dérive d’horloge tolérée', async () => {
    expect((await send(await signedRequest({ now: new Date(w.clock.now.getTime() - 10 * 60_000) }))).json.details.reason).toBe('expired');
    expect((await send(await signedRequest({ now: new Date(w.clock.now.getTime() + 10 * 60_000) }))).json.details.reason).toBe('expired');
    expect((await send(await signedRequest({ now: new Date(w.clock.now.getTime() - 60_000) }))).status).toBe(404);
  });
  it('expéditeur inconnu / direction inversée / clé inconnue / destinataire erroné', async () => {
    expect((await send(await signedRequest({ from: 'revem', to: 'lexnote' }))).json.details.reason).toBe('unknown-sender');   // R ne s'écoute pas lui-même
    expect((await send(await signedRequest({ mutate: (h) => { h[H.from] = 'mallory'; } }))).json.details.reason).toBe('unknown-sender');
    expect((await send(await signedRequest({ kid: 'k-inconnue' }))).json.details.reason).toBe('unknown-key');
    expect((await send(await signedRequest({ to: 'lexnote' }))).json.details.reason).toBe('wrong-recipient');
  });
  it('origine navigateur refusée ; méthode GET refusée ; corps géant refusé ; aucune requête non signée n’est traitée', async () => {
    expect((await send(await signedRequest({ origin: 'https://evil.example' }))).status).toBe(403);
    expect((await send(await signedRequest({ origin: 'https://lexnote.example.app' }))).json.details.reason).toBe('browser-origin');
    expect((await handleGatewayRequest(new Request('https://x.test/g', { method: 'GET' }), w.R.gw)).status).toBe(400);
    expect((await send(new Request('https://x.test/g', { method: 'POST', body: JSON.stringify({ kind: 'link-request' }) }))).status).toBe(401);
    expect((await send(new Request('https://x.test/g', { method: 'POST', body: 'x'.repeat(20_000) }))).status).toBe(400);
    expect(await rows('R', 'integration_nonces')).toHaveLength(0);                 // rien n'est mémorisé pour un appelant non authentifié
  });
  it('version d’intégration inconnue ou secret glissé dans le message : refus après authentification', async () => {
    const env = JSON.parse(await (await signedRequest()).text());
    const mk = async (e: unknown) => { const body = JSON.stringify(e); const h = await signRequest({ body, from: 'lexnote', to: 'revem', kid: 'k1', secret: KEY, now: w.clock.now }); return new Request('https://x.test/g', { method: 'POST', headers: h, body }); };
    expect((await send(await mk({ ...env, integrationVersion: 'lexnote-revem/v9' }))).json.code).toBe('UNSUPPORTED_VERSION');
    expect((await send(await mk({ ...env, access_token: 'abc' }))).json.code).toBe('SECRET_DETECTED');
  });
  it('rotation de clé : l’ancienne clé reste acceptée en vérification pendant la transition', async () => {
    const cfg = readIntegrationConfig('revem', (k) => ({ INTEGRATION_KEY_ID: 'k2', INTEGRATION_KEY: 'n'.repeat(40), INTEGRATION_KEY_PREVIOUS_ID: 'k1', INTEGRATION_KEY_PREVIOUS: KEY, INTEGRATION_SELF_APP_URL: 'https://antsvfr.github.io/REV-EM/', INTEGRATION_PEER_APP_URL: 'https://lexnote.example.app/', INTEGRATION_PEER_GATEWAY_URL: 'https://l.example/gw' } as Record<string, string>)[k]);
    const r = await handleGatewayRequest(await signedRequest(), { ...w.R.gw, cfg });
    expect(r.status).toBe(404);                                                    // authentifiée par la clé précédente
  });
});

describe('révocation', () => {
  it('depuis LexNote : effet immédiat ; REV-EM l’apprend ; plus aucun échange possible ; rien n’est supprimé', async () => {
    const { c } = await link(U.revemA, U.lexA);
    const before = (await rows('R'))[0]!;
    const r = await w.userReq('L', U.lexA, { action: 'revoke' });
    expect(r.json).toMatchObject({ ok: true, peerNotified: true });
    expect(r.json.state).toMatchObject({ state: 'REVOKED', revokedBy: 'self' });
    const L = (await rows('L'))[0]!; const R = (await rows('R'))[0]!;
    expect(L.status).toBe('REVOKED'); expect(R.status).toBe('REVOKED'); expect(R.revoked_by).toBe('partner');
    expect(R.link_id).toBe(before.link_id);                                          // les lignes restent (historique), seules leur statut change
    expect((await state('R', U.revemA))).toMatchObject({ state: 'REVOKED', revokedBy: 'partner' });
    await expect(w.R.service.assertLinkUsable(R.link_id, R.external_reference)).rejects.toMatchObject({ error: { code: 'LINK_REVOKED' } });
    await expect(w.L.service.assertLinkUsable(L.link_id, L.external_reference)).rejects.toMatchObject({ error: { code: 'LINK_REVOKED' } });
    await expect(w.R.service.handlePeerRequest({ integrationVersion: INTEGRATION_VERSION, kind: 'link-request', operation: 'ACTIVATE', linkId: R.link_id, senderReference: R.external_reference })).rejects.toMatchObject({ error: { code: 'LINK_REVOKED' } });
    expect(c.status).toBe(200);
  });
  it('partenaire injoignable pendant la révocation : révoquée localement tout de suite, l’autre côté l’apprend ensuite', async () => {
    await link(U.revemA, U.lexA);
    w.netDown.value = true;
    const r = await w.userReq('R', U.revemA, { action: 'revoke' });
    expect(r.json).toMatchObject({ ok: true, peerNotified: false });
    expect((await rows('R'))[0]!.status).toBe('REVOKED');
    await expect(w.R.service.assertLinkUsable((await rows('R'))[0]!.link_id, (await rows('R'))[0]!.external_reference)).rejects.toMatchObject({ error: { code: 'LINK_REVOKED' } });
    w.netDown.value = false;
    expect((await state('L', U.lexA)).state).toBe('REVOKED');                       // LexNote constate au prochain contrôle
    expect((await rows('L'))[0]!.revoked_by).toBe('partner');
  });
  it('reconnexion possible après révocation (nouvelle liaison, nouvel identifiant)', async () => {
    const first = await link(U.revemA, U.lexA);
    await w.userReq('R', U.revemA, { action: 'revoke' });
    const again = await link(U.revemA, U.lexA);
    expect(again.c.status).toBe(200);
    const links = await rows('R');
    expect(links.map((l) => l.status)).toEqual(['REVOKED', 'CONNECTED']);
    expect(new Set(links.map((l) => l.link_id)).size).toBe(2);
    expect(first.intent).not.toBe(again.intent);
  });
});

describe('état de connexion cohérent', () => {
  it('une ligne dans UNE seule base ne suffit pas à être « connecté »', async () => {
    await link(U.revemA, U.lexA);
    await w.R.db.query('delete from integration_links');                              // REV-EM « oublie » la liaison
    const l = await state('L', U.lexA);
    expect(l).toMatchObject({ state: 'ERROR', errorCode: 'PEER_MISSING', peerStatus: 'MISSING', verified: false });
    expect((await state('R', U.revemA)).state).toBe('NOT_CONNECTED');
  });
  it('partenaire injoignable : jamais « connecté » ni modifié — ERROR/PEER_UNREACHABLE non vérifié', async () => {
    await link(U.revemA, U.lexA);
    w.netDown.value = true;
    expect(await state('R', U.revemA)).toMatchObject({ state: 'ERROR', errorCode: 'PEER_UNREACHABLE', verified: false, peerStatus: 'UNKNOWN', localStatus: 'CONNECTED' });
    expect((await rows('R'))[0]!.status).toBe('CONNECTED');                         // panne transitoire : rien n'est modifié en base
    w.netDown.value = false;
    expect((await state('R', U.revemA)).state).toBe('CONNECTED');                    // la connexion revient d'elle-même
  });
  it('sans sonde : jamais « CONNECTED » (vérification en attente) ; le contrat l’interdit', async () => {
    await link(U.revemA, U.lexA);
    expect(await state('R', U.revemA, false)).toMatchObject({ state: 'PENDING', verified: false, localStatus: 'CONNECTED' });
    const { connectionStateSchema } = await import('./contracts');
    const ok = await state('R', U.revemA);
    expect(connectionStateSchema.safeParse(ok).success).toBe(true);
    expect(connectionStateSchema.safeParse({ ...ok, verified: false }).success).toBe(false);
    expect(connectionStateSchema.safeParse({ ...ok, peerStatus: 'UNKNOWN' }).success).toBe(false);
  });
  it('liaison orpheline : le partenaire confirme PENDING mais pas CONNECTED → jamais connecté', async () => {
    await link(U.revemA, U.lexA);
    await w.L.db.query(`update integration_links set status = 'PENDING', linked_at = null`);
    expect(await state('R', U.revemA)).toMatchObject({ state: 'PENDING', peerStatus: 'PENDING', verified: false });
  });
  it('liaison PENDING trop ancienne → ERROR (PENDING_TIMEOUT)', async () => {
    const st = await start(U.revemA);
    w.hook.before = (op) => { if (op === 'ACTIVATE') w.netDown.value = true; };
    await confirm(U.lexA, st.intent, st.nonce); w.netDown.value = false; w.hook.before = undefined;
    await w.R.db.query(`update integration_links set created_at = now() - interval '11 minutes'`);
    expect((await state('R', U.revemA, false)).state).toBe('ERROR');
    expect((await state('R', U.revemA, false)).errorCode).toBe('PENDING_TIMEOUT');
  });
});

describe('fonction utilisateur : jeton et origine', () => {
  it('sans jeton / jeton invalide → 401 ; rien n’est exécuté', async () => {
    const r = await w.userReq('R', null, { action: 'start' });
    expect(r.status).toBe(401); expect(r.json.error.code).toBe('UNAUTHENTICATED');
    const noBearer = new Request('https://x.test/f', { method: 'POST', headers: { origin: 'https://antsvfr.github.io', authorization: 'Basic abc' }, body: '{"action":"start"}' });
    expect((await (await import('./gateway')).handleUserRequest(noBearer, w.R.user)).status).toBe(401);
    expect(await rows('R', 'integration_link_intents')).toHaveLength(0);              // aucune intention créée sans identité
  });
  it('origine non autorisée → 403 sans CORS, sans traitement ; origine autorisée → écho exact, jamais « * »', async () => {
    const bad = await w.userReq('R', U.revemA, { action: 'start' }, 'https://evil.example');
    expect(bad.status).toBe(403); expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    expect(await rows('R', 'integration_link_intents')).toHaveLength(0);
    const lookalike = await w.userReq('R', U.revemA, { action: 'start' }, 'https://antsvfr.github.io.evil.io');
    expect(lookalike.status).toBe(403);
    const ok = await w.userReq('R', U.revemA, { action: 'status' }, 'https://antsvfr.github.io');
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://antsvfr.github.io');
    for (const r of [bad, lookalike, ok]) expect(r.headers.get('access-control-allow-origin')).not.toBe('*');
    // REV-EM n'accepte pas l'origine de LexNote et inversement
    expect((await w.userReq('R', U.revemA, { action: 'status' }, 'https://lexnote.example.app')).status).toBe(403);
    expect((await w.userReq('L', U.lexA, { action: 'status' }, 'https://antsvfr.github.io')).status).toBe(403);
  });
  it('action inconnue / identifiants mal formés → 400', async () => {
    expect((await w.userReq('L', U.lexA, { action: 'drop-all' })).status).toBe(400);
    expect((await w.userReq('L', U.lexA, { action: 'confirm', linkIntentId: 'pas-un-uuid', nonce: 'x' })).status).toBe(400);
  });
});

describe('configuration des origines', () => {
  const base = { INTEGRATION_KEY_ID: 'k1', INTEGRATION_KEY: KEY, INTEGRATION_SELF_APP_URL: 'https://antsvfr.github.io/REV-EM/', INTEGRATION_PEER_APP_URL: 'https://lexnote.example.app/', INTEGRATION_PEER_GATEWAY_URL: 'https://l.example/gw' } as Record<string, string>;
  const read = (over: Record<string, string>) => () => readIntegrationConfig('revem', (k) => ({ ...base, ...over })[k]);
  it('refuse joker, http en production, clé courte, passerelle avec paramètres', () => {
    expect(read({ INTEGRATION_ALLOWED_ORIGINS: '*' })).toThrow(/joker/);
    expect(read({ INTEGRATION_ALLOWED_ORIGINS: 'https://*.evil.io' })).toThrow(/joker/);
    expect(read({ INTEGRATION_PEER_APP_URL: 'http://lexnote.example.app/' })).toThrow(/https/);
    expect(read({ INTEGRATION_ALLOWED_ORIGINS: 'http://localhost:8080' })).toThrow(/localhost/);
    expect(read({ INTEGRATION_KEY: 'court' })).toThrow(/trop courte/);
    expect(read({ INTEGRATION_PEER_GATEWAY_URL: 'https://l.example/gw?x=1' })).toThrow(/paramètres/);
    expect(read({ INTEGRATION_KEY_ID: '' })).toThrow();
  });
  it('production : origines officielles ; développement : localhost autorisé, dont les ports connus', () => {
    const prod = read({})();
    expect(prod.selfOrigins).toEqual(['https://antsvfr.github.io']);
    const dev = read({ INTEGRATION_ENV: 'development', INTEGRATION_PEER_APP_URL: 'http://localhost:5173/', INTEGRATION_PEER_GATEWAY_URL: 'http://localhost:54321/functions/v1/integration-gateway' })();
    expect(dev.selfOrigins).toEqual(expect.arrayContaining(['https://antsvfr.github.io', 'http://localhost:8080']));
    expect(dev.selfOrigins.some((o) => o === '*')).toBe(false);
  });
});
