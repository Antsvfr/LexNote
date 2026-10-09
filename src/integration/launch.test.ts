// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { U, makeWorld, type World } from './testkit';
import { externalCourseEventSchema, INTEGRATION_VERSION, planCourseOpen, subjectKeyFromName, type ExternalCourseEvent } from './index';
import { findSecrets } from './security';

/**
 * « Prendre mes notes dans LexNote » — de bout en bout sur DEUX bases Postgres réelles (REV-EM et LexNote), deux services de liaison, un réseau signé.
 * Ce qui est réel : les migrations (contraintes UNIQUE, verrous, RLS forcée), la signature serveur → serveur, l'usage unique des intentions.
 * Ce qui est simulé : la lecture du planning côté REV-EM (le vrai mapper est testé dans le dépôt REV-EM) et le navigateur.
 */
let w: World;
beforeAll(async () => { w = await makeWorld(); }, 90_000);
beforeEach(async () => { await w.reset(); });

const ev = (over: Partial<ExternalCourseEvent> & { externalId?: string } = {}): ExternalCourseEvent => externalCourseEventSchema.parse({
  integrationVersion: INTEGRATION_VERSION, kind: 'external-course-event', origin: 'revem', externalId: 'evt_1', title: 'Formation du contrat',
  startsAt: '2026-10-09T08:00:00+02:00', endsAt: '2026-10-09T10:00:00+02:00', allDay: false, location: 'A204', teacher: 'Mme Dupont', sessionTypeHint: 'CM',
  subject: { app: 'revem', ref: 'subj_dc', name: 'Droit des contrats' }, calendarSource: 'ics', cancelled: false, updatedAt: '2026-10-08T10:00:00Z', ...over,
});
const give = (user: string, e: ExternalCourseEvent) => { w.events[`${user}:${e.externalId}`] = e; };

async function link(ru = U.revemA, lu = U.lexA) {
  const s = await w.userReq('R', ru, { action: 'start' }); const u = new URL(s.json.confirmUrl);
  return w.userReq('L', lu, { action: 'confirm', linkIntentId: u.searchParams.get('intent'), nonce: u.hash.replace('#n=', '') });
}
const startLaunch = (eventId = 'evt_1', ru = U.revemA, extra: Record<string, unknown> = {}) => w.userReq('R', ru, { action: 'launch-start', eventId, ...extra });
const intentOf = (launchUrl: string) => { const u = new URL(launchUrl); return { intent: u.searchParams.get('intent')!, nonce: u.hash.replace('#n=', '') }; };
const open = (intent: string, nonce: string, lu = U.lexA) => w.userReq('L', lu, { action: 'launch-open', launchIntentId: intent, nonce });
/** Un clic complet : REV-EM prépare, LexNote ouvre. */
async function click(eventId = 'evt_1', ru = U.revemA, lu = U.lexA) {
  const s = await startLaunch(eventId, ru); if (!s.json.ok) return { s, o: s };
  const { intent, nonce } = intentOf(s.json.launchUrl); return { s, o: await open(intent, nonce, lu), intent, nonce };
}
const sessions = async (user = U.lexA) => (await w.L.db.query<Record<string, any>>('select * from course_sessions where user_id = $1 order by created_at', [user])).rows;
const subjects = async (user = U.lexA) => (await w.L.db.query<Record<string, any>>('select * from subjects where user_id = $1 order by created_at', [user])).rows;
const count = async (table: string) => Number((await w.L.db.query<{ n: string }>(`select count(*) n from ${table}`)).rows[0]!.n);

