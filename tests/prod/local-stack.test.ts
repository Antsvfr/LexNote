// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error module .mjs sans types
import { STACKS, buildConfig, buildFunctionsEnv, parseEnvOutput, parseKv, prepare, up, down } from '../../scripts/prod/local-stack.mjs';
// @ts-expect-error module .mjs sans types
import { buildSteps, verify } from '../../scripts/prod/local-verify.mjs';

const lexConfig = readFileSync('supabase/config.toml', 'utf8');
function fakeRepo(name: string, config: string) {
  const d = mkdtempSync(join(tmpdir(), `ls-${name}-`));
  mkdirSync(join(d, 'supabase/migrations'), { recursive: true }); mkdirSync(join(d, 'supabase/functions/integration-gateway'), { recursive: true });
  writeFileSync(join(d, 'supabase/migrations/001_a.sql'), 'select 1;'); writeFileSync(join(d, 'supabase/functions/integration-gateway/index.ts'), '//'); writeFileSync(join(d, 'supabase/config.toml'), config);
  return d;
}
const revConfig = 'project_id = "rev-em"\n\n[functions.integration-gateway]\nverify_jwt = false\n';

describe('configuration des deux piles — isolation', () => {
  it('ports tous différents entre les deux piles, et à l’intérieur de chaque pile ; project_id distincts', () => {
    const all = Object.values(STACKS).flatMap((s: Record<string, unknown>) => ['api', 'db', 'shadow', 'pooler', 'studio', 'smtp', 'analytics', 'inspector'].map((k) => s[k] as number));
    expect(new Set(all).size).toBe(all.length);
    expect(STACKS.lexnote.projectId).not.toBe(STACKS.revem.projectId);
    for (const p of all) expect(p).not.toBe(54321);           // ne heurte pas la pile par défaut d'un autre projet
  });
  it('reprend [functions.*] / verify_jwt du dépôt et ne change que project_id et les ports ; le fichier du dépôt n’est jamais modifié', () => {
    const cfg = buildConfig(lexConfig, 'lexnote');
    expect(cfg).toMatch(/project_id = "lexnote-local"/);
    expect(cfg).not.toMatch(/project_id = "lexnote"/);
    for (const fn of ['integration-gateway', 'integration-link', 'health']) expect(cfg).toMatch(new RegExp(`\\[functions\\.${fn}\\]\\s*\\nverify_jwt = false`));
    expect(cfg).toContain(`port = ${STACKS.lexnote.api}`);
    expect(readFileSync('supabase/config.toml', 'utf8')).toBe(lexConfig);
  });
  it('refuse de générer si le config.toml du dépôt définit déjà une section de ports (pas de doublon TOML)', () => {
    expect(() => buildConfig(`${lexConfig}\n[api]\nport = 1\n`, 'lexnote')).toThrow(/\[api\]/);
  });
  it('aucune adresse ni référence de production dans la configuration générée', () => {
    const text = buildConfig(lexConfig, 'lexnote') + buildFunctionsEnv('lexnote', 'k'.repeat(48)) + buildFunctionsEnv('revem', 'k'.repeat(48));
    expect(text).not.toMatch(/supabase\.co|vercel\.app|github\.io|sk-ant|ANTHROPIC/);
  });
  it('variables des fonctions : développement local, IA coupée, passerelle du PAIR sur l’autre port, origines localhost uniquement', () => {
    const lex = buildFunctionsEnv('lexnote', 'K'.repeat(48)); const rev = buildFunctionsEnv('revem', 'K'.repeat(48));
    expect(lex).toContain('INTEGRATION_ENV=development'); expect(lex).toContain('STUDY_AI_ENABLED=false');
    expect(lex).toContain(`INTEGRATION_PEER_GATEWAY_URL=http://127.0.0.1:${STACKS.revem.api}/functions/v1/integration-gateway`);
    expect(rev).toContain(`INTEGRATION_PEER_GATEWAY_URL=http://127.0.0.1:${STACKS.lexnote.api}/functions/v1/integration-gateway`);
    expect(lex).toContain('APP_ORIGINS=http://localhost:5173'); expect(rev).toContain('APP_ORIGINS=http://localhost:8080');
    expect(lex).toContain(`INTEGRATION_KEY=${'K'.repeat(48)}`.slice(0, 40));
  });
});

