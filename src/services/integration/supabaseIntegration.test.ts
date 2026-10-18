import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseIntegration } from './supabaseIntegration';

/**
 * Cause racine du « Votre session a expiré » côté navigateur : supabase-js retombe SILENCIEUSEMENT sur la clé publique quand la session
 * n'est pas lisible / rafraîchissable. Ces tests vérifient que l'appel n'a plus jamais lieu dans ce cas, et que les causes sont distinguées.
 */
type Sess = { access_token: string; expires_at: number } | null;
function fakeClient(o: { session: Sess; refreshed?: Sess; replies: Array<{ data?: unknown; error?: { context: Response } }> }) {
  const calls: Array<{ body: unknown; headers?: Record<string, string> }> = [];
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: o.session } })),
      refreshSession: vi.fn(async () => ({ data: { session: o.refreshed ?? null } })),
    },
    functions: { invoke: vi.fn(async (_n: string, opts: { body: unknown; headers?: Record<string, string> }) => { calls.push(opts); const r = o.replies.shift() ?? { data: { ok: true } }; return { data: r.data ?? null, error: r.error ?? null }; }) },
  } as unknown as SupabaseClient;
  return { client, calls };
}
const soon = () => Math.floor(Date.now() / 1000) + 3600;
const errReply = (status: number, body: unknown) => ({ error: { context: new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }) } });
afterEach(() => { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); });

describe('integration-link côté navigateur', () => {
  it('session valide : le jeton est transmis EXPLICITEMENT (jamais de repli implicite sur la clé publique)', async () => {
    const { client, calls } = fakeClient({ session: { access_token: 'USER', expires_at: soon() }, replies: [{ data: { ok: true, state: { state: 'CONNECTED' } } }] });
    expect((await createSupabaseIntegration(client).call('status')).ok).toBe(true);
    expect(calls[0]!.headers).toEqual({ Authorization: 'Bearer USER' });
  });
  it('aucune session lisible / rafraîchissable → SESSION_REQUIRED SANS appeler la fonction (avant : appel anonyme → « session expirée »)', async () => {
    const { client, calls } = fakeClient({ session: null, replies: [] });
    expect(await createSupabaseIntegration(client).call('confirm', { linkIntentId: 'x' })).toMatchObject({ ok: false, error: { code: 'SESSION_REQUIRED' } });
    expect(calls).toHaveLength(0);
  });
  it('jeton sur le point d’expirer → rafraîchi AVANT l’appel', async () => {
    const { client, calls } = fakeClient({ session: { access_token: 'OLD', expires_at: Math.floor(Date.now() / 1000) + 20 }, refreshed: { access_token: 'NEW', expires_at: soon() }, replies: [{ data: { ok: true } }] });
    await createSupabaseIntegration(client).call('status');
    expect(calls[0]!.headers).toEqual({ Authorization: 'Bearer NEW' });
  });
  it('jeton refusé par la fonction → UN rafraîchissement puis UNE nouvelle tentative ; échec persistant → SESSION_REQUIRED', async () => {
    const unauth = { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Jeton invalide.', retryable: false } };
    const ok = fakeClient({ session: { access_token: 'A', expires_at: soon() }, refreshed: { access_token: 'B', expires_at: soon() }, replies: [errReply(401, unauth), { data: { ok: true } }] });
    expect((await createSupabaseIntegration(ok.client).call('status')).ok).toBe(true);
    expect(ok.calls.map((c) => c.headers?.Authorization)).toEqual(['Bearer A', 'Bearer B']);
    const ko = fakeClient({ session: { access_token: 'A', expires_at: soon() }, refreshed: null, replies: [errReply(401, unauth)] });
    expect(await createSupabaseIntegration(ko.client).call('status')).toMatchObject({ ok: false, error: { code: 'SESSION_REQUIRED' } });
  });
  it('refus du PARTENAIRE (serveur ↔ serveur) : jamais présenté comme une session expirée, aucune tentative de reconnexion', async () => {
    const peer = { ok: false, error: { code: 'PEER_AUTH_FAILED', message: 'x', retryable: false, details: { reason: 'gateway-verify-jwt' } } };
    const a = fakeClient({ session: { access_token: 'A', expires_at: soon() }, replies: [errReply(401, peer)] });
    expect(await createSupabaseIntegration(a.client).call('confirm')).toMatchObject({ ok: false, error: { code: 'PEER_AUTH_FAILED', details: { reason: 'gateway-verify-jwt' } } });
    expect(a.client.auth.refreshSession).not.toHaveBeenCalled();
    // serveur pas encore redéployé : ancien message « Réponse non authentifiée du partenaire »
    const legacy = { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Réponse non authentifiée du partenaire (HTTP 401).', retryable: false } };
    const b = fakeClient({ session: { access_token: 'A', expires_at: soon() }, replies: [errReply(401, legacy)] });
    expect(await createSupabaseIntegration(b.client).call('confirm')).toMatchObject({ ok: false, error: { code: 'PEER_AUTH_FAILED', details: { reason: 'legacy-peer-401' } } });
  });
  it('réponse de la PLATEFORME (401 / 404 sans corps métier) : cause explicite', async () => {
    const a = fakeClient({ session: { access_token: 'A', expires_at: soon() }, refreshed: null, replies: [errReply(401, 'Invalid JWT')] });
    expect(await createSupabaseIntegration(a.client).call('status')).toMatchObject({ ok: false, error: { code: 'SESSION_REQUIRED' } });
    const b = fakeClient({ session: { access_token: 'A', expires_at: soon() }, replies: [errReply(404, 'Function not found')] });
    expect(await createSupabaseIntegration(b.client).call('status')).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE', details: { reason: 'function-not-found' } } });
  });
  it('hors ligne → OFFLINE, sans appel ; la connexion automatique s’appelle SANS jeton', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const off = fakeClient({ session: { access_token: 'A', expires_at: soon() }, replies: [] });
    expect(await createSupabaseIntegration(off.client).call('status')).toMatchObject({ ok: false, error: { code: 'OFFLINE' } });
    expect(off.calls).toHaveLength(0);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    const pub = fakeClient({ session: null, replies: [{ data: { ok: true } }] });
    await createSupabaseIntegration(pub.client).call('launch-signin', { launchIntentId: 'i', nonce: 'n' });
    expect(pub.calls[0]!.headers).toBeUndefined();
    expect(pub.client.auth.getSession).not.toHaveBeenCalled();
  });
});