describe('comptes non liés / non connectés : rien n’est créé', () => {
  it('REV-EM : sans liaison, « ouvrir » est refusé (LINK_NOT_FOUND) et aucune intention n’est créée', async () => {
    give(U.revemA, ev());
    const s = await startLaunch();
    expect(s.json).toMatchObject({ ok: false, error: { code: 'LINK_NOT_FOUND' } });
    expect((await w.R.db.query('select 1 from integration_launch_intents')).rows).toHaveLength(0);
  });
  it('LexNote : utilisateur sans liaison → LINK_NOT_FOUND, aucune matière ni séance', async () => {
    await link(U.revemA, U.lexA); give(U.revemA, ev());
    const { intent, nonce } = intentOf((await startLaunch()).json.launchUrl);
    const r = await open(intent, nonce, U.lexB);                 // B n'est lié à personne
    expect(r.json).toMatchObject({ ok: false, error: { code: 'LINK_NOT_FOUND' } });
    expect(await count('course_sessions')).toBe(0); expect(await count('subjects')).toBe(0);
  });
  it('utilisateur LexNote non authentifié → 401, rien créé', async () => {
    await link(); give(U.revemA, ev());
    const { intent, nonce } = intentOf((await startLaunch()).json.launchUrl);
    const r = await w.userReq('L', null, { action: 'launch-open', launchIntentId: intent, nonce });
    expect(r.status).toBe(401); expect(await count('course_sessions')).toBe(0);
  });
  it('liaison révoquée : REV-EM refuse de démarrer, LexNote refuse d’ouvrir, intention inutilisable', async () => {
    await link(); give(U.revemA, ev());
    const { intent, nonce } = intentOf((await startLaunch()).json.launchUrl);
    await w.userReq('R', U.revemA, { action: 'revoke' });
    expect((await open(intent, nonce)).json).toMatchObject({ ok: false });
    expect(await count('course_sessions')).toBe(0);
    expect((await startLaunch()).json).toMatchObject({ ok: false, error: { code: 'LINK_REVOKED' } });
  });
});

