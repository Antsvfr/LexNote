// Banc d'essai : DEUX bases Postgres réelles (PGlite) = les deux projets Supabase indépendants, deux services de liaison,
// un « réseau » qui relie uniquement les deux passerelles. Utilisé par les tests ; jamais importé par le code de production.
import { existsSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { readIntegrationConfig, type IntegrationConfig } from './config';
import { handleGatewayRequest, handleUserRequest, type GatewayDeps, type UserDeps } from './gateway';
import { createLinkService, type LinkService } from './linking';
import { createPeerClient, type FetchLike } from './peer';
import { createRpcStore, type LinkStore, type RpcClient } from './store';
import { IntegrationFailure, fail } from './errors';

export const KEY = 'k'.repeat(24) + 'S3cr3t-inter-app-key-0123456789';
export const U = {
  revemA: 'aaaaaaaa-0000-4000-8000-00000000000a', revemB: 'bbbbbbbb-0000-4000-8000-00000000000b',
  lexA: 'aaaaaaaa-1111-4111-8111-00000000000a', lexB: 'bbbbbbbb-1111-4111-8111-00000000000b',
};
export const EMAIL = { revemA: 'alice@revem.test', revemB: 'bob@revem.test', lexA: 'alice@lexnote.test', lexB: 'bob@lexnote.test' };
const LEX_SQL = 'supabase/migrations/20261011000000_integration_links.sql';
const REVEM_SQL = `${process.env.REVEM_REPO ?? '/home/user/rev-em'}/supabase/migrations/006_integration_links.sql`;

export async function makeDb(kind: 'revem' | 'lexnote', users: [string, string, string][]): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, ${kind === 'revem' ? 'display_name text,' : ''} first_name text);`);
  let sql: string;
  if (kind === 'revem') sql = existsSync(REVEM_SQL) ? readFileSync(REVEM_SQL, 'utf8') : readFileSync(LEX_SQL, 'utf8').replace("coalesce(nullif(first_name, ''), 'Compte LexNote')", "coalesce(nullif(display_name, ''), nullif(first_name, ''), 'Compte REV-EM')");
  else sql = readFileSync(LEX_SQL, 'utf8');
  await db.exec(sql);
  for (const [id, email, name] of users) {
    await db.query('insert into auth.users values ($1,$2)', [id, email]);
    await db.query(kind === 'revem' ? 'insert into public.profiles (id, display_name) values ($1,$2)' : 'insert into public.profiles (id, first_name) values ($1,$2)', [id, name]);
  }
  await db.exec('grant select on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;');
  return db;
}

/** Adaptateur `supabase.rpc()` au-dessus de PGlite (rôle propriétaire = service_role/serveur). */
export const rpcOf = (db: PGlite): RpcClient => ({
  async rpc(fn, args) {
    const keys = Object.keys(args);
    try {
      const r = await db.query<{ r: unknown }>(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map((k) => args[k]));
      return { data: r.rows[0]?.r ?? null, error: null };
    } catch (e) { return { data: null, error: { message: (e as Error).message } }; }
  },
});

export interface Side { cfg: IntegrationConfig; db: PGlite; store: LinkStore; service: LinkService; gw: GatewayDeps; user: UserDeps }
export interface World {
  R: Side; L: Side;
  /** Trafic serveur → serveur (requêtes ET réponses), pour les assertions de confidentialité. */
  traffic: { dir: string; body: string; headers: Record<string, string>; status?: number }[];
  clock: { now: Date }; netDown: { value: boolean }; hook: { before?: (op: string) => void };
  reset(): Promise<void>;
  userReq(side: 'R' | 'L', userId: string | null, body: unknown, origin?: string | null): Promise<{ status: number; json: any; headers: Headers }>;
}

export async function makeWorld(): Promise<World> {
  const clock = { now: new Date('2026-10-08T10:00:00.000Z') };
  const now = () => clock.now;
  const mk = (self: 'revem' | 'lexnote'): IntegrationConfig => readIntegrationConfig(self, (k) => ({
    INTEGRATION_ENV: 'production', INTEGRATION_KEY_ID: 'k1', INTEGRATION_KEY: KEY,
    INTEGRATION_SELF_APP_URL: self === 'revem' ? 'https://antsvfr.github.io/REV-EM/' : 'https://lexnote.example.app/',
    INTEGRATION_PEER_APP_URL: self === 'revem' ? 'https://lexnote.example.app/' : 'https://antsvfr.github.io/REV-EM/',
    INTEGRATION_PEER_GATEWAY_URL: self === 'revem' ? 'https://lex.supabase.co/functions/v1/integration-gateway' : 'https://rev.supabase.co/functions/v1/integration-gateway',
  } as Record<string, string>)[k]);
  const Rcfg = mk('revem'); const Lcfg = mk('lexnote');
  const Rdb = await makeDb('revem', [[U.revemA, EMAIL.revemA, 'Alice'], [U.revemB, EMAIL.revemB, 'Bob']]);
  const Ldb = await makeDb('lexnote', [[U.lexA, EMAIL.lexA, 'Alice'], [U.lexB, EMAIL.lexB, 'Bob']]);
  const traffic: World['traffic'] = []; const netDown = { value: false }; const hook: World['hook'] = {};
  const sides = {} as { R: Side; L: Side };

  const netTo = (target: 'R' | 'L'): FetchLike => async (url, init) => {
    hook.before?.(JSON.parse(init.body)?.payload?.operation);
    if (netDown.value) throw new Error('réseau coupé');
    traffic.push({ dir: `→${target}`, body: init.body, headers: init.headers });
    const res = await handleGatewayRequest(new Request(url, { method: init.method, headers: init.headers, body: init.body }), sides[target].gw);
    const text = await res.text(); const headers: Record<string, string> = {}; res.headers.forEach((v, k) => { headers[k] = v; });
    traffic.push({ dir: `←${target}`, body: text, headers, status: res.status });
    return { status: res.status, text: async () => text, headers: { get: (n: string) => res.headers.get(n) } };
  };
  const build = (cfg: IntegrationConfig, db: PGlite, peerTarget: 'R' | 'L'): Side => {
    const store = createRpcStore(rpcOf(db));
    const service = createLinkService({ cfg, store, peer: createPeerClient(cfg, { fetch: netTo(peerTarget), now }), now });
    const authenticate = async (req: Request) => { const a = req.headers.get('authorization') ?? ''; const m = /^Bearer test-(.+)$/.exec(a); return m ? m[1]! : fail('UNAUTHENTICATED', 'Jeton absent ou invalide.'); };
    return { cfg, db, store, service, gw: { cfg, store, service, now }, user: { cfg, service, authenticate } };
  };
  sides.R = build(Rcfg, Rdb, 'L'); sides.L = build(Lcfg, Ldb, 'R');

  return {
    R: sides.R, L: sides.L, traffic, clock, netDown, hook,
    async reset() {
      for (const db of [Rdb, Ldb]) await db.exec('truncate integration_links, integration_link_intents, integration_nonces');
      traffic.length = 0; netDown.value = false; hook.before = undefined; clock.now = new Date('2026-10-08T10:00:00.000Z');
    },
    async userReq(side, userId, body, origin = side === 'R' ? 'https://antsvfr.github.io' : 'https://lexnote.example.app') {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (userId) headers.authorization = `Bearer test-${userId}`;
      if (origin) headers.origin = origin;
      const res = await handleUserRequest(new Request('https://x.test/integration-link', { method: 'POST', headers, body: JSON.stringify(body) }), sides[side].user);
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
    },
  };
}
export { IntegrationFailure };
