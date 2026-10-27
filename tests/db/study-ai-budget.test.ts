// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { A, B, C, applyOfficial, as, supabaseShim } from './schemaKit';

/** Migration 20261018 — budget GLOBAL, métadonnées d'usage (sans contenu), rétention, sonde de santé — sur un vrai Postgres. */
let db: PGlite;
const L = { c: 5, m: 50, d: 50, chars: 10_000_000 };
type R = Record<string, unknown>;
const acquire = async (user: string, chars = 100, g: { req?: number; chars?: number } = {}) => (await db.query<{ r: R }>(
  'select public.study_ai_acquire($1, $2, $3, $4, $5, $6, $7, $8, $9) as r', [user, 'summarize', chars, L.c, L.m, L.d, L.chars, g.req ?? 0, g.chars ?? 0])).rows[0]!.r;
const q = <T = R>(sql: string, p: unknown[] = []) => db.query<T>(sql, p).then((r) => r.rows);

beforeAll(async () => {
  db = await supabaseShim(); await applyOfficial(db);
  for (const [u, e] of [[A, 'a@t.fr'], [B, 'b@t.fr'], [C, 'c@t.fr']]) await db.query('insert into auth.users (id, email) values ($1, $2)', [u, e]);
});

describe('budget GLOBAL (tous utilisateurs, 24 h)', () => {
  it('requêtes/jour : l’utilisateur B est refusé quand A et C ont consommé le budget, avec une raison globale', async () => {
    expect(await acquire(A, 100, { req: 2 })).toMatchObject({ ok: true });
    expect(await acquire(C, 100, { req: 2 })).toMatchObject({ ok: true });
    const r = await acquire(B, 100, { req: 2 });
    expect(r).toMatchObject({ ok: false, reason: 'global_per_day', limit: 2 });
    expect(Number(r.retry_after)).toBeGreaterThanOrEqual(60);
    expect(await q('select id from study_ai_requests where user_id = $1', [B])).toHaveLength(0);         // refusé = rien de réservé
  });
  it('volume de texte/jour : refus quand le total dépasserait le budget', async () => {
    await db.exec('truncate study_ai_requests');
    expect(await acquire(A, 6_000, { chars: 10_000 })).toMatchObject({ ok: true });
    expect(await acquire(B, 5_000, { chars: 10_000 })).toMatchObject({ ok: false, reason: 'global_chars_per_day' });
    expect(await acquire(B, 4_000, { chars: 10_000 })).toMatchObject({ ok: true });
  });
  it('0 = pas de limite globale (explicite) ; l’ancien appel à 7 arguments fonctionne encore (déploiement dans n’importe quel ordre)', async () => {
    await db.exec('truncate study_ai_requests');
    for (let i = 0; i < 5; i++) expect(await acquire(i % 2 ? A : B, 10)).toMatchObject({ ok: true });
    await db.exec('truncate study_ai_requests');
    const old = await q<{ r: R }>('select public.study_ai_acquire($1, $2, $3, $4, $5, $6, $7) as r', [A, 'summarize', 10, 5, 50, 50, 1_000_000]);
    expect(old[0]!.r).toMatchObject({ ok: true });
  });
  it('les fenêtres sont glissantes : des requêtes de plus de 24 h ne comptent plus', async () => {
    await db.exec('truncate study_ai_requests');
    await acquire(A, 100, { req: 1 });
    expect(await acquire(B, 100, { req: 1 })).toMatchObject({ ok: false });
    await db.exec("update study_ai_requests set started_at = now() - interval '25 hours'");
    expect(await acquire(B, 100, { req: 1 })).toMatchObject({ ok: true });
  });
  it('concurrence : 3 utilisateurs en parallèle sur un budget de 2 → exactement 2 acceptés', async () => {
    await db.exec('truncate study_ai_requests');
    const rs = await Promise.all([A, B, C].map((u) => acquire(u, 100, { req: 2 })));
    expect(rs.filter((r) => r.ok)).toHaveLength(2);
    expect(await q('select id from study_ai_requests')).toHaveLength(2);
  });
});

