// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
// @ts-expect-error module .mjs sans types
import { buildProbeSql, checkChain, classify, listMigrations, PROBES, STATUS, FIRST, LAST } from '../../scripts/prod/lib/migrations.mjs';
// @ts-expect-error module .mjs sans types
import { run } from '../../scripts/prod/migration-status.mjs';
import { MIGRATIONS_DIR, OFFICIAL_MIGRATIONS, supabaseShim } from '../db/schemaKit';

/** Les sondes de lecture seule sont VALIDÉES contre une vraie base : appliquées une à une, chaque migration doit passer ABSENTE → DÉJÀ APPLIQUÉE. */
async function probes(db: PGlite) { return ((await db.query<{ probes: unknown }>(buildProbeSql())).rows[0]!.probes); }
const stripExt = (f: string) => readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8').replace(/create extension[^;]*;/gi, '');

describe('chaîne de migrations locale', () => {
  it('complète, ordonnée, sans doublon, couverte par des sondes', () => {
    const files = listMigrations();
    expect(checkChain(files)).toEqual([]);
    expect(files[0]).toContain(FIRST); expect(files.at(-1)).toContain(LAST);
    expect([...OFFICIAL_MIGRATIONS]).toEqual(files);
    expect(Object.keys(PROBES)).toEqual(files);
  });
  it('détecte doublon, désordre, nom invalide, migration inconnue ou manquante', () => {
    const files = listMigrations();
    expect(checkChain([...files, '20261018000000_autre.sql']).join()).toContain('en double');
    expect(checkChain([...files].reverse()).join()).toContain('non triées');
    expect(checkChain([...files, 'mauvais.sql']).join()).toContain('nom de migration invalide');
    expect(checkChain([...files, '20261019000000_nouvelle.sql']).join()).toContain('sans sonde');
    expect(checkChain(files.slice(1)).join()).toContain('absente du dépôt');
  });
});

describe('sondes de lecture seule (PGlite)', () => {
  it('la requête est un SELECT unique, sans écriture', () => {
    const sql = buildProbeSql();
    expect(sql.trim().toLowerCase().startsWith('select')).toBe(true);
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant)\b/i);
  });
  it('base vide → tout ABSENTE ; après chaque migration → exactement celle-ci passe à DÉJÀ APPLIQUÉE', async () => {
    const db = await supabaseShim();
    expect(classify(await probes(db)).rows.every((r: { status: string }) => r.status === STATUS.absent)).toBe(true);
    const files = [...OFFICIAL_MIGRATIONS];
    for (let i = 0; i < files.length; i++) {
      await db.exec(stripExt(files[i]!));
      const r = classify(await probes(db));
      expect(r.rows.map((x: { status: string }) => x.status), `après ${files[i]}`).toEqual(files.map((_, j) => (j <= i ? STATUS.applied : STATUS.absent)));
      expect(r.stop).toBe(false);
    }
  }, 120_000);
  it('base à moitié migrée / modifiée → DIFFÉRENTE + STOP ; ordre rompu → STOP', async () => {
    const db = await supabaseShim();
    for (const f of OFFICIAL_MIGRATIONS) await db.exec(stripExt(f));
    await db.exec('alter table public.integration_links drop column auto_login');
    const r = classify(await probes(db));
    expect(r.rows.find((x: { file: string }) => x.file.startsWith('20261017'))!.status).toBe(STATUS.different);
    expect(r.stop).toBe(true);
    await db.exec('drop table public.user_devices cascade');
    const r2 = classify(await probes(db));
    expect(r2.rows.find((x: { file: string }) => x.file.startsWith('20261017'))!.status).toBe(STATUS.different);
    const gap = classify({ ...(await probes(db)) as object, [OFFICIAL_MIGRATIONS[1]]: Object.fromEntries(Object.keys(PROBES[OFFICIAL_MIGRATIONS[1]]).map((k) => [k, false])) });
    expect(gap.problems.join()).toContain('ordre rompu');
  }, 120_000);
});

describe('CLI migration-status', () => {
  it('appelle une seule fois l’API avec un SELECT, ne fuit pas le jeton, renvoie 1 sur STOP', async () => {
    const calls: { url: string; body: string; auth: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body), auth: String((init.headers as Record<string, string>).authorization) });
      return new Response(JSON.stringify([{ probes: {} }]), { status: 200 });
    }) as unknown as typeof fetch;
    const lines: string[] = [];
    const code = await run(['--project', 'abcdefghijklmnopqrst'], { SUPABASE_ACCESS_TOKEN: 'sbp_SECRET' }, fake, (l: string) => lines.push(l));
    expect(code).toBe(0);                           // tout ABSENTE : rien d'anormal, tout est à appliquer
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.body).query.trim().toLowerCase().startsWith('select')).toBe(true);
    expect(lines.join('\n')).not.toContain('sbp_SECRET');
    expect(lines.join('\n')).toContain('À APPLIQUER');
  });
  it('erreurs d’usage : référence invalide, jeton absent', async () => {
    expect(await run(['--project', 'x'], {}, fetch, () => {})).toBe(2);
    expect(await run(['--project', 'abcdefghijklmnopqrst'], {}, fetch, () => {})).toBe(2);
  });
});
