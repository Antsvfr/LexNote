// @vitest-environment node
import { describe, expect, it } from 'vitest';
// @ts-expect-error module .mjs sans types
import { PLAN, run, validDoc } from '../../scripts/prod/study-ai-smoke.mjs';

/**
 * AUTO-TEST du smoke test réel `scripts/prod/study-ai-smoke.mjs`, SANS clé ni réseau (CI) : un faux projet Supabase répond comme
 * la fonction déployée. Prouve que le script détecte les bons et les mauvais comportements — il ne remplace PAS le smoke test réel.
 */
const ENV = { LEXNOTE_SUPABASE_URL: 'https://proj.example', LEXNOTE_ANON_KEY: 'anon', LEXNOTE_A_EMAIL: 'a@t', LEXNOTE_A_PASSWORD: 'pw' };
const DOC = JSON.stringify({ blocks: [{ kind: 'heading', text: 'Titre', level: 1 }, { kind: 'paragraph', text: 'Texte.' }] });
type Mode = { disabled?: boolean; capacity?: boolean; badJson?: boolean; timeout?: boolean; provider?: boolean; noLimit?: boolean; leak?: boolean };

function fakeProject(m: Mode = {}) {
  const calls: { task?: string }[] = []; let running = 0;
  const res = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const fetchImpl = async (url: string, init: RequestInit) => {
    if (url.includes('/auth/v1/token')) return res(200, { access_token: 'jwt-secret' });
    const body = JSON.parse(String(init.body)) as { task: string; input: string };
    if (m.disabled) return res(503, { error: 'ai_disabled' }, { 'retry-after': '300' });
    const h = init.headers as Record<string, string>;
    if (!h.authorization) return res(401, { error: 'unauthorized' });
    if (body.task === 'jailbreak') return res(400, { error: 'bad_request' });
    if (body.input.length > 80_000) return res(413, { error: 'payload_too_large', limit: 80_000 });
    if (!m.noLimit && running >= 2) return res(429, { error: 'rate_limited', reason: 'concurrent', limit: 2, retry_after: 10 }, { 'retry-after': '10' });
    if (m.capacity) return res(503, { error: 'ai_capacity' }, { 'retry-after': '3600' });
    calls.push({ task: body.task }); running++;
    try {
      await new Promise((r) => setTimeout(r, 5));
      if (m.timeout) return res(504, { error: 'timeout' });
      if (m.provider) return res(503, m.leak ? { error: 'unavailable', detail: 'at handler (index.ts:1) sk-ant-xxx' } : { error: 'unavailable' });
      const text = body.task === 'digest' ? 'Synthèse. '.repeat(40) : m.badJson ? '{"blocks": [' : DOC;
      return res(200, { text, model: 'model-x', provider: 'anthropic' });
    } finally { running--; }
  };
  return { fetchImpl, calls };
}
const quiet = () => { const lines: string[] = []; return { lines, log: (s: string) => lines.push(s) }; };

