import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { courseOf, richMaterial } from '@/test/engineFixtures';
import { generateDraft, toArtifact } from '@/services/study/engine';
import type { CourseSession } from '@/domain/types';
import {
  INTEGRATION_VERSION, buildLexNoteLink, courseProgressEventSchema, envelopeSchema, expectPayload, externalCourseEventSchema, findSecrets, integrationError,
  integrationIdentitySchema, isSupportedVersion, isTrustedLink, makeEnvelope, normalizeErrorCode, parseEnvelope, progressEventId, toArtifactReference, toSessionReference,
  type ExternalCourseEvent, type IntegrationIdentity,
} from './index';

const NOW = new Date('2026-10-08T10:00:00.000Z');
const ORIGIN = 'https://lexnote.example.app';
const event = (over: Partial<ExternalCourseEvent> = {}): ExternalCourseEvent => ({
  integrationVersion: INTEGRATION_VERSION, kind: 'external-course-event', origin: 'revem', externalId: 'ics:abc123@univ', title: 'Droit des contrats — CM 3',
  startsAt: '2026-10-12T08:00:00+02:00', endsAt: '2026-10-12T10:00:00+02:00', allDay: false, calendarSource: 'ics', cancelled: false, updatedAt: '2026-10-07T09:00:00Z', sessionTypeHint: 'CM',
  subject: { app: 'revem', ref: 'sub_ab12', name: 'Droit civil' }, ...over,
});
const session = (): CourseSession => ({
  id: 'sess-1', userId: 'user-uuid-secret', subjectId: 'sub-1', moduleId: null, type: 'CM', number: 3, title: 'Droit des contrats', date: '2026-10-12', startTime: '08:00', endTime: '10:00',
  teacher: 'Mme X', room: 'A12', durationSec: 3600, status: 'completed', completedAt: null, wordCount: 900, excerpt: 'EXTRAIT-CONFIDENTIEL', searchText: 'TEXTE-DE-RECHERCHE-CONFIDENTIEL',
  captureSummary: null, transcript: null, audio: null, documents: [], aiOutputs: {}, legalItems: [], flashcards: [], questions: [], aiMeta: null,
  createdAt: '2026-10-12T08:00:00.000Z', updatedAt: '2026-10-12T10:00:00.000Z', version: 7, dirty: true,
} as CourseSession);

describe('versionnement', () => {
  it('lexnote-revem/v1 est supporté ; un majeur ou un nom inconnu est refusé', () => {
    expect(INTEGRATION_VERSION).toBe('lexnote-revem/v1');
    expect(isSupportedVersion('lexnote-revem/v1')).toBe(true);
    for (const v of ['lexnote-revem/v2', 'lexnote-revem/v0', 'revem/v1', 'lexnote-revem/1', '', 'lexnote-revem/v1.1']) expect(isSupportedVersion(v)).toBe(false);
  });
  it('enveloppe d’une version inconnue : UNSUPPORTED_VERSION avant toute lecture du reste', () => {
    const env = makeEnvelope({ from: 'revem', to: 'lexnote', linkId: 'lnk_1', payload: event(), now: NOW });
    const r = parseEnvelope({ ...env, integrationVersion: 'lexnote-revem/v2', payload: { nimporte: 'quoi' } }, NOW);
    expect(r).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_VERSION', retryable: false } });
  });
  it('évolution compatible : un lecteur v1 ignore les champs ajoutés plus tard', () => {
    const env = makeEnvelope({ from: 'revem', to: 'lexnote', linkId: 'lnk_1', payload: event(), now: NOW });
    const wire = JSON.parse(JSON.stringify(env)); wire.payload.futureField = { a: 1 }; wire.futureEnvelopeField = true;
    const r = parseEnvelope(wire, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(JSON.stringify(r.envelope)).not.toContain('futureField'); expect(expectPayload(r.envelope, 'external-course-event').externalId).toBe('ics:abc123@univ'); }
  });
});

