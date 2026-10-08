// @vitest-environment node
import { describe, expect, it } from 'vitest';
// @ts-expect-error module .mjs sans types
import { main, OFFICIAL } from '../../scripts/prod/supabase-admin.mjs';

const REF_L = 'abcdefghij0123456789', REF_R = 'zyxwvutsrq9876543210';
const KEY = 'S3cr3t-'.repeat(8);
const mock = (routes: Record<string, unknown>) => {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const f = async (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
    const path = url.replace('https://api.supabase.com', ''); calls.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const r = routes[`${init.method} ${path}`]; if (r === undefined) return { status: 404, text: async () => '' };
    return { status: 200, text: async () => JSON.stringify(r) };
  };
  return { f, calls };
};
const run = async (argv: string[], env: Record<string, string>, m: ReturnType<typeof mock>) => { const out: string[] = []; const code = await main(argv, env, m.f, (s: string) => out.push(s)); return { code, text: out.join('\n') }; };

describe('supabase-admin (API de gestion simulée)', () => {
  it('set-secrets : simulation par défaut, rien d’envoyé, clé masquée', async () => {
    const m = mock({}); const r = await run(['set-secrets', '--app', 'lexnote', '--project', REF_L, '--peer-ref', REF_R], { SUPABASE_ACCESS_TOKEN: 'sbp_x', INTEGRATION_KEY: KEY }, m);
    expect(r.code).toBe(0); expect(m.calls).toHaveLength(0);
    expect(r.text).not.toContain(KEY); expect(r.text).toContain('masquée');
    expect(r.text).toContain('INTEGRATION_SELF_APP_URL = https://lex-note-svfr.vercel.app/');
    expect(r.text).toContain('INTEGRATION_PEER_APP_URL = https://antsvfr.github.io/REV-EM/');
    expect(r.text).toContain(`https://${REF_R}.supabase.co/functions/v1/integration-gateway`);
  });
  it('set-secrets --apply : envoie 6 secrets, jamais affichés ; la clé n’apparaît que dans le corps de la requête HTTPS', async () => {
    const m = mock({ [`POST /v1/projects/${REF_R}/secrets`]: {} });
    const r = await run(['set-secrets', '--app', 'revem', '--project', REF_R, '--peer-ref', REF_L, '--apply'], { SUPABASE_ACCESS_TOKEN: 'sbp_x', INTEGRATION_KEY: KEY }, m);
    expect(r.code).toBe(0); expect(r.text).not.toContain(KEY);
    const body = m.calls[0]!.body as { name: string; value: string }[];
    expect(body.map((s) => s.name)).toEqual(['INTEGRATION_ENV', 'INTEGRATION_KEY_ID', 'INTEGRATION_KEY', 'INTEGRATION_SELF_APP_URL', 'INTEGRATION_PEER_APP_URL', 'INTEGRATION_PEER_GATEWAY_URL']);
    expect(body.find((s) => s.name === 'INTEGRATION_ENV')!.value).toBe('production');
    expect(body.find((s) => s.name === 'INTEGRATION_PEER_APP_URL')!.value).toBe('https://lex-note-svfr.vercel.app/');
  });
  it('set-secrets refuse une clé courte, absente, un joker, une référence invalide', async () => {
    const base = ['set-secrets', '--app', 'lexnote', '--project', REF_L, '--peer-ref', REF_R];
    await expect(run(base, { SUPABASE_ACCESS_TOKEN: 't' }, mock({}))).rejects.toThrow(/INTEGRATION_KEY/);
    await expect(run(base, { SUPABASE_ACCESS_TOKEN: 't', INTEGRATION_KEY: 'court' }, mock({}))).rejects.toThrow(/trop courte/);
    await expect(run(base, { SUPABASE_ACCESS_TOKEN: 't', INTEGRATION_KEY: KEY, INTEGRATION_ALLOWED_ORIGINS: '*' }, mock({}))).rejects.toThrow(/joker/);
    await expect(run(['set-secrets', '--app', 'lexnote', '--project', 'pas-une-ref', '--peer-ref', REF_R], { INTEGRATION_KEY: KEY }, mock({}))).rejects.toThrow(/référence/);
  });
  it('auth-urls : fusion sans suppression, domaines officiels, localhost seulement avec --dev', async () => {
    const path = `/v1/projects/${REF_L}/config/auth`;
    const m = mock({ [`GET ${path}`]: { uri_allow_list: 'https://autre.example/**,https://lex-note-svfr.vercel.app/**', site_url: 'https://lex-note-svfr.vercel.app' }, [`PATCH ${path}`]: {} });
    const r = await run(['auth-urls', '--app', 'lexnote', '--project', REF_L, '--apply'], { SUPABASE_ACCESS_TOKEN: 't' }, m);
    const patch = m.calls.find((c) => c.method === 'PATCH')!.body as { uri_allow_list: string };
    const urls = patch.uri_allow_list.split(',');
    expect(urls).toEqual(['https://autre.example/**', 'https://lex-note-svfr.vercel.app/**', 'https://lex-note-svfr.vercel.app/integrations/revem/**']);   // existantes conservées, une seule ajoutée
    expect(urls.some((u) => u.includes('localhost'))).toBe(false); expect(r.code).toBe(0);
    const dev = mock({ [`GET ${path}`]: { uri_allow_list: '', site_url: '' }, [`PATCH ${path}`]: {} });
    const rd = await run(['auth-urls', '--app', 'lexnote', '--project', REF_L, '--dev', '--apply'], { SUPABASE_ACCESS_TOKEN: 't' }, dev);
    expect((dev.calls.find((c) => c.method === 'PATCH')!.body as { uri_allow_list: string }).uri_allow_list).toContain('http://localhost:5173/**');
    expect(rd.text).toContain('site_url est vide');
    expect((Object.values(OFFICIAL) as { redirects: string[]; dev: string[] }[]).flatMap((o) => [...o.redirects, ...o.dev]).some((u) => u === '*' || u === '**')).toBe(false);
  });
  it('apply-sql : simulation sans --apply ; verify-db : code 1 s’il y a un FAIL', async () => {
    const m = mock({ [`POST /v1/projects/${REF_L}/database/query`]: [{ n: 1, controle: 'x', statut: 'FAIL', detail: 'd' }, { n: 999, controle: 'RÉSUMÉ', statut: '0 PASS / 1 FAIL', detail: null }] });
    const sim = await run(['apply-sql', '--project', REF_L, '--file', 'supabase/migrations/20261011000000_integration_links.sql'], { SUPABASE_ACCESS_TOKEN: 't' }, m);
    expect(sim.text).toContain('SIMULATION'); expect(m.calls).toHaveLength(0);
    expect((await run(['verify-db', '--project', REF_L], { SUPABASE_ACCESS_TOKEN: 't' }, m)).code).toBe(1);
  });
  it('advisors : signale uniquement ce qui concerne integration_*', async () => {
    const m = mock({ [`GET /v1/projects/${REF_L}/advisors/security`]: { lints: [{ level: 'WARN', name: 'auth_leaked_password_protection', title: 'x', metadata: {} }] }, [`GET /v1/projects/${REF_L}/advisors/performance`]: { lints: [{ level: 'WARN', name: 'unused_index', title: 'i', metadata: { name: 'integration_nonces_expiry' } }] } });
    const r = await run(['advisors', '--project', REF_L], { SUPABASE_ACCESS_TOKEN: 't' }, m);
    expect(r.text).toContain('1 concernant integration_*'); expect(r.code).toBe(1);
  });
  it('sans jeton : échec explicite, aucune requête', async () => {
    await expect(run(['verify-db', '--project', REF_L], {}, mock({}))).rejects.toThrow(/SUPABASE_ACCESS_TOKEN/);
  });
});
