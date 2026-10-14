// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createSessionMinter, type AdminAuth, type PublicAuth } from './sessions';
import { IntegrationFailure } from './errors';

const UID = '11111111-1111-4111-8111-111111111111';
function fakes(over: { user?: unknown; link?: unknown; verify?: unknown[] } = {}) {
  const admin: AdminAuth = {
    getUserById: vi.fn(async () => (over.user ?? { data: { user: { id: UID, email: 'a@test.fr' } }, error: null }) as never),
    generateLink: vi.fn(async () => (over.link ?? { data: { properties: { hashed_token: 'h4sh' }, user: { id: UID } }, error: null }) as never),
  };
  const queue = [...(over.verify ?? [{ data: { session: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, expires_at: 2_000_000_000, user: { id: UID } } }, error: null }])];
  const pub: PublicAuth = { verifyOtp: vi.fn(async () => queue.shift() as never) };
  return { admin, pub, minter: createSessionMinter(admin, () => pub, () => 1_900_000_000_000) };
}
const code = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e) { return e instanceof IntegrationFailure ? e.error.code : String(e); } };

describe('SessionMinter — session Supabase ordinaire, sans mot de passe, jeton à usage unique consommé côté serveur', () => {
  it('renvoie uniquement access / refresh / expiration ; le lien n’est jamais envoyé par e-mail ni renvoyé', async () => {
    const f = fakes();
    const s = await f.minter.mint(UID);
    expect(s).toEqual({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, expires_at: 2_000_000_000, token_type: 'bearer' });
    expect(f.admin.generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: 'a@test.fr' });
    expect(f.pub.verifyOtp).toHaveBeenCalledWith({ token_hash: 'h4sh', type: 'magiclink' });
    expect(JSON.stringify(s)).not.toContain('h4sh');
  });
  it('repli sur le type « email » si le serveur Auth n’accepte plus « magiclink »', async () => {
    const f = fakes({ verify: [{ data: { session: null }, error: { message: 'invalid type' } }, { data: { session: { access_token: 'AT', refresh_token: 'RT', user: { id: UID } } }, error: null }] });
    expect((await f.minter.mint(UID)).access_token).toBe('AT');
    expect(f.pub.verifyOtp).toHaveBeenLastCalledWith({ token_hash: 'h4sh', type: 'email' });
  });
  it('défense en profondeur : lien ou session d’un AUTRE utilisateur → refus', async () => {
    expect(await code(fakes({ link: { data: { properties: { hashed_token: 'h' }, user: { id: 'autre' } }, error: null } }).minter.mint(UID))).toBe('UNAVAILABLE');
    expect(await code(fakes({ verify: [{ data: { session: { access_token: 'AT', refresh_token: 'RT', user: { id: 'autre' } } }, error: null }] }).minter.mint(UID))).toBe('FORBIDDEN');
  });
  it('compte introuvable, suspendu, ou Auth en erreur → refus propre (aucune session)', async () => {
    expect(await code(fakes({ user: { data: { user: null }, error: { message: 'nope' } } }).minter.mint(UID))).toBe('UNAVAILABLE');
    expect(await code(fakes({ user: { data: { user: { id: UID, email: 'a@test.fr', banned_until: '2999-01-01T00:00:00Z' } }, error: null } }).minter.mint(UID))).toBe('FORBIDDEN');
    expect(await code(fakes({ link: { data: {}, error: { message: 'boom' } } }).minter.mint(UID))).toBe('UNAVAILABLE');
    expect(await code(fakes({ verify: [{ data: { session: null }, error: { message: 'Token has expired or is invalid' } }] }).minter.mint(UID))).toBe('UNAVAILABLE');
  });
});
