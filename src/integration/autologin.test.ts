// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { U, makeWorld, type World } from './testkit';
import { externalCourseEventSchema, INTEGRATION_VERSION, type ExternalCourseEvent } from './index';
import { classifyUnsigned } from './peer';

/**
 * Connexion automatique REV-EM → LexNote — de bout en bout sur DEUX bases Postgres réelles (migrations REV-EM 006/008/009 et LexNote),
 * deux services, un réseau SIGNÉ. Ce qui est simulé : le navigateur, le planning REV-EM, et la création de session Supabase
 * (le vrai `SessionMinter` est testé dans sessions.test.ts).
 */
let w: World;
beforeAll(async () => { w = await makeWorld(); }, 90_000);
beforeEach(async () => { await w.reset(); });

const ev = (over: Partial<ExternalCourseEvent> = {}): ExternalCourseEvent => externalCourseEventSchema.parse({
  integrationVersion: INTEGRATION_VERSION, kind: 'external-course-event', origin: 'revem', externalId: 'evt_1', title: 'Formation du contrat',
  startsAt: '2026-10-09T08:00:00+02:00', endsAt: '2026-10-09T10:00:00+02:00', allDay: false, location: 'A204', teacher: 'Mme Dupont', sessionTypeHint: 'CM',
  subject: { app: 'revem', ref: 'subj_dc', name: 'Droit des contrats' }, calendarSource: 'ics', cancelled: false, updatedAt: '2026-10-08T10:00:00Z', ...over,
});
const give = (user: string, e = ev()) => { w.events[`${user}:${e.externalId}`] = e; };
async function link(ru = U.revemA, lu = U.lexA, autoLogin?: boolean) {
  const s = await w.userReq('R', ru, { action: 'start' }); const u = new URL(s.json.confirmUrl);
  return w.userReq('L', lu, { action: 'confirm', linkIntentId: u.searchParams.get('intent'), nonce: u.hash.replace('#n=', ''), ...(autoLogin === undefined ? {} : { autoLogin }) });
}
async function launchUrl(ru = U.revemA, eventId = 'evt_1') {
  const s = await w.userReq('R', ru, { action: 'launch-start', eventId }); expect(s.json.ok, JSON.stringify(s.json)).toBe(true);
  const u = new URL(s.json.launchUrl); return { intent: u.searchParams.get('intent')!, nonce: u.hash.replace('#n=', '') };
}
/** Le navigateur SANS session : aucun jeton (userId null). */
const signin = (intent: string, nonce: string) => w.userReq('L', null, { action: 'launch-signin', launchIntentId: intent, nonce });
const open = (intent: string, nonce: string, lu = U.lexA) => w.userReq('L', lu, { action: 'launch-open', launchIntentId: intent, nonce });
const sessionsOf = async (user: string) => (await w.L.db.query<{ id: string }>('select id from course_sessions where user_id = $1', [user])).rows;
const linkRow = async (user = U.lexA) => (await w.L.db.query<{ auto_login: boolean; status: string }>('select auto_login, status from integration_links where user_id = $1 order by created_at desc limit 1', [user])).rows[0];