describe('prepare — dossiers de travail et secrets', () => {
  it('génère deux dossiers isolés, une clé de test aléatoire, secrets.env en 0600, sans toucher aux dépôts', () => {
    const lex = fakeRepo('lex', lexConfig); const rev = fakeRepo('rev', revConfig); const home = mkdtempSync(join(tmpdir(), 'ls-home-'));
    const { key } = prepare({ home, repoRoot: lex, revemRepo: rev });
    expect(key.length).toBeGreaterThanOrEqual(48);
    for (const s of ['lexnote', 'revem']) {
      expect(existsSync(join(home, s, 'supabase/config.toml'))).toBe(true);
      expect(existsSync(join(home, s, 'supabase/migrations/001_a.sql'))).toBe(true);
      expect(existsSync(join(home, s, 'supabase/functions/integration-gateway/index.ts'))).toBe(true);
      expect(statSync(join(home, s, 'functions.env')).mode & 0o777).toBe(0o600);
    }
    expect(readFileSync(join(home, 'revem/functions.env'), 'utf8')).toContain(`INTEGRATION_KEY=${key}`);
    expect(readFileSync(join(home, 'lexnote/functions.env'), 'utf8')).toContain(`INTEGRATION_KEY=${key}`);   // MÊME clé des deux côtés
    expect(statSync(join(home, 'secrets.env')).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(lex, 'supabase/config.toml'), 'utf8')).toBe(lexConfig);
    expect(readFileSync(join(rev, 'supabase/config.toml'), 'utf8')).toBe(revConfig);
    // deux préparations successives → clés différentes (rien de figé / commité)
    expect(prepare({ home, repoRoot: lex, revemRepo: rev }).key).not.toBe(key);
  });
  it('refuse sans dépôt REV-EM', () => {
    expect(() => prepare({ home: mkdtempSync(join(tmpdir(), 'ls-')), repoRoot: fakeRepo('lex', lexConfig), revemRepo: '/nonexistent' })).toThrow(/REV-EM/);
  });
  it('le dossier de travail par défaut est hors du dépôt', async () => {
    // @ts-expect-error module .mjs sans types
    const { defaultHome } = await import('../../scripts/prod/local-stack.mjs');
    expect(defaultHome().startsWith(process.cwd())).toBe(false);
  });
});

describe('up / down — enchaînement des commandes (CLI simulé)', () => {
  it('démarre LexNote puis REV-EM avec --workdir distincts, lit les clés, sert les fonctions, crée 4 comptes via l’API administrateur LOCALE', async () => {
    const lex = fakeRepo('lex', lexConfig); const rev = fakeRepo('rev', revConfig); const home = mkdtempSync(join(tmpdir(), 'ls-home-'));
    const calls: string[][] = []; const served: string[] = []; const fetched: string[] = []; const logs: string[] = [];
    const exec = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args]);
      if (args[0] === 'status') return { code: 0, out: 'API_URL="http://127.0.0.1:1"\nANON_KEY="anon-jwt"\nSERVICE_ROLE_KEY="svc-jwt"\nDB_URL="postgresql://postgres:postgres@127.0.0.1:5/postgres"\n', err: '' };
      return { code: 0, out: '', err: '' };
    };
    const fetchImpl = (async (url: string, init?: RequestInit) => { fetched.push(`${init?.method ?? 'GET'} ${url}`); return new Response('{}', { status: init?.method === 'POST' ? 200 : 405 }); }) as unknown as typeof fetch;
    const env = await up({ home, repoRoot: lex, revemRepo: rev, exec, fetchImpl, startServe: (_h: string, s: string) => served.push(s), wait: async () => {}, log: (l: string) => logs.push(l) });
    const starts = calls.filter((c) => c[1] === 'start');
    expect(starts.map((c) => c[c.indexOf('--workdir') + 1])).toEqual([join(home, 'lexnote'), join(home, 'revem')]);
    expect(served).toEqual(['lexnote', 'revem']);
    expect(fetched.filter((f) => f.startsWith('POST')).length).toBe(4);
    for (const f of fetched) expect(f).toMatch(/^(GET|POST) http:\/\/127\.0\.0\.1:(54421|54521)\//);   // aucune requête hors des deux piles locales
    expect(env.LEX_A_EMAIL).toBe('lex-a@smoke.lexnote.invalid'); expect(env.REV_B_EMAIL).toBe('rev-b@smoke.lexnote.invalid');
    expect(statSync(join(home, 'stacks.env')).mode & 0o777).toBe(0o600);
    const key = parseKv(readFileSync(join(home, 'secrets.env'), 'utf8')).INTEGRATION_KEY;
    expect(logs.join('\n')).not.toContain(key); expect(logs.join('\n')).not.toContain('svc-jwt');
    down({ home, exec, log: () => {} });
    const stops = calls.filter((c) => c[1] === 'stop');
    expect(stops).toHaveLength(2);
    for (const c of stops) { expect(c).toContain('--workdir'); expect(c).not.toContain('--all'); }       // n'arrête JAMAIS les autres piles de la machine
  });
  it('échec de démarrage → erreur claire, sans démarrer la seconde pile', async () => {
    const lex = fakeRepo('lex', lexConfig); const rev = fakeRepo('rev', revConfig); const calls: string[][] = [];
    await expect(up({ home: mkdtempSync(join(tmpdir(), 'ls-home-')), repoRoot: lex, revemRepo: rev, exec: (c: string, a: string[]) => { calls.push([c, ...a]); return { code: 1, out: '', err: '' }; }, log: () => {} })).rejects.toThrow(/supabase start \(lexnote\)/);
    expect(calls.filter((c) => c[1] === 'start')).toHaveLength(1);
  });
  it('parseEnvOutput lit la sortie de `supabase status -o env`', () => {
    expect(parseEnvOutput('API_URL="http://127.0.0.1:54321"\nANON_KEY="abc"\nX=1\n')).toEqual({ API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'abc', X: '1' });
  });
});