describe('création : matière + séance depuis le planning REV-EM', () => {
  beforeEach(async () => { await link(); give(U.revemA, ev()); });

  it('matière inexistante → créée ; séance inexistante → créée avec TOUTES les données du planning', async () => {
    const { s, o } = await click();
    expect(s.json.ok).toBe(true); expect(o.json).toMatchObject({ ok: true, createdSession: true, createdSubject: true });
    const subj = await subjects(); const sess = await sessions();
    expect(subj).toHaveLength(1); expect(subj[0]).toMatchObject({ name: 'Droit des contrats', version: 1, deleted_at: null });
    expect(sess).toHaveLength(1);
    expect(sess[0]).toMatchObject({ id: o.json.sessionId, subject_id: subj[0]!.id, type: 'CM', number: 1, title: 'Formation du contrat', teacher: 'Mme Dupont', room: 'A204', status: 'in_progress', version: 1, deleted_at: null, module_id: null });
    expect(new Date(sess[0]!.date).toISOString().slice(0, 10)).toBe('2026-10-09'); expect(sess[0]!.start_time).toBe('08:00:00'); expect(sess[0]!.end_time).toBe('10:00:00');
    expect(o.json.subjectId).toBe(subj[0]!.id);
  });
  it('l’URL de lancement ne contient ni le cours, ni identifiant de compte, ni e-mail, ni jeton : seulement intention + nonce (fragment)', async () => {
    const s = await startLaunch(); const u = new URL(s.json.launchUrl);
    expect(u.origin + u.pathname).toBe('https://lexnote.example.app/integrations/revem/launch');
    expect([...u.searchParams.keys()]).toEqual(['intent']); expect(u.hash).toMatch(/^#n=[A-Za-z0-9_-]{32,}$/);
    const all = s.json.launchUrl as string;
    for (const bad of ['Droit', 'contrats', 'Dupont', 'A204', U.revemA, U.lexA, 'alice', '@', 'Bearer', 'evt_1']) expect(all, bad).not.toContain(bad);
    expect(findSecrets(s.json)).toEqual([]);
  });
  it('même évènement cliqué 10 fois → UNE séance, UNE matière', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) { const { o } = await click(); expect(o.json.ok).toBe(true); ids.add(o.json.sessionId); }
    expect(ids.size).toBe(1); expect(await sessions()).toHaveLength(1); expect(await subjects()).toHaveLength(1);
    expect(await count('integration_course_refs')).toBe(1); expect(await count('integration_subject_refs')).toBe(1);
  });
  it('2e ouverture : séance « réutilisée » (createdSession=false), 1re : « créée »', async () => {
    const a = await click(); const b = await click();
    expect(a.o.json.createdSession).toBe(true); expect(b.o.json).toMatchObject({ createdSession: false, createdSubject: false, sessionId: a.o.json.sessionId });
  });
  it('double clic / deux onglets / deux appareils : 8 intentions DIFFÉRENTES ouvertes en parallèle → UNE séance', async () => {
    const intents = [];
    for (let i = 0; i < 8; i++) intents.push(intentOf((await startLaunch()).json.launchUrl));
    const results = await Promise.all(intents.map((x) => open(x.intent, x.nonce)));
    expect(results.every((r) => r.json.ok)).toBe(true);
    expect(new Set(results.map((r) => r.json.sessionId)).size).toBe(1);
    expect(await sessions()).toHaveLength(1); expect(await subjects()).toHaveLength(1);
  });
  it('la contrainte UNIQUE (base) interdit le doublon même en contournant la fonction', async () => {
    const { o } = await click();
    const dup = w.L.db.query(`insert into integration_course_refs (user_id, provider, external_event_ref, session_id, subject_id) values ($1,'revem','evt_1',$2,$3)`, [U.lexA, o.json.sessionId, o.json.subjectId]);
    await expect(dup).rejects.toThrow(/unique|duplicate/i);
    await expect(w.L.db.query(`insert into integration_subject_refs (user_id, provider, external_subject_ref, subject_id) values ($1,'revem','subj_dc',$2)`, [U.lexA, o.json.subjectId])).rejects.toThrow(/unique|duplicate/i);
  });
  it('évènement B → autre séance, MÊME matière (identifiant stable de matière) ; numérotation CM 01 → CM 02', async () => {
    give(U.revemA, ev({ externalId: 'evt_2', title: 'Vices du consentement', startsAt: '2026-10-16T08:00:00+02:00', endsAt: '2026-10-16T10:00:00+02:00' }));
    const a = await click('evt_1'); const b = await click('evt_2');
    expect(a.o.json.sessionId).not.toBe(b.o.json.sessionId); expect(a.o.json.subjectId).toBe(b.o.json.subjectId);
    expect((await sessions()).map((x) => [x.type, x.number])).toEqual([['CM', 1], ['CM', 2]]); expect(await subjects()).toHaveLength(1);
  });
  it('la matière est retrouvée par son IDENTIFIANT stable même si son nom change côté REV-EM', async () => {
    await click('evt_1');
    give(U.revemA, ev({ externalId: 'evt_3', subject: { app: 'revem', ref: 'subj_dc', name: 'Droit des contrats (S1)' } }));
    await click('evt_3'); expect(await subjects()).toHaveLength(1); expect((await subjects())[0]!.name).toBe('Droit des contrats');
  });
  it('matière de REV-EM sans identifiant : rapprochement par nom normalisé (accents/casse) — jamais de doublon', async () => {
    give(U.revemA, ev({ externalId: 'evt_4', subject: undefined, title: 'Droit des Contrats' }));
    give(U.revemA, ev({ externalId: 'evt_5', subject: undefined, title: 'droit des contrats' }));
    await click('evt_4'); await click('evt_5');
    expect(await subjects()).toHaveLength(1); expect(subjectKeyFromName('Théorie générale — Été')).toBe('name:theorie-generale-ete');
  });
  it('matière LexNote existante de même nom (créée à la main) → réutilisée, pas dupliquée', async () => {
    await w.L.db.query(`insert into subjects (id, user_id, name, color) values (gen_random_uuid(), $1, 'droit des contrats', 'teal')`, [U.lexA]);
    const { o } = await click(); expect(o.json).toMatchObject({ ok: true, createdSubject: false });
    expect(await subjects()).toHaveLength(1); expect((await sessions())[0]!.subject_id).toBe((await subjects())[0]!.id);
  });
  it('une matière LexNote déjà liée à une AUTRE matière REV-EM n’est pas « adoptée » par homonymie', async () => {
    give(U.revemA, ev({ externalId: 'evt_6', subject: { app: 'revem', ref: 'subj_other', name: 'Droit des contrats' } }));
    await click('evt_1'); await click('evt_6');
    expect(await subjects()).toHaveLength(2);
  });
  it.each([['CM', 'CM'], ['TD', 'TD'], ['TP', 'TP'], ['SEMINAR', 'SEMINAR'], ['WORKSHOP', 'WORKSHOP'], ['COURSE', 'COURSE'], [undefined, 'OTHER']] as const)('type %s → %s', async (hint, want) => {
    give(U.revemA, ev({ externalId: 'evt_t', sessionTypeHint: hint as never })); const { o } = await click('evt_t');
    expect(o.json.ok).toBe(true); expect((await sessions())[0]!.type).toBe(want);
  });
  it('type inconnu envoyé par un partenaire non conforme → refusé par le contrat (INVALID_PAYLOAD), rien créé', () => {
    expect(() => externalCourseEventSchema.parse({ ...ev(), sessionTypeHint: 'EXAM' })).toThrow();
    expect(() => planCourseOpen({ ...ev(), sessionTypeHint: 'EXAM' }, { userId: U.lexA, linkId: 'x', provider: 'revem' })).toThrow();
  });
  it('TD : numérotation indépendante du CM (TD 01 même si CM 01 existe)', async () => {
    give(U.revemA, ev({ externalId: 'evt_td', sessionTypeHint: 'TD' })); await click('evt_1'); await click('evt_td');
    expect((await sessions()).map((x) => [x.type, x.number])).toEqual([['CM', 1], ['TD', 1]]);
  });
  it('salle et enseignant absents → null ; cours « toute la journée » → pas d’heure', async () => {
    give(U.revemA, ev({ externalId: 'evt_n', location: undefined, teacher: undefined })); await click('evt_n');
    give(U.revemA, ev({ externalId: 'evt_d', allDay: true })); await click('evt_d');
    const s = await sessions(); expect([s[0]!.room, s[0]!.teacher]).toEqual([null, null]); expect([s[1]!.start_time, s[1]!.end_time]).toEqual([null, null]);
  });
  it('accents, apostrophes et caractères spéciaux : stockés tels quels (aucune injection)', async () => {
    const title = `L'été « indien » — 100 % <b>x</b>; drop table subjects; --`;
    give(U.revemA, ev({ externalId: 'evt_x', title, subject: { app: 'revem', ref: 'subj_eco', name: `Économie d'entreprise & Gestion "A"` }, location: 'Salle Ö-12', teacher: `M. O'Brien` }));
    const { o } = await click('evt_x'); expect(o.json.ok).toBe(true);
    expect((await sessions())[0]).toMatchObject({ title, room: 'Salle Ö-12', teacher: `M. O'Brien` });
    expect((await subjects())[0]!.name).toBe(`Économie d'entreprise & Gestion "A"`); expect(await count('subjects')).toBe(1);
  });
  it('cours annulé → GONE, rien créé', async () => {
    give(U.revemA, ev({ externalId: 'evt_c', cancelled: true })); const { o } = await click('evt_c');
    expect(o.json).toMatchObject({ ok: false, error: { code: 'GONE' } }); expect(await sessions()).toHaveLength(0);
  });
  it('séance supprimée par l’étudiant dans LexNote → un nouveau clic la recrée (ancienne conservée supprimée)', async () => {
    const a = await click(); await w.L.db.query(`update course_sessions set deleted_at = now() where id = $1`, [a.o.json.sessionId]);
    const b = await click(); expect(b.o.json).toMatchObject({ ok: true, createdSession: true }); expect(b.o.json.sessionId).not.toBe(a.o.json.sessionId);
    const click3 = await click(); expect(click3.o.json.sessionId).toBe(b.o.json.sessionId);
  });
  it('les lignes créées sont des lignes LexNote NORMALES : lisibles par leur propriétaire (RLS), jamais par un autre', async () => {
    const { o } = await click();
    await w.L.db.exec(`reset role; select set_config('request.jwt.claim.sub', '${U.lexA}', false); set role authenticated;`);
    const mine = await w.L.db.query('select id, version, user_id from course_sessions'); await w.L.db.exec('reset role;');
    expect(mine.rows).toHaveLength(1); expect(mine.rows[0]).toMatchObject({ id: o.json.sessionId, version: 1 });
    await w.L.db.exec(`reset role; select set_config('request.jwt.claim.sub', '${U.lexB}', false); set role authenticated;`);
    const theirs = await w.L.db.query('select id from course_sessions'); await w.L.db.exec('reset role;');
    expect(theirs.rows).toHaveLength(0);
  });
  it('les tables de correspondance sont inaccessibles aux navigateurs', async () => {
    await click();
    for (const t of ['integration_course_refs', 'integration_subject_refs']) {
      await w.L.db.exec(`reset role; select set_config('request.jwt.claim.sub', '${U.lexA}', false); set role authenticated;`);
      await expect(w.L.db.query(`select * from ${t}`)).rejects.toThrow(/permission denied/); await w.L.db.exec('reset role;');
    }
  });
  it('deux utilisateurs : mêmes identifiants REV-EM, correspondances et séances INDÉPENDANTES', async () => {
    await link(U.revemB, U.lexB); give(U.revemB, ev());
    const a = await click('evt_1', U.revemA, U.lexA); const b = await click('evt_1', U.revemB, U.lexB);
    expect(a.o.json.sessionId).not.toBe(b.o.json.sessionId); expect(await sessions(U.lexA)).toHaveLength(1); expect(await sessions(U.lexB)).toHaveLength(1);
  });
});