describe('consentement « connexion automatique »', () => {
  it('jamais accordé par défaut : la liaison seule ne l’active pas (des deux côtés)', async () => {
    expect((await link()).json.state).toMatchObject({ state: 'CONNECTED', autoLogin: false });
    expect((await linkRow())!.auto_login).toBe(false);
    expect((await w.userReq('R', U.revemA, { action: 'status' })).json.state).toMatchObject({ state: 'CONNECTED', autoLogin: false });
  });
  it('accordé explicitement à l’autorisation : visible côté LexNote ET côté REV-EM (réponse STATUS signée)', async () => {
    expect((await link(U.revemA, U.lexA, true)).json.state).toMatchObject({ state: 'CONNECTED', autoLogin: true });
    expect((await w.userReq('R', U.revemA, { action: 'status' })).json.state).toMatchObject({ state: 'CONNECTED', autoLogin: true });
  });
  it('désactivable seul (la liaison reste) et réactivable ; refusé sans liaison active', async () => {
    await link(U.revemA, U.lexA, true);
    expect((await w.userReq('L', U.lexA, { action: 'auto-login', enabled: false })).json.ok).toBe(true);
    expect(await linkRow()).toMatchObject({ auto_login: false, status: 'CONNECTED' });
    expect((await w.userReq('L', U.lexA, { action: 'auto-login', enabled: true })).json.ok).toBe(true);
    expect((await linkRow())!.auto_login).toBe(true);
    expect((await w.userReq('L', U.lexB, { action: 'auto-login', enabled: true })).json).toMatchObject({ ok: false, error: { code: 'LINK_NOT_FOUND' } });
    expect((await w.userReq('L', null, { action: 'auto-login', enabled: true })).status).toBe(401);
  });
  it('révocation = retrait IMMÉDIAT du consentement, garanti par la base (déclencheur), quel que soit le côté', async () => {
    await link(U.revemA, U.lexA, true);
    await w.userReq('R', U.revemA, { action: 'revoke' });
    await w.userReq('L', U.lexA, { action: 'status' });                              // LexNote apprend la révocation du partenaire
    expect(await linkRow()).toMatchObject({ status: 'REVOKED', auto_login: false });
    await w.L.db.query("update integration_links set auto_login = true where user_id = $1", [U.lexA]);   // même une écriture directe…
    expect((await linkRow())!.auto_login).toBe(false);                               // …ne peut pas réactiver une liaison révoquée
  });
});

describe('CAS C — nouvel appareil, connexion automatique autorisée', () => {
  it('sans jeton : session ordinaire du BON compte LexNote, cours ouvert, intention consommée', async () => {
    await link(U.revemA, U.lexA, true); give(U.revemA);
    const { intent, nonce } = await launchUrl();
    const r = await signin(intent, nonce);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, session: { access_token: `at-${U.lexA}`, refresh_token: `rt-${U.lexA}`, token_type: 'bearer' } });
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(w.minted).toEqual([U.lexA]);
    expect(await sessionsOf(U.lexA)).toHaveLength(1);
    expect((await sessionsOf(U.lexA))[0]!.id).toBe(r.json.sessionId);
    // usage unique : ni une seconde connexion automatique, ni une ouverture classique ne rejouent l'intention
    expect((await signin(intent, nonce)).json).toMatchObject({ ok: false, error: { code: 'GONE' } });
    expect((await open(intent, nonce)).json.ok).toBe(false);
    expect(w.minted).toEqual([U.lexA]);
  });
  it('changement d’utilisateur REV-EM : l’intention de B ouvre le compte LexNote de B, jamais celui de A', async () => {
    await link(U.revemA, U.lexA, true); await link(U.revemB, U.lexB, true); give(U.revemB, ev({ externalId: 'evt_b', title: 'Cours de B' }));
    const { intent, nonce } = await launchUrl(U.revemB, 'evt_b');
    expect((await signin(intent, nonce)).json.session.access_token).toBe(`at-${U.lexB}`);
    expect(await sessionsOf(U.lexA)).toHaveLength(0); expect(await sessionsOf(U.lexB)).toHaveLength(1);
  });
  it('les jetons de session ne transitent JAMAIS entre les serveurs (créés et remis par LexNote seul)', async () => {
    await link(U.revemA, U.lexA, true); give(U.revemA);
    const { intent, nonce } = await launchUrl();
    await signin(intent, nonce);
    expect(w.traffic.map((t) => t.body).join('\n')).not.toMatch(/at-|rt-|access_token|refresh_token/);
  });
});

