// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { A, B, applyOfficial, supabaseShim } from './schemaKit';

/** Migration 20261017 — appareils (« Rester connecté ») et consentement « connexion automatique », sur un vrai Postgres. */
let db: PGlite;
const SA = '5a5a5a5a-0000-4000-8000-00000000000a';
const SB = '5b5b5b5b-0000-4000-8000-00000000000b';
const DEV1 = 'd1d1d1d1-0000-4000-8000-000000000001';
const DEV2 = 'd2d2d2d2-0000-4000-8000-000000000002';
/** Appel « navigateur » : rôle authenticated + claims du JWT (sub ET session_id, comme Supabase). */
async function asUser<T>(user: string, session: string | null, fn: () => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: user, role: 'authenticated', ...(session ? { session_id: session } : {}) });
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user}', false); select set_config('request.jwt.claims', '${claims}', false); set role authenticated;`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
}
const q = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => db.query<T>(sql, p).then((r) => r.rows);

beforeAll(async () => {
  db = await supabaseShim(); await applyOfficial(db);
  for (const [u, e] of [[A, 'a@t.fr'], [B, 'b@t.fr']]) await db.query('insert into auth.users (id, email) values ($1, $2)', [u, e]);
  await db.query('insert into auth.sessions (id, user_id) values ($1, $2), ($3, $4)', [SA, A, SB, B]);
});

describe('registre des appareils', () => {
  it('touch : la session est lue dans le JWT (jamais un paramètre) ; chacun ne voit que SES appareils', async () => {
    await asUser(A, SA, () => q("select public.user_device_touch($1, 'Chrome — macOS', false, true)", [DEV1]));
    await asUser(B, SB, () => q("select public.user_device_touch($1, 'Safari — iOS · application', true, false)", [DEV2]));
    const mine = await asUser(A, SA, () => q<{ device_id: string; session_id: string; remember: boolean }>('select device_id, session_id, remember from user_devices'));
    expect(mine).toEqual([{ device_id: DEV1, session_id: SA, remember: true }]);
    expect(await asUser(B, SB, () => q('select device_id from user_devices'))).toEqual([{ device_id: DEV2 }]);
  });
  it('aucune écriture directe depuis le navigateur (seulement via les fonctions)', async () => {
    await expect(asUser(A, SA, () => q("insert into user_devices (user_id, device_id, label) values ($1, $2, 'x')", [A, DEV2]))).rejects.toThrow();
    await expect(asUser(A, SA, () => q("update user_devices set label = 'pirate'"))).rejects.toThrow();
    await expect(asUser(A, SA, () => q('delete from user_devices'))).rejects.toThrow();
  });
  it('déconnecter un appareil supprime SA session Supabase (refresh token inutilisable) — jamais celle d’un autre compte', async () => {
    expect(await asUser(A, SA, () => q<{ r: { reason: string } }>('select public.user_device_revoke($1) as r', [DEV2]))).toEqual([{ r: { reason: 'NOT_FOUND' } }]);   // appareil de B
    expect((await q('select id from auth.sessions where id = $1', [SB]))).toHaveLength(1);
    expect(await asUser(A, SA, () => q<{ r: { reason: string } }>('select public.user_device_revoke($1) as r', [DEV1]))).toEqual([{ r: { reason: 'OK' } }]);
    expect(await q('select id from auth.sessions where id = $1', [SA])).toHaveLength(0);
    expect(await q('select id from auth.sessions where id = $1', [SB])).toHaveLength(1);
    expect(await q('select device_id from user_devices where user_id = $1', [A])).toHaveLength(0);
  });
  it('« déconnecter tous les appareils » : toutes les sessions de l’utilisateur, et seulement les siennes', async () => {
    await db.query('insert into auth.sessions (id, user_id) values ($1, $2)', [SA, A]);
    await asUser(A, SA, () => q("select public.user_device_touch($1, 'Chrome — macOS', false, true)", [DEV1]));
    await asUser(A, SA, () => q('select public.user_device_forget_all()'));
    expect(await q('select id from auth.sessions where user_id = $1', [A])).toHaveLength(0);
    expect(await q('select id from auth.sessions where user_id = $1', [B])).toHaveLength(1);
  });
  it('anonyme : rien (ni lecture, ni appel)', async () => {
    await db.exec("reset role; set role anon;");
    try {
      await expect(db.query('select * from user_devices')).rejects.toThrow();
      await expect(db.query('select public.user_device_touch($1, $2, false, false)', [DEV1, 'x'])).rejects.toThrow();
      await expect(db.query('select public.user_device_revoke($1)', [DEV1])).rejects.toThrow();
    } finally { await db.exec('reset role;'); }
  });
});

describe('consentement « connexion automatique » sur integration_links', () => {
  it('réservé au serveur (service_role) ; jamais modifiable par le navigateur', async () => {
    await expect(asUser(A, SA, () => q('select public.integration_set_auto_login($1, true)', [A]))).rejects.toThrow();
    await expect(asUser(A, SA, () => q('update integration_links set auto_login = true'))).rejects.toThrow();
  });
  it('une liaison non CONNECTED ne peut jamais porter le consentement (déclencheur)', async () => {
    await db.query(`insert into integration_links (user_id, provider, link_id, local_reference, external_reference, status, linked_at, auto_login)
      values ($1, 'revem', 'lnk_aaaaaaaaaaaaaaaaaaaaaaaa', 'ref_local_aaaaaaaaaaaaaaaa', 'ref_partner_aaaaaaaaaaaaaa', 'CONNECTED', now(), true)`, [A]);
    expect((await q<{ auto_login: boolean }>('select auto_login from integration_links where user_id = $1', [A]))[0]!.auto_login).toBe(true);
    await db.query("update integration_links set status = 'REVOKED', revoked_at = now(), revoked_by = 'partner' where user_id = $1", [A]);
    expect((await q<{ auto_login: boolean }>('select auto_login from integration_links where user_id = $1', [A]))[0]!.auto_login).toBe(false);
    expect(await q<{ r: { reason: string } }>('select public.integration_set_auto_login($1, true) as r', [A])).toEqual([{ r: { reason: 'NOT_FOUND' } }]);
  });
});
