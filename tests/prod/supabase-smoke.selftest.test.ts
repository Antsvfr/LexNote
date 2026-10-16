// @vitest-environment node
import { describe, expect, it } from 'vitest';
// @ts-expect-error module .mjs sans types
import { assertSafeTarget, run, SMOKE_DOMAIN } from '../../scripts/prod/supabase-smoke.mjs';

const REF = 'abcdefghijklmnopqrst'; const PROD = 'zzzzzzzzzzzzzzzzzzzz';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const key = (role: string, ref = REF) => `eyJhbGciOiJIUzI1NiJ9.${b64({ role, ref })}.sig`;
const ENV = { SMOKE_CONFIRM: '1', SMOKE_SUPABASE_URL: `https://${REF}.supabase.co`, SMOKE_EXPECTED_REF: REF, SMOKE_PRODUCTION_REFS: PROD, SMOKE_ANON_KEY: key('anon'), SMOKE_SERVICE_ROLE_KEY: key('service_role') };

describe('supabase-smoke — garde-fous (jamais contre la production)', () => {
  it('configuration correcte acceptée', () => expect(assertSafeTarget(ENV)).toEqual({ ref: REF }));
  it.each([
    ['SMOKE_CONFIRM absent', { SMOKE_CONFIRM: '' }, /SMOKE_CONFIRM=1/],
    ['SMOKE_CONFIRM=true (pas 1)', { SMOKE_CONFIRM: 'true' }, /SMOKE_CONFIRM=1/],
    ['URL non Supabase', { SMOKE_SUPABASE_URL: 'https://exemple.fr' }, /https:\/\/<réf>/],
    ['référence attendue différente', { SMOKE_EXPECTED_REF: PROD }, /mauvais projet/],
    ['projet déclaré production', { SMOKE_SUPABASE_URL: `https://${PROD}.supabase.co`, SMOKE_EXPECTED_REF: PROD, SMOKE_ANON_KEY: key('anon', PROD), SMOKE_SERVICE_ROLE_KEY: key('service_role', PROD) }, /PRODUCTION/],
    ['références de production non précisées', { SMOKE_PRODUCTION_REFS: '' }, /SMOKE_PRODUCTION_REFS/],
    ['clé anon qui est en réalité service_role', { SMOKE_ANON_KEY: key('service_role') }, /pas une clé anon/],
    ['clé d\'un autre projet', { SMOKE_SERVICE_ROLE_KEY: key('service_role', PROD) }, /claim ref/],
  ])('refuse : %s', (_n, over, re) => expect(() => assertSafeTarget({ ...ENV, ...over })).toThrow(re));
  it('le message d\'erreur ne contient jamais une clé', () => {
    try { assertSafeTarget({ ...ENV, SMOKE_SERVICE_ROLE_KEY: key('anon') }); } catch (e) { expect(String((e as Error).message)).not.toContain('eyJ'); }
  });
});