describe('CAS D et refus — rien n’est consommé, la connexion normale reprend le même lancement', () => {
  it('consentement absent → AUTO_LOGIN_DISABLED ; ensuite, connecté normalement, l’ouverture fonctionne', async () => {
    await link(); give(U.revemA);
    const { intent, nonce } = await launchUrl();
    expect((await signin(intent, nonce)).json).toMatchObject({ ok: false, error: { code: 'AUTO_LOGIN_DISABLED' } });
    expect(w.minted).toEqual([]); expect(await sessionsOf(U.lexA)).toHaveLength(0);
    expect((await open(intent, nonce)).json.ok).toBe(true);
  });
  it('consentement retiré entre deux clics → refusé immédiatement', async () => {
    await link(U.revemA, U.lexA, true); give(U.revemA);
    await w.userReq('L', U.lexA, { action: 'auto-login', enabled: false });
    const { intent, nonce } = await launchUrl();
    expect((await signin(intent, nonce)).json).toMatchObject({ ok: false, error: { code: 'AUTO_LOGIN_DISABLED' } });
    expect(w.minted).toEqual([]);
  });
  it('liaison révoquée après la création du lien de lancement → refusé, aucune session', async () => {
    await link(U.revemA, U.lexA, true); give(U.revemA);
    const { intent, nonce } = await launchUrl();
    await w.userReq('L', U.lexA, { action: 'revoke' });
    expect((await signin(intent, nonce)).json.ok).toBe(false);
    expect(w.minted).toEqual([]);
  });
  it('mauvais nonce (lien falsifié / volé partiellement) → refusé SANS consommer l’intention', async () => {
    await link(U.revemA, U.lexA, true); give(U.revemA);
    const { intent, nonce } = await launchUrl();
    const bad = `${nonce.slice(0, -4)}AAAA`;
    expect((await signin(intent, bad)).json.ok).toBe(false);
    expect(w.minted).toEqual([]);
    expect((await signin(intent, nonce)).json.ok).toBe(true);
  });
  it('intention trop ancienne pour la connexion automatique (> 120 s) → refusée, mais encore utilisable une fois connecté (≤ 5 min)', async () => {
    await link(U.revemA, U.lexA, true); give(U.revemA);
    const { intent, nonce } = await launchUrl();
    await w.R.db.query("update integration_launch_intents set created_at = now() - interval '130 seconds' where id = $1", [intent]);
    expect((await signin(intent, nonce)).json).toMatchObject({ ok: false, error: { code: 'LINK_EXPIRED' } });
    expect(w.minted).toEqual([]);
    expect((await open(intent, nonce)).json.ok).toBe(true);
  });
  it('intention expirée (> 5 min) → refusée partout', async () => {
    await link(U.revemA, U.lexA, true); give(U.revemA);
    const { intent, nonce } = await launchUrl();
    await w.R.db.query("update integration_launch_intents set expires_at = now() - interval '1 second', created_at = now() - interval '6 minutes' where id = $1", [intent]);
    expect((await signin(intent, nonce)).json.ok).toBe(false);
    expect((await open(intent, nonce)).json.ok).toBe(false);
    expect(w.minted).toEqual([]);
  });
  it('double clic / deux onglets simultanés : UNE seule session, UNE seule séance', async () => {
    await link(U.revemA, U.lexA, true); give(U.revemA);
    const { intent, nonce } = await launchUrl();
    const rs = await Promise.all([signin(intent, nonce), signin(intent, nonce), signin(intent, nonce)]);
    expect(rs.filter((r) => r.json.ok)).toHaveLength(1);
    expect(w.minted).toHaveLength(1);
    expect(await sessionsOf(U.lexA)).toHaveLength(1);
  });
  it('identifiant ou nonce mal formés → 400 avant tout échange serveur', async () => {
    expect((await signin('pas-un-uuid', 'x'.repeat(40))).status).toBe(400);
    expect(w.traffic).toHaveLength(0);
  });
});