describe('métadonnées d’usage : jamais de contenu', () => {
  it('release enregistre modèle, jetons, durée et code ; assainit le code ; ne dépasse pas les bornes', async () => {
    await db.exec('truncate study_ai_requests');
    const a = (await acquire(A, 1234)).id;
    await q('select public.study_ai_release($1, $2, $3, $4, $5, $6, $7)', [a, 'ok', 321, 987, 'claude-opus-5-5', 4567, null]);
    expect((await q('select status, input_chars, input_tokens, output_tokens, model, duration_ms, error_code from study_ai_requests where id = $1', [a]))[0]).toEqual(
      { status: 'ok', input_chars: 1234, input_tokens: 987, output_tokens: 321, model: 'claude-opus-5-5', duration_ms: 4567, error_code: null });
    const b = (await acquire(A, 10)).id;
    await q('select public.study_ai_release($1, $2, $3, $4, $5, $6, $7)', [b, 'refused', null, null, 'm', -5, "refused'; drop table x; --"]);
    expect((await q('select status, output_tokens, duration_ms, error_code from study_ai_requests where id = $1', [b]))[0]).toEqual({ status: 'refused', output_tokens: null, duration_ms: 0, error_code: 'refuseddroptablex--' });
  });
  it('la table n’a AUCUNE colonne susceptible de contenir du texte utilisateur', async () => {
    const cols = (await q<{ column_name: string; data_type: string }>("select column_name, data_type from information_schema.columns where table_name = 'study_ai_requests' order by 1")).map((c) => c.column_name);
    expect(cols).toEqual(['duration_ms', 'error_code', 'finished_at', 'id', 'input_chars', 'input_tokens', 'model', 'output_tokens', 'started_at', 'status', 'task', 'user_id']);
    // les seules colonnes texte sont bornées par contrainte (tâche ≤ 40, modèle ≤ 80, code ≤ 40, statut énuméré)
    await expect(db.query("insert into study_ai_requests (user_id, task, input_chars, model) values ($1, 'x', 1, $2)", [A, 'm'.repeat(81)])).rejects.toThrow();
    await expect(db.query("insert into study_ai_requests (user_id, task, input_chars, error_code) values ($1, 'x', 1, $2)", [A, 'e'.repeat(41)])).rejects.toThrow();
  });
  it('résumé d’usage : totaux par jour / tâche / état, sans utilisateur ni contenu', async () => {
    const s = (await q<{ r: R[] }>('select public.study_ai_usage_summary(7) as r'))[0]!.r;
    expect(s.length).toBeGreaterThan(0);
    expect(Object.keys(s[0]!).sort()).toEqual(['avg_ms', 'day', 'input_chars', 'input_tokens', 'output_tokens', 'requests', 'status', 'task']);
  });
});

describe('rétention (30 jours)', () => {
  it('les lignes de plus de 30 jours de l’utilisateur disparaissent à son prochain appel ; plus récentes conservées', async () => {
    await db.exec('truncate study_ai_requests');
    await db.query("insert into study_ai_requests (user_id, task, input_chars, status, started_at) values ($1, 'x', 1, 'ok', now() - interval '31 days'), ($1, 'x', 1, 'ok', now() - interval '10 days')", [A]);
    await acquire(A, 10);
    expect(await q("select 1 from study_ai_requests where user_id = $1 and started_at < now() - interval '30 days'", [A])).toHaveLength(0);
    expect((await q('select count(*)::int n from study_ai_requests where user_id = $1', [A]))[0]!.n).toBe(2);
  });
});

describe('droits et sonde de santé', () => {
  it('toutes les fonctions sont réservées au serveur (service_role) ; invisibles pour un navigateur', async () => {
    for (const sql of ['select public.app_health()', 'select public.study_ai_usage_summary(7)', "select public.study_ai_acquire(gen_random_uuid(), 'x', 1, 9, 9, 9, 9)", 'select public.study_ai_release(1, $$ok$$, 1)']) {
      await expect(as(db, A, () => db.query(sql)), sql).rejects.toThrow();
      await expect(as(db, null, () => db.query(sql)), sql).rejects.toThrow();
    }
  });
  it('app_health ne renvoie que des booléens, tous vrais sur le schéma complet', async () => {
    const h = (await q<{ h: Record<string, unknown> }>('select public.app_health() as h'))[0]!.h;
    expect(Object.values(h).every((v) => v === true)).toBe(true);
    expect(Object.keys(h).sort()).toEqual(['ai_usage', 'core', 'course_refs', 'devices', 'integration', 'study', 'transcript_artifacts']);
  });
  it('app_health détecte un schéma incomplet (colonne manquante)', async () => {
    await db.exec('alter table study_ai_requests rename column model to model_x');
    expect((await q<{ h: Record<string, unknown> }>('select public.app_health() as h'))[0]!.h.ai_usage).toBe(false);
    await db.exec('alter table study_ai_requests rename column model_x to model');
  });
});
