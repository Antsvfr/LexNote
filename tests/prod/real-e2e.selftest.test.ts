// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KEY, U, makeWorld, type Side, type World } from '../../src/integration/testkit';
import { handleGatewayRequest, handleUserRequest } from '../../src/integration/gateway';
// @ts-expect-error module .mjs sans types
import { run } from '../../scripts/prod/real-e2e.mjs';

/**
 * AUTO-TEST du script de production `scripts/prod/real-e2e.mjs` : il est exécuté contre deux serveurs HTTP locaux qui exposent, comme
 * Supabase, /auth/v1/token, /functions/v1/* (le VRAI code des fonctions) et /rest/v1/* (au-dessus de VRAIES bases Postgres avec rôles et droits).
 * Objectif : le jour J, un échec signifie un problème de DÉPLOIEMENT, pas un défaut du script.
 */
const ACCOUNTS: Record<string, string> = { 'a@revem.t': U.revemA, 'b@revem.t': U.revemB, 'a@lex.t': U.lexA, 'b@lex.t': U.lexB };
let w: World; const servers: http.Server[] = []; const urls: Record<'R' | 'L', string> = { R: '', L: '' };

async function startProject(side: Side, kind: 'R' | 'L') {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url!, 'http://x');
    const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(payload)); };
    const asHttp = async (r: Response) => { const h: Record<string, string> = {}; r.headers.forEach((v, k) => { h[k] = v; }); res.writeHead(r.status, h); res.end(await r.text()); };
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    try {
      if (url.pathname === '/auth/v1/token') {
        const j = JSON.parse(body) as { email: string; password: string };
        const id = ACCOUNTS[j.email]; return id && j.password === 'pw' ? send(200, { access_token: `test-${id}` }) : send(400, { error: 'invalid' });
      }
      if (url.pathname === '/functions/v1/integration-link') return asHttp(await handleUserRequest(new Request('http://f/x', { method: req.method, headers, body: req.method === 'POST' ? body : undefined }), side.user));
      if (url.pathname === '/functions/v1/integration-gateway') return asHttp(await handleGatewayRequest(new Request('http://f/x', { method: req.method, headers, body: req.method === 'POST' ? body : undefined }), side.gw));
      if (url.pathname.startsWith('/rest/v1/')) {
        const m = /^Bearer test-(.+)$/.exec(headers.get('authorization') ?? ''); const sub = m?.[1] ?? '';
        const as = async (fn: () => Promise<unknown>) => { await side.db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub}', false); set role ${sub ? 'authenticated' : 'anon'};`); try { return await fn(); } finally { await side.db.exec('reset role;'); } };
        const tbl = url.pathname.split('/')[3]!;
        try {
          if (req.method === 'GET') {
            const cols = (url.searchParams.get('select') ?? '*'); if (!/^[a-z_,*]+$/.test(cols) || !/^integration_[a-z_]+$/.test(tbl)) return send(400, {});
            const r = await as(() => side.db.query(`select ${cols} from ${tbl}`)) as { rows: unknown[] }; return send(200, r.rows);
          }
          if (req.method === 'PATCH') { const id = (url.searchParams.get('link_id') ?? '').replace('eq.', ''); await as(() => side.db.query('update integration_links set status = $1 where link_id = $2', [JSON.parse(body).status, id])); return send(204, {}); }
          if (req.method === 'POST' && tbl === 'rpc') { const a = JSON.parse(body); await as(() => side.db.query('select public.integration_revoke_link($1, $2, $3)', [a.p_link_id, a.p_partner_ref, a.p_by])); return send(200, {}); }
        } catch (e) { return send(/permission denied/.test((e as Error).message) ? (sub ? 403 : 401) : 400, { message: 'permission denied' }); }
      }
      return send(404, {});
    } catch (e) { return send(500, { message: (e as Error).message }); }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r)); servers.push(server);
  urls[kind] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  w = await makeWorld();
  Object.defineProperty(w.clock, 'now', { get: () => new Date(), set: () => undefined, configurable: true });         // les messages sont signés à l'heure réelle
  await startProject(w.R, 'R'); await startProject(w.L, 'L');
}, 90_000);
afterAll(() => { for (const s of servers) s.close(); });