describe('contrats', () => {
  it('ExternalCourseEvent : aller-retour JSON, défauts, fin avant début refusée, identifiant opaque contrôlé', () => {
    expect(externalCourseEventSchema.parse(JSON.parse(JSON.stringify(event())))).toEqual(event());
    expect(externalCourseEventSchema.safeParse(event({ endsAt: '2026-10-12T07:00:00+02:00' })).success).toBe(false);
    expect(externalCourseEventSchema.safeParse(event({ externalId: 'a b' })).success).toBe(false);
    expect(externalCourseEventSchema.safeParse({ ...event(), startsAt: '2026-10-12 08:00' }).success).toBe(false);
  });
  it('IntegrationIdentity : pseudonymes, scopes bornés, aucun champ e-mail / UUID de compte', () => {
    const id: IntegrationIdentity = { integrationVersion: INTEGRATION_VERSION, kind: 'integration-identity', app: 'lexnote', linkId: 'lnk_1', userRef: 'u_pseudo1', partnerUserRef: null, scopes: ['planning:read-events', 'sessions:read-references'], status: 'PENDING', linkedAt: null, expiresAt: null };
    expect(integrationIdentitySchema.parse(id)).toEqual(id);
    expect(integrationIdentitySchema.safeParse({ ...id, scopes: ['admin:everything'] }).success).toBe(false);
    expect(Object.keys(integrationIdentitySchema.shape)).not.toEqual(expect.arrayContaining(['email', 'userId', 'authUserId']));
  });
  it('CourseProgressEvent : identifiant déterministe (idempotence), métriques cohérentes', () => {
    const p = { progressKind: 'QUIZ_COMPLETED' as const, sessionRef: 'sess-1', artifactRef: 'art-1', occurredAt: '2026-10-08T09:00:00.000Z' };
    expect(progressEventId(p)).toBe(progressEventId({ ...p }));
    expect(progressEventId(p)).not.toBe(progressEventId({ ...p, occurredAt: '2026-10-08T09:00:01.000Z' }));
    const ev = { integrationVersion: INTEGRATION_VERSION, kind: 'course-progress-event' as const, eventId: progressEventId(p), ...p, metrics: { answered: 10, correct: 7, scorePct: 70 } };
    expect(courseProgressEventSchema.parse(ev).metrics.correct).toBe(7);
    expect(courseProgressEventSchema.safeParse({ ...ev, metrics: { answered: 3, correct: 9 } }).success).toBe(false);
    expect(courseProgressEventSchema.safeParse({ ...ev, metrics: { scorePct: 140 } }).success).toBe(false);
  });
  it('enveloppe : from ≠ to, expiration respectée', () => {
    expect(() => makeEnvelope({ from: 'revem', to: 'revem', linkId: 'l', payload: event(), now: NOW })).toThrow(/INVALID_PAYLOAD/);
    const env = makeEnvelope({ from: 'revem', to: 'lexnote', linkId: 'lnk_1', payload: event(), now: NOW, ttlSeconds: 60 });
    expect(parseEnvelope(env, new Date(NOW.getTime() + 30_000)).ok).toBe(true);
    expect(parseEnvelope(env, new Date(NOW.getTime() + 120_000))).toMatchObject({ ok: false, error: { code: 'GONE' } });
    expect(envelopeSchema.safeParse({ ...env, payload: { kind: 'inconnu' } }).success).toBe(false);
  });
});

describe('erreurs', () => {
  it('retryable seulement pour les erreurs transitoires ; code inconnu → INTERNAL', () => {
    expect(integrationError('UNAVAILABLE', 'x').retryable).toBe(true);
    expect(integrationError('OFFLINE', 'x').retryable).toBe(true);
    for (const c of ['FORBIDDEN', 'LINK_REVOKED', 'UNSUPPORTED_VERSION', 'SECRET_DETECTED', 'INVALID_PAYLOAD'] as const) expect(integrationError(c, 'x').retryable).toBe(false);
    expect(normalizeErrorCode('NEW_CODE_FROM_V1_1')).toBe('INTERNAL');
    expect(integrationError('INTERNAL', 'x'.repeat(900)).message).toHaveLength(500);
  });
});

describe('sécurité : aucun secret ne traverse', () => {
  const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLWZpY3RpZg';
  it('détecte clés interdites et valeurs de type JWT / clé secrète / Bearer, même imbriquées', () => {
    expect(findSecrets({ a: { service_role: 'x' } }).map((f) => f.path)).toContain('$.a.service_role');
    expect(findSecrets({ refresh_token: 'x' })).toHaveLength(1);
    expect(findSecrets({ accessToken: 'x' })).toHaveLength(1);
    expect(findSecrets({ note: FAKE_JWT })[0]?.reason).toBe('secret-value');
    expect(findSecrets([{ h: 'Bearer abcdefghijklmnop' }])).toHaveLength(1);
    expect(findSecrets({ k: 'sk-ant-api03-abcdefghijkl' })).toHaveLength(1);
    expect(findSecrets({ k: 'sb_secret_abcdefghijkl' })).toHaveLength(1);
  });
  it('ne signale pas un contenu ordinaire', () => {
    expect(findSecrets(event())).toEqual([]);
    expect(findSecrets({ title: 'Le secret professionnel des avocats', note: 'mot de passe oublié ? non' })).toEqual([]);
  });
  it('makeEnvelope refuse un secret glissé dans un champ libre ; parseEnvelope aussi (entrant)', () => {
    expect(() => makeEnvelope({ from: 'revem', to: 'lexnote', linkId: 'l', payload: event({ location: FAKE_JWT }), now: NOW })).toThrow(/SECRET_DETECTED/);
    const env = makeEnvelope({ from: 'revem', to: 'lexnote', linkId: 'l', payload: event(), now: NOW });
    expect(parseEnvelope({ ...env, access_token: 'abc' }, NOW)).toMatchObject({ ok: false, error: { code: 'SECRET_DETECTED' } });
    expect(parseEnvelope({ ...env, payload: { ...env.payload, title: FAKE_JWT } }, NOW)).toMatchObject({ ok: false, error: { code: 'SECRET_DETECTED' } });
  });
  it('les schémas publics ne contiennent AUCUN champ pouvant porter un jeton', () => {
    const names = (s: any): string[] => Object.keys(s.shape ?? s.def?.innerType?.shape ?? {});
    for (const s of [externalCourseEventSchema, integrationIdentitySchema, courseProgressEventSchema]) expect(names(s).join(' ')).not.toMatch(/token|secret|password|key|authorization/i);
  });
});

