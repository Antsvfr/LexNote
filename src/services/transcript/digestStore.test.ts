import { describe, expect, it } from 'vitest';
import { AINotConfiguredError, AIUnavailableError, remoteError, type AIRequest } from '@/services/ai';
import { createTestAIProvider } from '@/services/ai/testDouble';
import type { TranscriptSegment } from '@/domain/capture';
import { buildTranscriptText } from './source';
import { actionById } from './actions';
import { createDigestStore, type DigestKey } from './digestStore';
import { LINEAR_CHUNK, runTranscriptAction, type AIEngine, type DerivedSource } from './pipeline';

const K = (over: Partial<DigestKey> = {}): DigestKey => ({ userId: 'u1', sessionId: 's1', transcriptVersion: 't1', chunkVersion: 'c1', engineVersion: 'digest-v1:test', ...over });

describe('cache des synthèses intermédiaires (IndexedDB)', () => {
  it('survit au « rechargement » : une nouvelle instance relit IndexedDB (la Map seule était perdue)', async () => {
    const a = createDigestStore(); await a.clear();
    await a.set(K(), 'synthèse 1');
    const memoryOnly = createDigestStore({ indexedDB: false });
    expect(await memoryOnly.get(K())).toBeUndefined();          // comportement de l'ancienne Map après rechargement
    const reloaded = createDigestStore();
    expect(reloaded.persistent).toBe(true);
    expect(await reloaded.get(K())).toBe('synthèse 1');
  });
  it('chaque élément de la clé compte : utilisateur, séance, version de transcription, de partie, de moteur', async () => {
    const s = createDigestStore(); await s.clear();
    await s.set(K(), 'x');
    for (const k of ['userId', 'sessionId', 'transcriptVersion', 'chunkVersion', 'engineVersion'] as const) expect(await s.get(K({ [k]: 'autre' }))).toBeUndefined();
  });
  it('clearUser n’efface que les synthèses de cet utilisateur', async () => {
    const s = createDigestStore(); await s.clear();
    await s.set(K(), 'a'); await s.set(K({ userId: 'u2' }), 'b');
    await s.clearUser('u1');
    const fresh = createDigestStore();
    expect(await fresh.get(K())).toBeUndefined();
    expect(await fresh.get(K({ userId: 'u2' }))).toBe('b');
  });
});

let n = 0;
const seg = (text: string, startMs: number): TranscriptSegment => ({ id: `g-${n++}`, sessionId: 's1', startMs, endMs: startMs + 3000, text, provider: 'test', status: 'final', source: 'TRANSCRIPTION', verification: 'UNVERIFIED', createdAt: '2026-10-13T08:00:00Z' });
const LINE = 'Le prix d’équilibre est le prix pour lequel l’offre est égale à la demande, c’est-à-dire le point où les deux courbes se croisent.';
const src = (count: number): DerivedSource => { const t = buildTranscriptText(Array.from({ length: count }, (_, k) => seg(`${LINE} (${k})`, k * 20_000))); return { kind: 'original', paragraphs: t.paragraphs, version: t.version, words: t.words }; };
function engine(maxInputChars: number, digestText?: (r: AIRequest) => string) {
  const calls: AIRequest[] = [];
  const p = createTestAIProvider(() => 'ok', calls);
  const e: AIEngine & { calls: AIRequest[] } = {
    isAvailable: () => true, maxInputChars, calls, providerId: 'test',
    run: async (r) => (r.command === 'digest' && digestText ? (calls.push(r), { text: digestText(r), provenance: 'AI', verification: 'UNVERIFIED', providerId: 'test', model: 'm', generatedAt: '' }) : p.run(r)),
  };
  return e;
}
const SESSION = { id: 's1', title: 'Cours', subjectId: null };

