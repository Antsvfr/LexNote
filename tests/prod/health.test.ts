// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildReport, classifyProbe, handleHealth, type HealthDeps } from '../../supabase/functions/health/handler';

const ALL_OK = { core: true, study: true, transcript_artifacts: true, integration: true, course_refs: true, devices: true, ai_usage: true };
const deps = (o: Partial<HealthDeps> & { vars?: Record<string, string> } = {}): HealthDeps => ({
  env: (k) => o.vars?.[k],
  appHealth: o.appHealth ?? (async () => ALL_OK),
  probeFunction: o.probeFunction ?? (async () => 405),
  now: () => new Date('2026-10-16T10:00:00Z'),
});
const FULL = { INTEGRATION_KEY: 'SECRET-KEY-VALUE', ANTHROPIC_API_KEY: 'sk-ant-SECRET', RELEASE_VERSION: '1.2.3' };

describe('health — état', () => {
  it('tout va bien → ok', async () => {
    const r = await buildReport(deps({ vars: FULL }));
    expect(r).toMatchObject({ status: 'ok', version: '1.2.3', services: { database: 'ok', schema: 'ok', integration: 'ok', ai: 'enabled' } });
  });
  it('base injoignable → down (503)', async () => {
    const d = deps({ vars: FULL, appHealth: async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:5432 password=hunter2'); } });
    const res = await handleHealth(new Request('https://x/health'), d);
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text).services).toMatchObject({ database: 'down', schema: 'unknown' });
    expect(text).not.toMatch(/hunter2|ECONNREFUSED|10\.0\.0\.1/);
  });
  it('migration manquante → degraded + noms des éléments manquants', async () => {
    const r = await buildReport(deps({ vars: FULL, appHealth: async () => ({ ...ALL_OK, devices: false, ai_usage: false }) }));
    expect(r.status).toBe('degraded');
    expect(r.services.schema).toBe('incomplete');
    expect(r.missing).toEqual(['devices', 'ai_usage']);
  });
  it('passerelle protégée par JWT / non déployée / injoignable sont distinguées', async () => {
    expect(classifyProbe(401)).toBe('jwt_protected');
    expect(classifyProbe(404)).toBe('not_deployed');
    expect(classifyProbe(null)).toBe('error');
    expect(classifyProbe(502)).toBe('error');
    expect(classifyProbe(405)).toBe('ok');
    const r = await buildReport(deps({ vars: FULL, probeFunction: async (n) => (n === 'integration-gateway' ? 401 : 405) }));
    expect(r.services.integration).toBe('jwt_protected');
    expect(r.status).toBe('degraded');
  });
  it('intégration non configurée n’est pas une panne ; aucune sonde réseau', async () => {
    let probed = 0;
    const r = await buildReport(deps({ vars: {}, probeFunction: async () => { probed++; return 200; } }));
    expect(r.services.integration).toBe('not_configured');
    expect(r.services.ai).toBe('not_configured');
    expect(r.status).toBe('ok');
    expect(probed).toBe(0);
  });
  it('interrupteur IA coupé → ai: disabled', async () => {
    expect((await buildReport(deps({ vars: { ...FULL, STUDY_AI_ENABLED: 'false' } }))).services.ai).toBe('disabled');
  });
});

describe('health — aucune donnée sensible, méthodes', () => {
  it('la réponse ne contient aucun secret ni valeur de configuration', async () => {
    const res = await handleHealth(new Request('https://x/health'), deps({ vars: { ...FULL, SUPABASE_SERVICE_ROLE_KEY: 'srv-ROLE-SECRET', INTEGRATION_KEYS: 'k1:SECRET2' } }));
    const text = await res.text();
    for (const s of ['SECRET', 'sk-ant', 'srv-ROLE', 'service_role', 'supabase.co']) expect(text).not.toContain(s);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['services', 'status', 'time', 'version']);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it('GET seulement ; OPTIONS 204 ; POST 405', async () => {
    expect((await handleHealth(new Request('https://x/health', { method: 'POST' }), deps())).status).toBe(405);
    expect((await handleHealth(new Request('https://x/health', { method: 'OPTIONS' }), deps())).status).toBe(204);
  });
  it('config.toml : la sonde est publique (verify_jwt = false)', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('supabase/config.toml', 'utf8')).toMatch(/\[functions\.health\]\s*\nverify_jwt = false/);
  });
});