describe('smoke test study-ai (auto-test, sans clé)', () => {
  it('dry-run par défaut : aucun appel réseau, plan complet affiché (y compris refus, JSON invalide, délai)', async () => {
    const f = fakeProject(); const q = quiet(); let n = 0;
    const r = await run(ENV, { log: q.log, fetchImpl: (...a: Parameters<typeof f.fetchImpl>) => { n++; return f.fetchImpl(...a); } });
    expect(r).toMatchObject({ dryRun: true, ok: true });
    expect(n).toBe(0);
    expect(PLAN.map((p: { id: string }) => p.id)).toEqual(['unauth', 'bad', 'too-large', 'express', 'detailed', 'translate', 'structure', 'long', 'rate', 'timeout', 'provider', 'refusal']);
  });
  it('projet conforme : tout PASS ; les cas non provoqués sont SKIP (jamais comptés PASS) ; aucun secret journalisé', async () => {
    const f = fakeProject(); const q = quiet();
    const r = await run({ ...ENV, SMOKE_CONFIRM: '1', SMOKE_RATE_LIMIT: '1' }, { log: q.log, fetchImpl: f.fetchImpl });
    expect(r.ok).toBe(true);
    expect(q.lines.filter((l) => l.startsWith('FAIL'))).toEqual([]);
    expect(q.lines.filter((l) => l.startsWith('SKIP')).length).toBe(4);   // délai, erreur fournisseur, budget global, refus
    expect(q.lines.join('\n')).not.toMatch(/jwt-secret|pw\b/);
    expect(f.calls.map((c) => c.task)).toEqual(expect.arrayContaining(['summarize', 'translate', 'structure', 'digest']));
  });
  it('JSON structuré invalide → FAIL', async () => {
    const q = quiet();
    const r = await run({ ...ENV, SMOKE_CONFIRM: '1' }, { log: q.log, fetchImpl: fakeProject({ badJson: true }).fetchImpl });
    expect(r.ok).toBe(false);
    expect(q.lines.filter((l) => l.startsWith('FAIL')).length).toBe(4);
  });
  it('limite de débit absente → FAIL', async () => {
    const r = await run({ ...ENV, SMOKE_CONFIRM: '1', SMOKE_RATE_LIMIT: '1' }, { log: quiet().log, fetchImpl: fakeProject({ noLimit: true }).fetchImpl });
    expect(r.ok).toBe(false);
  });
  it('délai et erreur fournisseur : PASS si propres, FAIL si un détail interne fuit', async () => {
    expect((await run({ ...ENV, SMOKE_CONFIRM: '1', SMOKE_EXPECT_TIMEOUT: '1' }, { log: quiet().log, fetchImpl: fakeProject({ timeout: true }).fetchImpl })).ok).toBe(true);
    expect((await run({ ...ENV, SMOKE_CONFIRM: '1', SMOKE_EXPECT_PROVIDER_ERROR: '1' }, { log: quiet().log, fetchImpl: fakeProject({ provider: true }).fetchImpl })).ok).toBe(true);
    expect((await run({ ...ENV, SMOKE_CONFIRM: '1', SMOKE_EXPECT_PROVIDER_ERROR: '1' }, { log: quiet().log, fetchImpl: fakeProject({ provider: true, leak: true }).fetchImpl })).ok).toBe(false);
  });
  it('interrupteur d’urgence : 503 ai_disabled pour tous, aucun appel payant ; un projet qui répond autrement → FAIL', async () => {
    const off = fakeProject({ disabled: true });
    expect((await run({ ...ENV, SMOKE_CONFIRM: '1', SMOKE_EXPECT_DISABLED: '1' }, { log: quiet().log, fetchImpl: off.fetchImpl })).ok).toBe(true);
    expect(off.calls).toEqual([]);
    expect((await run({ ...ENV, SMOKE_CONFIRM: '1', SMOKE_EXPECT_DISABLED: '1' }, { log: quiet().log, fetchImpl: fakeProject().fetchImpl })).ok).toBe(false);   // l'IA répond encore : l'interrupteur n'est pas actif
  });
  it('budget global consommé : 503 ai_capacity attendu ; l’IA qui répond encore → FAIL', async () => {
    expect((await run({ ...ENV, SMOKE_CONFIRM: '1', SMOKE_EXPECT_CAPACITY: '1' }, { log: quiet().log, fetchImpl: fakeProject({ capacity: true }).fetchImpl })).ok).toBe(true);
    expect((await run({ ...ENV, SMOKE_CONFIRM: '1', SMOKE_EXPECT_CAPACITY: '1' }, { log: quiet().log, fetchImpl: fakeProject().fetchImpl })).ok).toBe(false);
  });
  it('validDoc', () => {
    expect(validDoc(DOC)).toBe(true);
    expect(validDoc('{"blocks":[]}')).toBe(false);
    expect(validDoc('pas du json')).toBe(false);
    expect(validDoc('{"blocks":[{"kind":"paragraph"}]}')).toBe(false);
  });
});