/** Faux projet Supabase en mémoire : comptes, jetons, RLS simplifiée sur `subjects`, déconnexion globale. */
function fakeProject(opts: { foreignUsers?: number; leakRls?: boolean } = {}) {
  type U = { id: string; email: string; password: string };
  const users: U[] = Array.from({ length: opts.foreignUsers ?? 0 }, (_, i) => ({ id: `real-${i}`, email: `vrai${i}@exemple.fr`, password: 'x' }));
  const tokens = new Map<string, string>(); const refresh = new Map<string, string>(); const subjects: { id: string; user_id: string; name: string; version: number }[] = [];
  const log: string[] = [];
  let n = 0;
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const u = new URL(input); const m = init.method ?? 'GET';
    const auth = String((init.headers as Record<string, string>).authorization).replace('Bearer ', '');
    const body = init.body ? JSON.parse(String(init.body)) : undefined; const svcCall = auth.includes(b64({ role: 'service_role', ref: REF }));
    const J = (s: number, j: unknown) => new Response(s === 204 ? null : JSON.stringify(j), { status: s });
    log.push(`${m} ${u.pathname}`);
    if (u.pathname === '/functions/v1/health') return J(200, { status: 'ok', services: { database: 'ok', schema: 'ok' } });
    if (u.pathname === '/auth/v1/admin/users' && m === 'GET') return J(200, { users });
    if (u.pathname === '/auth/v1/admin/users' && m === 'POST') { const x = { id: `u${++n}`, email: body.email, password: body.password }; users.push(x); return J(200, { id: x.id }); }
    if (u.pathname.startsWith('/auth/v1/admin/users/') && m === 'DELETE') { const id = u.pathname.split('/').pop(); users.splice(users.findIndex((x) => x.id === id), 1); for (let i = subjects.length - 1; i >= 0; i--) if (subjects[i]!.user_id === id) subjects.splice(i, 1); return J(200, {}); }
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') { const x = users.find((y) => y.email === body.email && y.password === body.password); if (!x) return J(400, {}); const t = `tok-${x.id}`; tokens.set(t, x.id); refresh.set(`ref-${x.id}`, x.id); return J(200, { access_token: t, refresh_token: `ref-${x.id}` }); }
    if (u.pathname === '/auth/v1/token') return refresh.has(body.refresh_token) ? J(200, {}) : J(400, {});
    if (u.pathname === '/auth/v1/logout') { const id = tokens.get(auth); refresh.delete(`ref-${id}`); return J(204, null); }
    if (u.pathname === '/auth/v1/user') return tokens.has(auth) ? J(200, { id: tokens.get(auth) }) : J(401, {});
    const uid = tokens.get(auth);
    if (u.pathname === '/rest/v1/profiles') return J(200, users.filter((x) => `id=eq.${x.id}` === u.search.slice(1).split('&')[0]).map((x) => ({ id: x.id })));
    if (u.pathname.startsWith('/rest/v1/rpc/')) return J(uid || svcCall ? 403 : 401, {});
    if (u.pathname === '/rest/v1/subjects') {
      if (!uid && !svcCall) return J(401, {});
      const visible = (s: { user_id: string }) => svcCall || opts.leakRls || s.user_id === uid;
      if (m === 'POST') { if (body.user_id && body.user_id !== uid) return J(403, {}); const s = { id: body.id, user_id: uid!, name: body.name, version: 1 }; subjects.push(s); return J(201, [s]); }
      const id = u.searchParams.get('id')?.replace('eq.', '');
      const rows = subjects.filter((s) => s.id === id && visible(s));
      if (m === 'PATCH') { rows.forEach((s) => { s.name = body.name; s.version++; }); return J(200, rows); }
      return J(200, rows);
    }
    return J(404, {});
  }) as unknown as typeof fetch;
  return { fetchImpl, users, subjects, log };
}

describe('supabase-smoke — déroulement sur un faux projet', () => {
  it('tout réussit, puis les comptes jetables sont supprimés (nettoyage), les comptes existants intacts', async () => {
    const p = fakeProject({ foreignUsers: 2 }); const lines: string[] = [];
    expect(await run(ENV, { log: (l: string) => lines.push(l), fetchImpl: p.fetchImpl })).toBe(0);
    expect(lines.filter((l) => l.startsWith('FAIL'))).toEqual([]);
    expect(p.users).toHaveLength(2);
    expect(p.users.some((u) => u.email.endsWith(SMOKE_DOMAIN))).toBe(false);
    expect(p.subjects).toHaveLength(0);
  });
  it('une fuite RLS est détectée (code 1) et le nettoyage a quand même lieu', async () => {
    const p = fakeProject({ leakRls: true }); const lines: string[] = [];
    expect(await run(ENV, { log: (l: string) => lines.push(l), fetchImpl: p.fetchImpl })).toBe(1);
    expect(lines.join('\n')).toMatch(/FAIL — RLS — B ne voit pas/);
    expect(p.users).toHaveLength(0);
  });
  it('projet contenant de nombreux comptes réels → refusé AVANT toute écriture', async () => {
    const p = fakeProject({ foreignUsers: 30 });
    await expect(run(ENV, { log: () => {}, fetchImpl: p.fetchImpl })).rejects.toThrow(/REFUSÉ/);
    expect(p.log.some((l) => l.startsWith('POST') || l.startsWith('DELETE'))).toBe(false);
  });
  it('aucune clé n\'apparaît dans la sortie', async () => {
    const p = fakeProject(); const lines: string[] = [];
    await run(ENV, { log: (l: string) => lines.push(l), fetchImpl: p.fetchImpl });
    expect(lines.join('\n')).not.toMatch(/eyJ|tok-|ref-/);
  });
});
