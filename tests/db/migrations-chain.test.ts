// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { A, B, MIGRATIONS_DIR, OFFICIAL_MIGRATIONS, applyFile, applyOfficial, as, officialFiles, rowsOf, supabaseShim } from './schemaKit';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/**
 * UNE seule architecture : la chaîne #3 → #8 (+ index). Depuis une base VIDE, toutes les migrations s'appliquent dans l'ordre, sans erreur,
 * et produisent le schéma officiel attendu (vérifié par les deux scripts d'audit livrés pour la production).
 */
describe('chaîne de migrations officielle depuis une base vide', () => {
  let db: PGlite;
  beforeAll(async () => { db = await supabaseShim(); await applyOfficial(db); });

  it('le dossier supabase/migrations contient EXACTEMENT les migrations officielles, dans l’ordre (aucun vestige de la PR #5)', () => {
    expect(officialFiles()).toEqual([...OFFICIAL_MIGRATIONS]);
    expect(officialFiles().some((f) => /multiuser|^00\d_/.test(f))).toBe(false);
  });
  it('verify-official-schema.sql : 13 contrôles PASS', async () => {
    const rows = await rowsOf<{ controle: string; statut: string; detail: string | null }>(db, 'supabase/reconciliation/verify-official-schema.sql');
    expect(rows.filter((r) => r.statut === 'FAIL').map((r) => `${r.controle} ${r.detail ?? ''}`)).toEqual([]);
    expect(rows.at(-1)!.statut).toBe('13 PASS / 0 FAIL');
  });
  it('verify-db.sql (tables d’intégration) : 24 contrôles PASS', async () => {
    const rows = await rowsOf<{ controle: string; statut: string }>(db, 'scripts/prod/verify-db.sql');
    expect(rows.filter((r) => r.statut === 'FAIL').map((r) => r.controle)).toEqual([]);
    expect(rows.at(-1)!.statut).toBe('24 PASS / 0 FAIL');
  });
  it('index de clés étrangères idempotent (réexécutable sans erreur)', async () => {
    await applyFile(db, `${MIGRATIONS_DIR}/20261012000000_fk_indexes.sql`);
  });
  it('isolation A / B opérationnelle sur le schéma obtenu (création, lecture, clé composite)', async () => {
    await db.query(`insert into auth.users (id, email) values ($1, 'a@t'), ($2, 'b@t') on conflict do nothing`, [A, B]);
    const sA = '0000000a-0000-4000-8000-000000000001', sB = '0000000b-0000-4000-8000-000000000001';
    await as(db, A, () => db.query(`insert into subjects (id, name) values ($1, 'Droit')`, [sA]));
    await as(db, B, () => db.query(`insert into subjects (id, name) values ($1, 'Finance')`, [sB]));
    expect((await as(db, A, () => db.query('select name from subjects'))).rows).toEqual([{ name: 'Droit' }]);
    await expect(as(db, A, () => db.query(`insert into modules (id, subject_id, name) values (gen_random_uuid(), $1, 'M')`, [sB]))).rejects.toThrow();   // le parent de B est refusé à A
    expect((await db.query(`select id from profiles order by id`)).rows).toHaveLength(2);                                         // profils créés par le trigger d’inscription
  });
});

describe('mise à niveau d’un projet DÉJÀ migré en cours de route (données existantes)', () => {
  it('des lignes créées aux étapes intermédiaires survivent aux migrations suivantes', async () => {
    const db = await supabaseShim();
    await applyOfficial(db, 2);                                                                         // init + StudyArtifacts initial
    await db.query(`insert into auth.users (id, email) values ($1, 'a@t')`, [A]);
    const sub = '0000000a-0000-4000-8000-000000000001', ses = '0000000a-0000-4000-8000-000000000002';
    await as(db, A, async () => {
      await db.query(`insert into subjects (id, name) values ($1, 'Droit')`, [sub]);
      await db.query(`insert into course_sessions (id, subject_id, title, date, type) values ($1, $2, 'CM 1', '2026-10-01', 'CM')`, [ses, sub]);
      await db.query(`insert into study_artifacts (id, type, title, subject_id, content) values ('0000000a-0000-4000-8000-000000000003', 'COURSE_SHEET', 'Fiche v1', $1, '{"sections":[]}')`, [sub]);   // forme AVANT StudyArtifacts v2
    });
    for (const f of OFFICIAL_MIGRATIONS.slice(2)) await applyFile(db, `${MIGRATIONS_DIR}/${f}`);       // Course Engine → StudyArtifacts v2 → intégration → index
    expect((await db.query<{ title: string }>('select title from course_sessions')).rows).toEqual([{ title: 'CM 1' }]);
    expect((await db.query('select title, course_version, generation from study_artifacts')).rows).toEqual([{ title: 'Fiche v1', course_version: 1, generation: 1 }]);   // renommages / ajouts de colonnes sans perte
    const rows = await rowsOf<{ statut: string }>(db, 'supabase/reconciliation/verify-official-schema.sql');
    expect(rows.at(-1)!.statut).toBe('13 PASS / 0 FAIL');
  });
  it('chaque fichier est présent et lisible dans l’ordre lexicographique (le CLI Supabase applique par nom)', () => {
    expect([...OFFICIAL_MIGRATIONS]).toEqual([...OFFICIAL_MIGRATIONS].sort());
    for (const f of OFFICIAL_MIGRATIONS) expect(readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8').length).toBeGreaterThan(100);
  });
});