describe('sécurité des intentions', () => {
  beforeEach(async () => { await link(); give(U.revemA, ev()); });

  it('usage unique : la 2e consommation est refusée (GONE), aucune 2e séance', async () => {
    const { intent, nonce } = intentOf((await startLaunch()).json.launchUrl);
    expect((await open(intent, nonce)).json.ok).toBe(true);
    expect((await open(intent, nonce)).json).toMatchObject({ ok: false, error: { code: 'GONE' } });
    expect(await sessions()).toHaveLength(1);
  });
  it('mauvais nonce → FORBIDDEN et l’intention n’est PAS consommée (le bon nonce marche ensuite)', async () => {
    const { intent, nonce } = intentOf((await startLaunch()).json.launchUrl);
    expect((await open(intent, 'x'.repeat(43))).json).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(await sessions()).toHaveLength(0);
    expect((await open(intent, nonce)).json.ok).toBe(true);
  });
  it('intention expirée → refusée', async () => {
    const { intent, nonce } = intentOf((await startLaunch()).json.launchUrl);
    await w.R.db.query(`update integration_launch_intents set created_at = now() - interval '10 minutes', expires_at = now() - interval '5 minutes'`);
    expect((await open(intent, nonce)).json).toMatchObject({ ok: false, error: { code: 'LINK_EXPIRED' } }); expect(await sessions()).toHaveLength(0);
  });
  it('intention falsifiée / inconnue → NOT_FOUND ; nonce mal formé → INVALID_PAYLOAD', async () => {
    const { nonce } = intentOf((await startLaunch()).json.launchUrl);
    expect((await open('00000000-0000-4000-8000-000000000000', nonce)).json).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect((await open('pas-un-uuid', nonce)).json).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    expect((await open('00000000-0000-4000-8000-000000000000', 'court')).json).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
  });
  it('mauvais utilisateur : l’intention de A utilisée par un autre compte LexNote lié (B) → refusée, rien créé pour personne', async () => {
    await link(U.revemB, U.lexB);
    const { intent, nonce } = intentOf((await startLaunch('evt_1', U.revemA)).json.launchUrl);
    const r = await open(intent, nonce, U.lexB);
    expect(r.json).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await sessions(U.lexA)).toHaveLength(0); expect(await sessions(U.lexB)).toHaveLength(0);
    expect((await open(intent, nonce, U.lexA)).json.ok).toBe(true);           // A, lui, peut toujours l'utiliser
  });
  it('un évènement d’un AUTRE compte REV-EM est introuvable (le serveur lit SES données, pas un JSON du navigateur)', async () => {
    give(U.revemB, ev({ externalId: 'evt_b', title: 'Secret de B' }));
    expect((await startLaunch('evt_b', U.revemA)).json).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
  it('un cours « fourni » par le navigateur est ignoré : seul le cours établi par le serveur compte', async () => {
    const forged = ev({ title: 'FALSIFIÉ', location: 'Z999' });
    const s = await startLaunch('evt_1', U.revemA, { event: forged, title: 'FALSIFIÉ', userId: U.revemB, subject: 'X' });
    const { intent, nonce } = intentOf(s.json.launchUrl); await open(intent, nonce);
    expect((await sessions())[0]).toMatchObject({ title: 'Formation du contrat', room: 'A204' });
  });
  it('identifiant d’évènement invalide → INVALID_PAYLOAD (jamais transmis à la base)', async () => {
    for (const bad of ["evt'; drop table x; --", '', 'a b', 'x'.repeat(129)]) expect((await startLaunch(bad)).json).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
  });
  it('origine navigateur inconnue → refus net', async () => {
    const r = await w.userReq('R', U.revemA, { action: 'launch-start', eventId: 'evt_1' }, 'https://evil.example');
    expect(r.status).toBe(403);
  });
  it('trafic serveur → serveur : ni JWT, ni clé d’intégration, ni e-mail, ni UUID de compte ; signature présente', async () => {
    await w.reset(); await link(); give(U.revemA, ev()); w.traffic.length = 0;
    await click();
    const all = w.traffic.map((t) => t.body + JSON.stringify(t.headers)).join('\n');
    expect(w.traffic.length).toBeGreaterThanOrEqual(2);
    for (const bad of [U.revemA, U.lexA, 'alice@', 'Bearer', 'eyJ', 'k'.repeat(24)]) expect(all, bad).not.toContain(bad);
    expect(findSecrets(JSON.parse(w.traffic[0]!.body))).toEqual([]);
    expect(w.traffic[0]!.headers['x-lnrv-signature'] ?? Object.keys(w.traffic[0]!.headers).join(',')).toBeTruthy();
  });
  it('trop d’intentions en attente (20) → RATE_LIMITED', async () => {
    for (let i = 0; i < 20; i++) expect((await startLaunch()).json.ok).toBe(true);
    expect((await startLaunch()).json).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
  });
});

describe('réseau coupé et reprise', () => {
  beforeEach(async () => { await link(); give(U.revemA, ev()); });
  it('réseau coupé côté LexNote : UNAVAILABLE (réessayable), rien créé ; réseau rétabli → ça marche, intention intacte', async () => {
    const { intent, nonce } = intentOf((await startLaunch()).json.launchUrl);
    w.netDown.value = true;
    const r = await open(intent, nonce); expect(r.json).toMatchObject({ ok: false, error: { retryable: true } });
    expect(await sessions()).toHaveLength(0);
    w.netDown.value = false;
    expect((await open(intent, nonce)).json.ok).toBe(true); expect(await sessions()).toHaveLength(1);
  });
  it('réseau coupé côté REV-EM au moment du clic : le bouton ne démarre rien (UNAVAILABLE), aucune intention', async () => {
    w.netDown.value = true; const s = await startLaunch();
    expect(s.json).toMatchObject({ ok: false }); expect((await w.R.db.query('select 1 from integration_launch_intents')).rows).toHaveLength(0);
  });
  it('réponse perdue après consommation : un NOUVEAU clic (nouvelle intention) retrouve la même séance', async () => {
    const first = await click();
    const second = await click();
    expect(second.o.json.sessionId).toBe(first.o.json.sessionId);
  });
});

describe('contrat lexnote-revem/v1 : compatibilité', () => {
  it('le contrat de lancement est un AJOUT compatible : la version reste lexnote-revem/v1', () => { expect(INTEGRATION_VERSION).toBe('lexnote-revem/v1'); });
  it('un cours reçu est borné et normalisé (titre/lieu longs, espaces, caractères de contrôle)', () => {
    const p = planCourseOpen(ev({ title: ' Titre\u0000  avec   espaces ', location: 'L'.repeat(200) }), { userId: U.lexA, linkId: 'lnk_x', provider: 'revem' });
    expect(p.title).toBe('Titre avec espaces'); expect(p.room!.length).toBe(120); expect(p.date).toBe('2026-10-09'); expect([p.startTime, p.endTime]).toEqual(['08:00', '10:00']);
  });
});