describe('pipeline : limites de taille et réduction récursive', () => {
  it('les synthèses persistées évitent de relancer l’analyse après un rechargement', async () => {
    const s = src(400);
    const e1 = engine(4000); const store1 = createDigestStore(); await store1.clear();
    await runTranscriptAction({ action: actionById('summarize')!, session: SESSION, userId: 'u1', source: s, ai: e1, digests: store1 });
    expect(e1.calls.some((c) => c.command === 'digest')).toBe(true);
    const e2 = engine(4000);
    await runTranscriptAction({ action: actionById('key-points')!, session: SESSION, userId: 'u1', source: s, ai: e2, digests: createDigestStore() });
    expect(e2.calls.map((c) => c.command)).toEqual(['key-points']);
    const e3 = engine(4000);   // autre utilisateur sur le même appareil : rien n'est réutilisé
    await runTranscriptAction({ action: actionById('key-points')!, session: SESSION, userId: 'u2', source: s, ai: e3, digests: createDigestStore() });
    expect(e3.calls.filter((c) => c.command === 'digest').length).toBeGreaterThan(0);
  });
  it('synthèses réunies trop longues → condensées par groupes ; la requête finale respecte la limite', async () => {
    const s = src(400);
    const e = engine(4000, (r) => 'Synthèse détaillée. '.repeat(r.options?.fromDigest ? 20 : 60));
    const store = createDigestStore({ indexedDB: false });
    await runTranscriptAction({ action: actionById('summarize')!, session: SESSION, userId: 'u1', source: s, ai: e, digests: store });
    expect(e.calls.some((c) => c.command === 'digest' && c.options?.fromDigest === true)).toBe(true);
    expect(e.calls.every((c) => c.input.length <= 4000)).toBe(true);
    expect(e.calls.at(-1)).toMatchObject({ command: 'summarize', options: { fromDigest: true } });
  });
  it('traduction : parties ≤ 16 000 caractères même si le moteur accepte plus ; aucune requête > 60 000', async () => {
    const s = src(800);
    const e = engine(200_000);
    await runTranscriptAction({ action: actionById('translate')!, session: SESSION, userId: 'u1', source: s, ai: e, options: { targetLanguage: 'en' }, digests: createDigestStore({ indexedDB: false }) });
    expect(e.calls.length).toBeGreaterThan(1);
    expect(e.calls.every((c) => c.input.length <= LINEAR_CHUNK)).toBe(true);
  });
});

describe('erreurs du serveur study-ai → messages clairs', () => {
  it('429 : raison, limite et délai ; jamais de nouvel essai automatique', () => {
    const e = remoteError(429, { error: 'rate_limited', reason: 'per_minute', limit: 12, retry_after: 37 }, '37') as AIUnavailableError;
    expect(e.message).toBe('Trop de demandes IA en une minute (max 12). Réessayez dans 37 s.');
    expect(e.retryable).toBe(false);
    expect(remoteError(429, { reason: 'per_day', limit: 200, retry_after: 5400 }).message).toBe('Quota quotidien de demandes IA atteint (200 par jour). Réessayez dans 90 min.');
    expect(remoteError(429, { reason: 'concurrent', limit: 2, retry_after: 10 }).message).toContain('en même temps (max 2)');
    expect(remoteError(429, { reason: 'chars_per_day', retry_after: 7200 }).message).toContain('Volume quotidien');
    expect(remoteError(429, null, '12').message).toBe('Trop de demandes en peu de temps. Réessayez dans 12 s.');
  });
  it('refus du modèle (422) : erreur structurée, non relancée', () => {
    const e = remoteError(422, { error: 'refused' }) as AIUnavailableError;
    expect(e.retryable).toBe(false);
    expect(e.message).toContain('refusé');
  });
  it('délai, quotas indisponibles, fournisseur saturé, non configuré', () => {
    expect(remoteError(504, { error: 'timeout' }).message).toContain('trop de temps');
    expect(remoteError(503, { error: 'rate_limit_unavailable' }).message).toContain('quotas');
    expect(remoteError(503, { error: 'provider_busy' }).message).toContain('saturé');
    expect(remoteError(503, { error: 'not_configured' })).toBeInstanceOf(AINotConfiguredError);
    expect(remoteError(502, { error: 'truncated' }).message).toContain('incomplète');
  });
});