describe('verify — étapes, critères, preuves, confidentialité', () => {
  const E = { LEX_API_URL: 'http://127.0.0.1:54421', REV_API_URL: 'http://127.0.0.1:54521', LEX_ANON_KEY: 'LA', REV_ANON_KEY: 'RA', LEX_SERVICE_ROLE_KEY: 'LS', REV_SERVICE_ROLE_KEY: 'RS', LEX_DB_URL: 'postgresql://x@127.0.0.1:54422/postgres', INTEGRATION_KEY: 'S'.repeat(48), LEX_A_EMAIL: 'a', LEX_B_EMAIL: 'b', REV_A_EMAIL: 'c', REV_B_EMAIL: 'd', LEX_PASSWORD_A: 'p1', LEX_PASSWORD_B: 'p2', REV_PASSWORD_A: 'p3', REV_PASSWORD_B: 'p4' };
  it('les étapes d’intégration forcent le mode local ; aucune URL hébergée ni origine officielle', () => {
    const steps = buildSteps(E);
    for (const s of steps.filter((x: { id: string }) => ['diagnostic', 'real-e2e'].includes(x.id))) {
      expect(s.env.INTEGRATION_LOCAL).toBe('1'); expect(s.env.LEXNOTE_SUPABASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:/); expect(s.env.REVEM_SUPABASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:/);
    }
    expect(steps.find((s: { id: string }) => s.id === 'smoke-lexnote').env.SMOKE_LOCAL).toBe('1');
    expect(JSON.stringify(steps.map((s: { env: unknown; cmd: unknown }) => [s.env, s.cmd]))).not.toMatch(/supabase\.co|vercel\.app|github\.io/);
  });
  it('enregistre une preuve SEULEMENT pour une étape réussie, avec la mention « piles LOCALES » ; jamais ai-real-smoke', () => {
    const home = mkdtempSync(join(tmpdir(), 'ls-home-'));
    writeFileSync(join(home, 'stacks.env'), Object.entries(E).filter(([k]) => !/PASSWORD|INTEGRATION_KEY$/.test(k)).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
    writeFileSync(join(home, 'secrets.env'), `INTEGRATION_KEY=${E.INTEGRATION_KEY}\nLEX_PASSWORD_A=p1\nLEX_PASSWORD_B=p2\nREV_PASSWORD_A=p3\nREV_PASSWORD_B=p4\n`);
    const recorded: string[][] = [];
    const exec = (cmd: string[]) => {
      if (cmd[1] === 'scripts/prod/evidence.mjs') { recorded.push(cmd); return { code: 0, out: '' }; }
      const id = cmd[1];
      if (id.endsWith('migration-status.mjs')) return { code: 0, out: 'Aucune migration à appliquer.' };
      if (id.endsWith('supabase-smoke.mjs')) return { code: 0, out: 'PASS — x\n25/25' };
      if (id.endsWith('integration-diagnostic.mjs')) return { code: 0, out: '[PASS] INT-GW — ok\n[PASS] INT-HMAC — ok' };
      if (id.endsWith('real-e2e.mjs')) return { code: 1, out: `FAIL — attaque non refusée ${E.INTEGRATION_KEY}` };       // échec : aucune preuve, et la clé est masquée
      return { code: 0, out: 'PASS — INTERRUPTEUR — sans jeton : 503\nPASS — INTERRUPTEUR — avec jeton : 503' };
    };
    const logs: string[] = [];
    const code = verify({ home, repoRoot: process.cwd(), record: true, exec, log: (l: string) => logs.push(l) });
    expect(code).toBe(1);
    expect(recorded.map((c) => c[3]).sort()).toEqual(['ai-killswitch-local', 'integration-diagnostic']);
    expect(recorded.map((c) => c[3])).not.toContain('integration-real-e2e');          // échec → pas de preuve
    expect(recorded.map((c) => c[3])).not.toContain('ai-real-smoke');                  // le fournisseur réel reste hors de portée
    for (const c of recorded) expect(c.join(' ')).toMatch(/piles Supabase LOCALES réelles \(pas de validation cloud\)/);
    const all = logs.join('\n') + readFileSync(join(home, 'verify-report.json'), 'utf8');
    expect(all).not.toContain(E.INTEGRATION_KEY); expect(all).not.toMatch(/p1|p2|p3|p4/);
  });
});
