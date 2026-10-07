// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { U, makeDb, rpcOf } from '../../src/integration/testkit';

/**
 * RLS des tables d'intégration, sur un Postgres réel, pour LES DEUX schémas (migration LexNote et migration REV-EM) :
 * un utilisateur A ne lit, ne modifie, ne supprime ni ne crée jamais la liaison de B ; un navigateur ne peut rien écrire ni appeler.
 */
const hex = (c: string) => c.repeat(64);
const ref = (c: string) => `ref_${c.repeat(20)}`;

describe.each([['lexnote', U.lexA, U.lexB], ['revem', U.revemA, U.revemB]] as const)('RLS intégration — projet %s', (kind, A, B) => {
  let db: PGlite; let linkA = ''; let linkB = '';
  const as = async <T>(user: string | null, fn: () => Promise<T>) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${user ? 'authenticated' : 'anon'};`);
    try { return await fn(); } finally { await db.exec('reset role;'); }
  };

  beforeAll(async () => {
    db = await makeDb(kind, [[A, `a@${kind}.t`, 'A'], [B, `b@${kind}.t`, 'B']]);
    const rpc = rpcOf(db);
    for (const [u, c] of [[A, 'a'], [B, 'b']] as const) {
      const id = `lnk_${c.repeat(24)}`;
      expect((await rpc.rpc('integration_create_pending_link', { p_user: u, p_provider: kind === 'revem' ? 'lexnote' : 'revem', p_link_id: id, p_local_ref: ref(c), p_partner_ref: ref(c.toUpperCase()) })).data).toMatchObject({ reason: 'OK' });
      await rpc.rpc('integration_activate_link', { p_link_id: id, p_partner_ref: ref(c.toUpperCase()) });
      if (c === 'a') linkA = id; else linkB = id;
    }
    await db.query(`insert into integration_link_intents (user_id, nonce_hash, expires_at) values ($1, $2, now() + interval '5 minutes')`, [A, hex('a')]);
    await db.query(`insert into integration_nonces values ('${kind === 'revem' ? 'lexnote' : 'revem'}', 'n-1', now() + interval '5 minutes')`);
  });

  it('chacun ne lit que SA liaison', async () => {
    const a = await as(A, () => db.query<{ link_id: string }>('select link_id from integration_links'));
    const b = await as(B, () => db.query<{ link_id: string }>('select link_id from integration_links'));
    expect(a.rows.map((r) => r.link_id)).toEqual([linkA]); expect(b.rows.map((r) => r.link_id)).toEqual([linkB]);
    expect((await as(A, () => db.query('select link_id from integration_links where link_id = $1', [linkB]))).rows).toHaveLength(0);
  });
  it('les pseudonymes (references) ne sont pas lisibles depuis un navigateur, même pour SA ligne', async () => {
    await expect(as(A, () => db.query('select local_reference from integration_links'))).rejects.toThrow(/permission denied/);
    await expect(as(A, () => db.query('select external_reference from integration_links'))).rejects.toThrow(/permission denied/);
    await expect(as(A, () => db.query('select * from integration_links'))).rejects.toThrow(/permission denied/);
    const ok = await as(A, () => db.query('select id, provider, link_id, status, linked_at, revoked_at from integration_links'));
    expect(ok.rows).toHaveLength(1);
  });
  it('A ne peut ni créer, ni modifier, ni supprimer, ni révoquer une liaison (la sienne comme celle de B)', async () => {
    await expect(as(A, () => db.query(`insert into integration_links (user_id, provider, link_id, local_reference, external_reference, status) values ($1,'revem','lnk_${'z'.repeat(24)}','${ref('z')}','${ref('y')}','PENDING')`, [A]))).rejects.toThrow(/permission denied/);
    await expect(as(A, () => db.query(`update integration_links set status = 'REVOKED', revoked_at = now() where link_id = $1`, [linkB]))).rejects.toThrow(/permission denied/);
    await expect(as(A, () => db.query(`update integration_links set status = 'CONNECTED'`))).rejects.toThrow(/permission denied/);
    await expect(as(A, () => db.query('delete from integration_links'))).rejects.toThrow(/permission denied/);
    const status = await db.query<{ link_id: string; status: string }>('select link_id, status from integration_links order by link_id');
    expect(status.rows.every((r) => r.status === 'CONNECTED')).toBe(true);
  });
  it('intentions et nonces : inaccessibles aux navigateurs (lecture comme écriture)', async () => {
    for (const t of ['integration_link_intents', 'integration_nonces']) {
      await expect(as(A, () => db.query(`select * from ${t}`))).rejects.toThrow(/permission denied/);
      await expect(as(null, () => db.query(`select * from ${t}`))).rejects.toThrow(/permission denied/);
      await expect(as(A, () => db.query(`delete from ${t}`))).rejects.toThrow(/permission denied/);
    }
    await expect(as(A, () => db.query(`insert into integration_link_intents (user_id, nonce_hash, expires_at) values ($1, '${hex('c')}', now() + interval '1 minute')`, [A]))).rejects.toThrow(/permission denied/);
  });
  it('anonyme : rien', async () => {
    await expect(as(null, () => db.query('select * from integration_links'))).rejects.toThrow(/permission denied/);
    await expect(as(null, () => db.query('select link_id from integration_links'))).rejects.toThrow(/permission denied/);
  });
  it('les fonctions integration_* ne sont appelables ni par un utilisateur connecté ni par un anonyme', async () => {
    for (const who of [A, null]) {
      await expect(as(who, () => db.query(`select public.integration_revoke_link($1, null, 'self')`, [linkB]))).rejects.toThrow(/permission denied/);
      await expect(as(who, () => db.query(`select public.integration_start_intent($1, '${hex('d')}', 300)`, [B]))).rejects.toThrow(/permission denied/);
      await expect(as(who, () => db.query(`select public.integration_get_user_link($1)`, [B]))).rejects.toThrow(/permission denied/);
      await expect(as(who, () => db.query(`select public.integration_register_nonce('lexnote','x', now())`))).rejects.toThrow(/permission denied/);
    }
  });
  it('le rôle serveur (service_role) peut les appeler', async () => {
    await db.exec(`reset role; set role service_role;`);
    try { const r = await db.query(`select public.integration_get_user_link($1) as r`, [A]); expect((r.rows[0] as { r: { reason: string } }).r.reason).toBe('OK'); } finally { await db.exec('reset role;'); }
  });
  it('contraintes : 1 liaison vivante par utilisateur, 1-1 avec le partenaire, formats stricts, durée d’intention bornée', async () => {
    const rpc = rpcOf(db);
    expect((await rpc.rpc('integration_create_pending_link', { p_user: A, p_provider: 'x', p_link_id: 'lnk_' + 'q'.repeat(24), p_local_ref: ref('q'), p_partner_ref: ref('Q') })).data).toMatchObject({ reason: 'ALREADY_LINKED' });
    await expect(db.query(`insert into integration_links (user_id, provider, link_id, local_reference, external_reference, status) values ($1,'nope','lnk_${'k'.repeat(24)}','${ref('k')}','${ref('j')}','PENDING')`, [A])).rejects.toThrow();
    await expect(db.query(`insert into integration_links (user_id, provider, link_id, local_reference, external_reference, status) values ($1,'revem','court','${ref('k')}','${ref('j')}','PENDING')`, [A])).rejects.toThrow();
    await expect(db.query(`insert into integration_link_intents (user_id, nonce_hash, expires_at) values ($1, 'pas-un-hash', now() + interval '1 minute')`, [A])).rejects.toThrow();
  });
  it('contrôles type « Security Advisor » : RLS forcée partout, fonctions durcies, aucun droit anon/PUBLIC', async () => {
    const t = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'integration\_%'`);
    expect(t.rows.map((r) => r.relname).sort()).toEqual(['integration_link_intents', 'integration_links', 'integration_nonces']);
    expect(t.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
    const f = await db.query<{ proname: string; prosecdef: boolean; proconfig: string[] | null; anon: boolean; authed: boolean; pub: boolean }>(`select proname, prosecdef, proconfig, has_function_privilege('anon', oid, 'execute') as anon, has_function_privilege('authenticated', oid, 'execute') as authed, has_function_privilege('public', oid, 'execute') as pub from pg_proc where pronamespace = 'public'::regnamespace and proname like 'integration\_%'`);
    expect(f.rows.length).toBeGreaterThanOrEqual(12);
    for (const r of f.rows) {
      expect(r.prosecdef, r.proname).toBe(true);                                              // SECURITY DEFINER …
      expect((r.proconfig ?? []).join(' '), r.proname).toMatch(/search_path=public, pg_temp/);    // … avec search_path figé (pas de détournement)
      expect([r.anon, r.authed, r.pub], r.proname).toEqual([false, false, false]);
    }
    const g = await db.query<{ grantee: string; privilege_type: string }>(`select grantee, privilege_type from information_schema.role_table_grants where table_name like 'integration\_%' and grantee in ('anon', 'PUBLIC')`);
    expect(g.rows).toEqual([]);
    const policies = await db.query<{ cmd: string; tablename: string }>(`select tablename, cmd from pg_policies where tablename like 'integration\_%'`);
    expect(policies.rows).toEqual([{ tablename: 'integration_links', cmd: 'SELECT' }]);       // une seule policy, en lecture, sur la ligne de l'utilisateur
  });
  it('suppression du compte → liaisons, intentions supprimées en cascade (aucune donnée orpheline)', async () => {
    await db.query('delete from auth.users where id = $1', [B]);
    expect((await db.query('select * from integration_links where user_id = $1', [B])).rows).toHaveLength(0);
  });
});
