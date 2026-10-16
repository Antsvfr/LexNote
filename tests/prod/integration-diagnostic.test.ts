// @vitest-environment node
import { describe, expect, it } from 'vitest';
// @ts-expect-error module .mjs sans types
import { diagnose, REASON_CODES } from '../../scripts/prod/integration-diagnostic.mjs';

const KEY = 'k'.repeat(48);
const ENV = { INTEGRATION_KEY: KEY, LEXNOTE_SUPABASE_URL: 'https://lexnoteprojectref0000.supabase.co' };
/** Passerelle simulée : `mode` choisit la réponse à un message STATUS signé. */
const gateway = (mode: string, extra: { date?: string; getStatus?: number } = {}) => (async (url: string, init: RequestInit = {}) => {
  const m = init.method ?? 'GET';
  if (String(url).endsWith('integration-gateway')) {
    if (m === 'GET') return new Response(extra.getStatus === 401 ? '{"message":"Invalid JWT"}' : '{}', { status: extra.getStatus ?? 405, headers: extra.date ? { date: extra.date } : {} });
    return mode === 'ok' ? new Response('{"code":"LINK_NOT_FOUND"}', { status: 404 }) : new Response(JSON.stringify({ details: { reason: mode } }), { status: 401 });
  }
  return new Response(null, { status: 204, headers: mode === 'cors' ? {} : { 'access-control-allow-origin': 'https://lex-note-svfr.vercel.app' } });
}) as unknown as typeof fetch;
const ids = (r: { level: string; id: string }[], lvl: string) => r.filter((x) => x.level === lvl).map((x) => x.id);

describe('diagnostic d’intégration', () => {
  it('tout est correct → PASS (HMAC, kid, URL), jamais de clé affichée', async () => {
    const r = await diagnose(ENV, { fetchImpl: gateway('ok') });
    expect(ids(r, 'PASS')).toEqual(expect.arrayContaining(['INT-GW', 'INT-HMAC', 'INT-URL']));
    expect(ids(r, 'FAIL')).toEqual([]);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
  it.each([['unknown-key', 'INT-KID-401'], ['bad-signature', 'INT-HMAC-401'], ['expired', 'INT-CLOCK-401'], ['unknown-sender', 'INT-PEER-401']])('refus « %s » → %s', async (reason, id) => {
    expect(ids(await diagnose(ENV, { fetchImpl: gateway(reason) }), 'FAIL')).toContain(id);
    expect(REASON_CODES[reason][0]).toBe(id);
  });
  it('verify_jwt actif sur la passerelle → INT-GW-JWT', async () => {
    expect(ids(await diagnose(ENV, { fetchImpl: gateway('ok', { getStatus: 401 }) }), 'FAIL')).toEqual(['INT-GW-JWT']);
  });
  it('passerelle non déployée → INT-GW-404', async () => {
    expect(ids(await diagnose(ENV, { fetchImpl: gateway('ok', { getStatus: 404 }) }), 'FAIL')).toEqual(['INT-GW-404']);
  });
  it('horloge décalée de 10 min → FAIL INT-CLOCK ; origine non autorisée → INT-URL', async () => {
    const skewed = await diagnose(ENV, { fetchImpl: gateway('ok', { date: new Date(Date.now() - 600_000).toUTCString() }) });
    expect(ids(skewed, 'FAIL')).toContain('INT-CLOCK');
    expect(ids(await diagnose(ENV, { fetchImpl: gateway('cors') }), 'FAIL')).toContain('INT-URL');
  });
  it('configuration absente ou clé trop courte → FAIL INT-CONFIG', async () => {
    expect(ids(await diagnose({}, {}), 'FAIL')).toEqual(['INT-CONFIG']);
    expect(ids(await diagnose({ ...ENV, INTEGRATION_KEY: 'court' }, { fetchImpl: gateway('ok') }), 'FAIL')).toContain('INT-CONFIG');
  });
});