describe('scripts/prod/real-e2e.mjs contre deux projets simulés fidèles', () => {
  it('tous les contrôles passent (scénarios A et B, isolation, attaques, CORS, révocation)', async () => {
    await w.reset(); Object.defineProperty(w.clock, 'now', { get: () => new Date(), set: () => undefined, configurable: true });
    const lines: string[] = [];
    const { results, fails } = await run({
      REVEM_SUPABASE_URL: urls.R, REVEM_ANON_KEY: 'anon-r', LEXNOTE_SUPABASE_URL: urls.L, LEXNOTE_ANON_KEY: 'anon-l',
      REVEM_A_EMAIL: 'a@revem.t', REVEM_A_PASSWORD: 'pw', REVEM_B_EMAIL: 'b@revem.t', REVEM_B_PASSWORD: 'pw', LEXNOTE_A_EMAIL: 'a@lex.t', LEXNOTE_A_PASSWORD: 'pw', LEXNOTE_B_EMAIL: 'b@lex.t', LEXNOTE_B_PASSWORD: 'pw',
      INTEGRATION_KEY: KEY, INTEGRATION_KEY_ID: 'k1', LEXNOTE_ORIGIN: 'https://lexnote.example.app', REVEM_ORIGIN: 'https://antsvfr.github.io',
    }, { log: (s: string) => lines.push(s) });
    const failed = lines.filter((l) => l.startsWith('FAIL'));
    expect(failed).toEqual([]);
    expect(fails).toBe(0);
    expect(results.filter((r: { ok: boolean; skipped?: boolean }) => r.ok && !r.skipped).length).toBeGreaterThan(70);
    const text = lines.join('\n');
    expect(text).not.toContain(KEY); expect(text).not.toContain('test-');                       // ni clé d'intégration, ni jeton dans la sortie
    expect(text).toContain('SKIP — intention expirée');
  }, 120_000);

  it('le script ÉCHOUE quand le déploiement est mauvais (clé d’intégration différente entre les deux projets)', async () => {
    await w.reset(); Object.defineProperty(w.clock, 'now', { get: () => new Date(), set: () => undefined, configurable: true });
    const orig = w.R.gw.cfg.keys; const key0 = orig.k1!;
    // 1) mauvaise clé configurée côté REV-EM : les messages légitimes ne sont plus authentifiés → le script doit échouer
    w.R.gw.cfg.keys = { k1: 'y'.repeat(48) };
    const lines: string[] = [];
    const out = await run({
      REVEM_SUPABASE_URL: urls.R, REVEM_ANON_KEY: 'a', LEXNOTE_SUPABASE_URL: urls.L, LEXNOTE_ANON_KEY: 'a',
      REVEM_A_EMAIL: 'a@revem.t', REVEM_A_PASSWORD: 'pw', REVEM_B_EMAIL: 'b@revem.t', REVEM_B_PASSWORD: 'pw', LEXNOTE_A_EMAIL: 'a@lex.t', LEXNOTE_A_PASSWORD: 'pw', LEXNOTE_B_EMAIL: 'b@lex.t', LEXNOTE_B_PASSWORD: 'pw',
      INTEGRATION_KEY: key0, LEXNOTE_ORIGIN: 'https://lexnote.example.app', REVEM_ORIGIN: 'https://antsvfr.github.io',
    }, { log: (s: string) => lines.push(s) });
    w.R.gw.cfg.keys = orig;
    expect(out.fails).toBeGreaterThan(0);
    expect(lines.some((l) => l.startsWith('FAIL') && /message légitime signé/.test(l))).toBe(true);
  }, 120_000);
});