describe('mauvais compte LexNote déjà connecté dans le navigateur', () => {
  it('le lancement de A ouvert dans une session LexNote de B → WRONG_ACCOUNT, rien consommé ; A peut ensuite l’utiliser', async () => {
    await link(U.revemA, U.lexA, true); await link(U.revemB, U.lexB); give(U.revemA);
    const { intent, nonce } = await launchUrl();
    expect((await open(intent, nonce, U.lexB)).json).toMatchObject({ ok: false, error: { code: 'WRONG_ACCOUNT' } });
    expect(await sessionsOf(U.lexB)).toHaveLength(0);
    expect((await signin(intent, nonce)).json.session.access_token).toBe(`at-${U.lexA}`);
  });
});

describe('les autres actions exigent toujours une session', () => {
  it('status / confirm / revoke / launch-open sans jeton → 401', async () => {
    for (const action of ['status', 'revoke', 'launch-open', 'auto-login']) expect((await w.userReq('L', null, { action })).status, action).toBe(401);
  });
});

describe('cause du « Votre session a expiré » : un refus SERVEUR ↔ SERVEUR n’est plus confondu avec la session de l’étudiant', () => {
  it('passerelle déployée avec vérification JWT (réponse de la plateforme Supabase) → PEER_AUTH_FAILED · gateway-verify-jwt', () => {
    expect(classifyUnsigned(401, '{"code":401,"message":"Missing authorization header"}')).toMatchObject({ code: 'PEER_AUTH_FAILED', details: { reason: 'gateway-verify-jwt' } });
    expect(classifyUnsigned(401, '{"msg":"Invalid JWT"}')).toMatchObject({ code: 'PEER_AUTH_FAILED', details: { reason: 'gateway-verify-jwt' } });
  });
  it('signature refusée par notre passerelle (clé, horloge, rejeu) → PEER_AUTH_FAILED avec la raison exacte', () => {
    const body = (reason: string) => JSON.stringify({ integrationVersion: INTEGRATION_VERSION, kind: 'integration-error', code: 'UNAUTHENTICATED', message: 'x', retryable: false, details: { reason } });
    expect(classifyUnsigned(401, body('expired'))).toMatchObject({ code: 'PEER_AUTH_FAILED', details: { reason: 'expired' } });
    expect(classifyUnsigned(401, body('bad-signature'))).toMatchObject({ code: 'PEER_AUTH_FAILED', details: { reason: 'bad-signature' } });
    expect(classifyUnsigned(401, body('replay'))).toMatchObject({ code: 'PEER_AUTH_FAILED', details: { reason: 'replay' } });
  });
  it('fonction absente (404) ou en panne (5xx) → UNAVAILABLE, jamais « session »', () => {
    expect(classifyUnsigned(404, 'Not found')).toMatchObject({ code: 'UNAVAILABLE', details: { reason: 'gateway-not-found' } });
    expect(classifyUnsigned(502, '')).toMatchObject({ code: 'UNAVAILABLE' });
  });
  it('de bout en bout : clé d’intégration différente chez le partenaire → l’autorisation renvoie PEER_AUTH_FAILED, pas UNAUTHENTICATED', async () => {
    const keys = w.R.cfg.keys as Record<string, string>; const saved = keys.k1!;
    keys.k1 = 'une-autre-cle-de-meme-longueur-0123456789abcdef0123456789';
    try {
      const s = await w.userReq('R', U.revemA, { action: 'status' });                  // initialise rien ; on force un échange signé
      expect(s.status).toBe(200);
      keys.k1 = saved;
      const st = await w.userReq('R', U.revemA, { action: 'start' }); const u = new URL(st.json.confirmUrl);
      keys.k1 = 'une-autre-cle-de-meme-longueur-0123456789abcdef0123456789';
      const r = await w.userReq('L', U.lexA, { action: 'inspect', linkIntentId: u.searchParams.get('intent'), nonce: u.hash.replace('#n=', '') });
      expect(r.json).toMatchObject({ ok: false, error: { code: 'PEER_AUTH_FAILED' } });
      expect(r.json.error.code).not.toBe('UNAUTHENTICATED');
    } finally { keys.k1 = saved; }
  });
});
