// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error module .mjs sans types
import * as C from '../../scripts/prod/lib/preflight-checks.mjs';
// @ts-expect-error module .mjs sans types
import { main, runPreflight } from '../../scripts/prod/preflight.mjs';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role: string) => `eyJ${b64({ alg: 'HS256' }).slice(3)}.${b64({ role })}.signaturesignature`;
const level = (r: { level: string } | { level: string }[]) => (Array.isArray(r) ? r.map((x) => x.level) : r.level);

afterEach(() => { vi.unstubAllEnvs(); });

describe('préflight — dépôt réel', () => {
  it('migrations, fonctions, config.toml, paquet, architecture client, secrets : PASS', () => {
    for (const r of [C.checkMigrations(), C.checkEdgeFunctions(), C.checkConfigToml(), C.checkBundle('/nonexistent'), C.checkClientArchitecture(), C.checkCommittedSecrets()]) expect(r.level, `${r.name}: ${r.msg}`).toBe('PASS');
  });
  it('code de sortie 0 sans FAIL ; WARN pour tout ce qui n’a pas été exécuté', () => {
    vi.stubEnv('REVEM_REPO', '/nonexistent');   // l'état d'un autre dépôt local ne doit pas influencer ce test
    const lines: string[] = [];
    expect(main([], (l: string) => lines.push(l))).toBe(0);
    const text = lines.join('\n');
    expect(text).toMatch(/\[WARN\] supabase-smoke/);
    expect(text).toMatch(/\[WARN\] production-build/);
  });
  it('--target production : variables manquantes → FAIL, code ≠ 0', () => {
    vi.stubEnv('REVEM_REPO', '/nonexistent');
    const r = runPreflight(['--target', 'production'], {});
    expect(r.filter((x: { level: string }) => x.level === 'FAIL').map((x: { name: string }) => x.name)).toEqual(expect.arrayContaining(['frontend-env', 'server-env']));
  });
});

describe('préflight — variables', () => {
  const okFront = { VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', VITE_SUPABASE_ANON_KEY: jwt('anon'), VITE_AI_URL: 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/study-ai' };
  it('frontend correct → PASS', () => expect(level(C.checkFrontendEnv(okFront, true))).toEqual(['PASS']));
  it('clé service_role côté navigateur → FAIL, sans jamais afficher la clé', () => {
    const key = jwt('service_role');
    const r = C.checkFrontendEnv({ ...okFront, VITE_SUPABASE_ANON_KEY: key }, false);
    expect(level(r)).toContain('FAIL');
    expect(JSON.stringify(r)).not.toContain(key);
  });
  it('backend mock en production, URL non https → FAIL', () => {
    expect(level(C.checkFrontendEnv({ ...okFront, VITE_BACKEND: 'mock' }, false))).toContain('FAIL');
    expect(level(C.checkFrontendEnv({ ...okFront, VITE_AI_URL: 'http://x' }, true))).toContain('FAIL');
  });
  it('APP_ORIGINS : manquante (prod) → FAIL ; « * » ou http → FAIL ; https → PASS', () => {
    const base = { ANTHROPIC_API_KEY: 'x', INTEGRATION_KEY: 'y' };
    expect(level(C.checkServerEnv(base, true))).toContain('FAIL');
    expect(level(C.checkServerEnv({ ...base, APP_ORIGINS: '*' }, false))).toContain('FAIL');
    expect(level(C.checkServerEnv({ ...base, APP_ORIGINS: 'http://exemple.fr' }, false))).toContain('FAIL');
    expect(level(C.checkServerEnv({ ...base, APP_ORIGINS: 'https://lex-note-svfr.vercel.app,http://localhost:5173' }, true))).toEqual(['PASS']);
  });
  it('budget global désactivé ou IA coupée → WARN visible', () => {
    const r = C.checkServerEnv({ APP_ORIGINS: 'https://a.fr', ANTHROPIC_API_KEY: 'x', INTEGRATION_KEY: 'y', STUDY_AI_GLOBAL_MAX_REQUESTS_DAY: '0', STUDY_AI_ENABLED: 'false' }, true);
    expect(r.map((x: { msg: string }) => x.msg).join()).toMatch(/DÉSACTIVÉ.*COUPÉE|COUPÉE.*DÉSACTIVÉ/s);
  });
});

describe('préflight — détection de secrets', () => {
  it('reconnaît clé IA, jeton Supabase, clé privée, JWT service_role ; ignore un JWT anon', () => {
    expect(C.scanText('k = sk-ant-api03-' + 'a'.repeat(40))).toEqual(['clé API Anthropic']);
    expect(C.scanText('t = sbp_' + 'a1'.repeat(20))).toEqual(["jeton d'accès personnel Supabase"]);
    expect(C.scanText('-----BEGIN ' + 'PRIVATE KEY-----')).toEqual(['clé privée']);
    expect(C.scanText(jwt('service_role'))).toEqual(['clé service_role']);
    expect(C.scanText(jwt('anon'))).toEqual([]);
    expect(C.scanText(jwt('service_role'), { fixture: true })).toEqual([]);
  });
  it('config.toml : verify_jwt lu correctement', () => {
    expect(C.parseVerifyJwt('[functions.a]\nverify_jwt = false\n[functions.b]\n')).toEqual({ a: false });
  });
});
