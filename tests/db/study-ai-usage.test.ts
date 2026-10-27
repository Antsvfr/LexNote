// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { A, B, C, applyOfficial, as, supabaseShim } from './schemaKit';

/** Limitation de débit de `study-ai` (migration 20261016) sur un vrai Postgres : atomique, par utilisateur, inaccessible aux navigateurs. */
let db: PGlite;
const L = { c: 2, m: 3, d: 5, chars: 10_000 };
const acquire = async (user: string, chars = 100) => (await db.query<{ r: Record<string, unknown> }>(
  'select public.study_ai_acquire($1, $2, $3, $4, $5, $6, $7) as r', [user, 'summarize', chars, L.c, L.m, L.d, L.chars])).rows[0]!.r;
const release = (id: unknown, status = 'ok') => db.query('select public.study_ai_release($1, $2, $3)', [id, status, 120]);

beforeAll(async () => {
  db = await supabaseShim(); await applyOfficial(db);
  for (const [u, e] of [[A, 'a@test.fr'], [B, 'b@test.fr'], [C, 'c@test.fr']]) await db.query('insert into auth.users (id, email) values ($1, $2)', [u, e]);
});

describe('study_ai_acquire / study_ai_release', () => {
  it('appels simultanés limités, libérés par release', async () => {
    const a1 = await acquire(A); const a2 = await acquire(A);
    expect(a1).toMatchObject({ ok: true }); expect(a2).toMatchObject({ ok: true });
    expect(await acquire(A)).toMatchObject({ ok: false, reason: 'concurrent', limit: 2 });
    await release(a1.id); await release(a2.id, 'refused');
    const st = (await db.query<{ status: string }>('select status from study_ai_requests where user_id = $1 order by id', [A])).rows;
    expect(st.map((x) => x.status)).toEqual(['ok', 'refused']);
  });
  it('par minute : refus avec délai ; un autre utilisateur n’est pas affecté', async () => {
    const a3 = await acquire(A); await release(a3.id);
    const r = await acquire(A);
    expect(r).toMatchObject({ ok: false, reason: 'per_minute', limit: 3 });
    expect(Number(r.retry_after)).toBeGreaterThan(0);
    expect(await acquire(B)).toMatchObject({ ok: true });
  });
  it('par jour et volume de texte par jour', async () => {
    await db.query(`update study_ai_requests set started_at = now() - interval '2 hours' where user_id = $1`, [A]);
    const a = await acquire(A); await release(a.id);
    const b = await acquire(A); await release(b.id);
    expect(await acquire(A)).toMatchObject({ ok: false, reason: 'per_day', limit: 5 });
    await db.query(`update study_ai_requests set started_at = now() - interval '2 hours' where user_id = $1`, [B]);
    await db.query(`update study_ai_requests set status = 'ok' where user_id = $1`, [B]);
    expect(await acquire(B, 20_000)).toMatchObject({ ok: false, reason: 'chars_per_day' });
  });
  it('un appel « en cours » abandonné (plantage) expire et ne bloque pas', async () => {
    await acquire(C); await acquire(C);
    expect(await acquire(C)).toMatchObject({ reason: 'concurrent' });
    await db.query(`update study_ai_requests set started_at = now() - interval '6 minutes' where user_id = $1`, [C]);
    expect(await acquire(C)).toMatchObject({ ok: true });
  });
  it('inaccessible aux navigateurs : ni lecture du journal, ni appel des fonctions', async () => {
    await expect(as(db, A, () => db.query('select * from study_ai_requests'))).rejects.toThrow();
    await expect(as(db, A, () => db.query(`select public.study_ai_acquire($1, 'x', 1, 99, 99, 99, 99)`, [A]))).rejects.toThrow();
    await expect(as(db, A, () => db.query(`select public.study_ai_release(1, 'ok', 1)`))).rejects.toThrow();
    await expect(as(db, null, () => db.query('select * from study_ai_requests'))).rejects.toThrow();
  });
});