describe('liens profonds', () => {
  it('construits sur le routeur LexNote, identifiants encodés ; origines non sûres refusées', () => {
    expect(buildLexNoteLink(ORIGIN, { kind: 'review', ref: 'sess-1' })).toBe(`${ORIGIN}/session/sess-1/review`);
    expect(buildLexNoteLink(ORIGIN, { kind: 'artifact', ref: 'a/../b' })).toBe(`${ORIGIN}/supports/a%2F..%2Fb`);
    expect(buildLexNoteLink('http://localhost:4173', { kind: 'course', ref: 's' })).toBe('http://localhost:4173/session/s/course');
    for (const bad of ['http://evil.example', 'javascript:alert(1)', 'ftp://x.y', 'https://user:pw@x.y']) expect(() => buildLexNoteLink(bad, { kind: 'session', ref: 's' })).toThrow();
    expect(() => buildLexNoteLink(ORIGIN, { kind: 'chapter', ref: 's' })).toThrow(/non gérée/);
  });
  it('un lien reçu n’est suivi que s’il vient de l’origine configurée', () => {
    expect(isTrustedLink(`${ORIGIN}/session/x`, ORIGIN)).toBe(true);
    expect(isTrustedLink('https://lexnote.example.app.evil.io/x', ORIGIN)).toBe(false);
    expect(isTrustedLink('javascript:alert(1)', ORIGIN)).toBe(false);
  });
});

describe('références LexNote → REV-EM (minimisation)', () => {
  it('SessionReference : liste blanche — ni extrait, ni texte de recherche, ni userId, ni version de synchro', () => {
    const ref = toSessionReference(session(), { origin: ORIGIN, subject: { id: 'sub-1', name: 'Droit civil' }, hasNotes: true, hasTranscript: false, sourceCount: 2, latestCourse: { courseVersion: 2, generatedAt: '2026-10-12T11:00:00.000Z' }, artifactCount: 3 });
    const json = JSON.stringify(ref);
    for (const leak of ['CONFIDENTIEL', 'user-uuid-secret', 'Mme X', 'A12', '"dirty"', '"version"', 'searchText', 'excerpt', 'userId']) expect(json).not.toContain(leak);
    expect(ref.links.review).toBe(`${ORIGIN}/session/sess-1/review`);
    expect(ref.course.latestVersion).toBe(2);
    const env = makeEnvelope({ from: 'lexnote', to: 'revem', linkId: 'lnk_1', payload: ref, now: NOW });
    expect(parseEnvelope(JSON.parse(JSON.stringify(env)), NOW).ok).toBe(true);
  });
  it('ArtifactReference réel : compteur, version du cours, péremption ; aucun contenu', async () => {
    const course = await courseOf(richMaterial());
    const art = toArtifact(generateDraft(course, { type: 'FLASHCARDS', settings: { count: 10 } }), { userId: 'user-uuid-secret', subjectId: 'sub-1' });
    const ref = toArtifactReference(art, { origin: ORIGIN, stale: true });
    expect(ref).toMatchObject({ artifactType: 'FLASHCARDS', courseVersion: 1, generation: 1, userEdited: false, stale: true, sessionRef: 's1' });
    expect(ref.itemCount).toBe((art.content as { cards: unknown[] }).cards.length);
    const json = JSON.stringify(ref);
    expect(json).not.toContain('user-uuid-secret'); expect(json).not.toContain('manœuvres'); expect(json).not.toMatch(/"content"|"sources"|"provenance"/);
    expect(parseEnvelope(JSON.parse(JSON.stringify(makeEnvelope({ from: 'lexnote', to: 'revem', linkId: 'l', payload: ref, now: NOW }))), NOW).ok).toBe(true);
  });
});

describe('frontières d’architecture', () => {
  const dir = __dirname;
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const imports = (f: string) => [...readFileSync(join(dir, f), 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
  it('seul mappers.ts importe des types internes ; les contrats ne dépendent que de zod', () => {
    for (const f of files) {
      const bad = imports(f).filter((i) => i.startsWith('@/') || i.includes('supabase') || i.startsWith('../'));
      if (f === 'mappers.ts') expect(bad.every((i) => i.startsWith('@/domain/'))).toBe(true);
      else expect(bad, f).toEqual([]);
    }
    expect(imports('contracts.ts')).toEqual(['zod']);
  });
  it('aucun nom de table ou colonne Supabase dans les contrats publics', () => {
    const src = readFileSync(join(dir, 'contracts.ts'), 'utf8');
    expect(src).not.toMatch(/user_id|study_artifacts|course_sessions|generated_courses|auth\.users|planning_events|\bchapters\b/);
  });
});
