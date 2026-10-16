// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { A, B, C, MIGRATIONS_DIR, OFFICIAL_MIGRATIONS, applyFile, applyOfficial, as, catalog, rowsOf, supabaseShim } from './schemaKit';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const RECON = 'supabase/reconciliation';
const FIXTURE = readFileSync('tests/db/fixtures/pr5-experimental-schema.sql', 'utf8').replace(/create extension[^;]*;/gi, '');
const FIXTURE_001_ONLY = FIXTURE.split('-- Performance hardening')[0]!;     // variante : projet où seule 001 avait été appliquée
const verify = (db: PGlite) => rowsOf<{ n: number; controle: string; statut: string; detail: string | null }>(db, `${RECON}/verify-official-schema.sql`);
const fails = (rows: { controle: string; statut: string }[]) => rows.filter((r) => r.statut === 'FAIL').map((r) => r.controle);
const count = async (db: PGlite, t: string) => Number(((await db.query<{ c: string }>(`select count(*) c from ${t}`)).rows[0]!).c);

/** Projet LexNote « tel qu'il est aujourd'hui » : schéma expérimental PR #5 + quelques comptes et lignes de test. */
async function legacyProject(fixture = FIXTURE): Promise<PGlite> {
  const db = await supabaseShim();
  await db.exec(fixture);
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'a@t.fr', '{"first_name":"Alice"}'), ($2, 'b@t.fr', '{"first_name":"Bob"}'), ($3, 'c@t.fr', '{}')`, [A, B, C]);   // le trigger #5 crée les profils
  await db.query(`update profiles set last_name = 'Martin', institution = 'Lyon 3', academic_year = 'L2', onboarding_completed = true where id = $1`, [A]);
  const sub = '0000000a-0000-4000-8000-000000000001', ses = '0000000a-0000-4000-8000-000000000002', tr = '0000000a-0000-4000-8000-000000000003';
  await as(db, A, async () => {
    await db.query(`insert into subjects (id, user_id, name, semester) values ($1, $2, 'Droit civil', 'S3')`, [sub, A]);
    await db.query(`insert into course_sessions (id, user_id, subject_id, title, session_type, session_number) values ($1, $3, $2, 'CM 1', 'CM', 1)`, [ses, sub, A]);
    await db.query(`insert into transcript_sessions (id, user_id, course_session_id) values ($1, $3, $2)`, [tr, ses, A]);
    await db.query(`insert into transcript_segments (user_id, transcript_session_id, course_session_id, text) values ($3, $1, $2, 'Bonjour')`, [tr, ses, A]);
  });
  await db.query(`delete from auth.users where id = $1`, [C]);
  await db.query(`insert into auth.users (id, email) values ($1, 'c@t.fr')`, [C]);
  await db.query(`delete from profiles where id = $1`, [C]);                       // compte SANS profil (cas à rattraper)
  return db;
}

describe('le problème : l’ancien schéma est incompatible avec le schéma officiel', () => {
  it('lexnote_init.sql appliqué « par-dessus » le schéma #5 échoue (tables et fonctions déjà présentes, structure différente)', async () => {
    const db = await legacyProject();
    await expect(applyFile(db, `${MIGRATIONS_DIR}/${OFFICIAL_MIGRATIONS[0]}`)).rejects.toThrow();
  });
  it('verify-official-schema.sql détecte l’ancien schéma (9 contrôles en échec)', async () => {
    const db = await legacyProject();
    const before = await verify(db);
    expect(fails(before)).toHaveLength(9);
    expect(fails(before)).toEqual(expect.arrayContaining(['17 tables officielles présentes dans public', "aucune colonne de l'ancien schéma PR #5 dans public", "trigger d'inscription auth.users → lx_handle_new_user", "fonctions de l'ancien schéma absentes (set_updated_at, handle_new_user)"]));
  });
});

describe.each([['001 + 002 (cas général)', FIXTURE], ['001 seule', FIXTURE_001_ONLY]])('réconciliation depuis le schéma #5 — %s', (_label, fixture) => {
  let db: PGlite; let fresh: PGlite;
  beforeAll(async () => {
    db = await legacyProject(fixture);
    await applyFile(db, `${RECON}/001_quarantine_pr5_schema.sql`);            // étape 1
    await applyOfficial(db);                                                  // étape 2 : migrations officielles, dans l'ordre
    await applyFile(db, `${RECON}/002_restore_profiles_from_pr5.sql`);        // étape 3
    fresh = await supabaseShim(); await applyOfficial(fresh);                 // référence : projet neuf
  });

  it('étape 1 : l’ancien schéma est en quarantaine (données conservées), public ne contient plus rien de l’ancien', async () => {
    expect(await count(db, 'legacy_pr5.subjects')).toBe(1);
    expect(await count(db, 'legacy_pr5.transcript_segments')).toBe(1);
    expect(await count(db, 'legacy_pr5.profiles')).toBe(3 - 1);                // le compte C n'avait pas de profil
    const old = await db.query(`select 1 from information_schema.columns where table_schema = 'public' and column_name in ('semester', 'session_type', 'transcript_session_id')`);
    expect(old.rows).toEqual([]);
    expect((await db.query(`select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('set_updated_at', 'handle_new_user')`)).rows).toEqual([]);
  });
  it('la quarantaine est inaccessible aux navigateurs (ni anon, ni authenticated) mais lisible côté serveur', async () => {
    await expect(as(db, A, () => db.query('select * from legacy_pr5.subjects'))).rejects.toThrow(/permission denied/);
    await expect(as(db, null, () => db.query('select * from legacy_pr5.subjects'))).rejects.toThrow(/permission denied/);
    expect(await count(db, 'legacy_pr5.subjects')).toBe(1);
    const rls = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'legacy_pr5'::regnamespace and relkind = 'r'`);
    expect(rls.rows).toHaveLength(10); expect(rls.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
    expect((await db.query(`select 1 from pg_policies where schemaname = 'legacy_pr5'`)).rows).toEqual([]);
  });
  it('étape 3 : profils repris (données conservées) et profil minimal créé pour le compte qui n’en avait pas', async () => {
    const p = (await db.query<{ id: string; first_name: string; last_name: string; institution: string; onboarding_completed: boolean }>('select id, first_name, last_name, institution, onboarding_completed from profiles order by email')).rows;
    expect(p).toHaveLength(3);
    expect(p.find((x) => x.id === A)).toMatchObject({ first_name: 'Alice', last_name: 'Martin', institution: 'Lyon 3', onboarding_completed: true });
    expect(p.find((x) => x.id === C)).toMatchObject({ first_name: null, onboarding_completed: false });
  });
  it('RÉSULTAT : verify-official-schema.sql 13 PASS et verify-db.sql 24 PASS', async () => {
    expect(fails(await verify(db))).toEqual([]);
    expect((await verify(db)).at(-1)!.statut).toBe('13 PASS / 0 FAIL');
    expect((await rowsOf<{ statut: string }>(db, 'scripts/prod/verify-db.sql')).at(-1)!.statut).toBe('24 PASS / 0 FAIL');
  });
  it('RÉSULTAT : le schéma public est IDENTIQUE à celui d’un projet neuf (colonnes, contraintes, index, politiques, triggers, fonctions, RLS, droits)', async () => {
    const [a, b] = [await catalog(db), await catalog(fresh)];
    for (const k of Object.keys(b) as (keyof typeof b)[]) expect(a[k], k).toEqual(b[k]);
  });
  it('RÉSULTAT : l’application fonctionne — isolation A/B, trigger d’inscription officiel, clés composites', async () => {
    const sA = '0000000c-0000-4000-8000-000000000001';
    await as(db, A, () => db.query(`insert into subjects (id, name, term) values ($1, 'Économie', 'S4')`, [sA]));
    expect((await as(db, B, () => db.query('select * from subjects'))).rows).toEqual([]);
    await expect(as(db, B, () => db.query(`insert into modules (id, subject_id, name) values (gen_random_uuid(), $1, 'M')`, [sA]))).rejects.toThrow();
    const D = '44444444-4444-4444-8444-444444444444';
    await db.query(`insert into auth.users (id, email) values ($1, 'd@t.fr')`, [D]);
    expect((await db.query('select email from profiles where id = $1', [D])).rows).toEqual([{ email: 'd@t.fr' }]);         // lx_handle_new_user
    await expect(as(db, A, () => db.query('select * from legacy_pr5.profiles'))).rejects.toThrow(/permission denied/);
  });
  it('idempotence : relancer 001 et 002 ne casse rien ni ne duplique', async () => {
    await applyFile(db, `${RECON}/001_quarantine_pr5_schema.sql`);
    await applyFile(db, `${RECON}/002_restore_profiles_from_pr5.sql`);
    expect(await count(db, 'profiles')).toBe(4);
    expect(await count(db, 'legacy_pr5.subjects')).toBe(1);
    expect(fails(await verify(db))).toEqual([]);
  });
  it('003 : suppression définitive de la quarantaine, schéma officiel inchangé', async () => {
    await applyFile(db, `${RECON}/003_drop_legacy_pr5.sql`);
    expect((await db.query(`select 1 from pg_namespace where nspname = 'legacy_pr5'`)).rows).toEqual([]);
    expect(fails(await verify(db))).toEqual([]);
    const [a, b] = [await catalog(db), await catalog(fresh)];
    expect(a).toEqual(b);
  });
});

describe('garde-fous de 001_quarantine_pr5_schema.sql', () => {
  it('projet déjà officiel : ne fait rien', async () => {
    const db = await supabaseShim(); await applyOfficial(db);
    const before = await catalog(db);
    await applyFile(db, `${RECON}/001_quarantine_pr5_schema.sql`);
    expect(await catalog(db)).toEqual(before);
    expect((await db.query(`select 1 from pg_namespace where nspname = 'legacy_pr5'`)).rows).toEqual([]);
  });
  it('projet vierge : ne fait rien (on applique directement les migrations)', async () => {
    const db = await supabaseShim();
    await applyFile(db, `${RECON}/001_quarantine_pr5_schema.sql`);
    await applyOfficial(db);
    expect(fails(await verify(db))).toEqual([]);
  });
  it('schéma inconnu : refuse et ne modifie rien', async () => {
    const db = await supabaseShim();
    await db.exec(`create table public.subjects (id uuid primary key, name text); create table public.course_sessions (id uuid primary key); insert into public.subjects values (gen_random_uuid(), 'x');`);
    await expect(applyFile(db, `${RECON}/001_quarantine_pr5_schema.sql`)).rejects.toThrow(/Schéma inconnu/);
    expect(await count(db, 'public.subjects')).toBe(1);
    expect((await db.query(`select 1 from pg_namespace where nspname = 'legacy_pr5'`)).rows).toEqual([]);
  });
  it('002 refuse de s’exécuter sans le schéma officiel', async () => {
    const db = await supabaseShim();
    await expect(applyFile(db, `${RECON}/002_restore_profiles_from_pr5.sql`)).rejects.toThrow(/schéma officiel n.est pas en place/);
  });
  it('001 est ATOMIQUE : si une étape échoue (dépendance cachée), rien n’est déplacé ni supprimé', async () => {
    const db = await legacyProject();
    // un objet d’un autre schéma dépend de public.handle_new_user() : « drop function » échouera EN FIN de script, après le déplacement des tables
    await db.exec(`create schema other; create table other.t (x int); create trigger blocker before insert on other.t for each row execute function public.handle_new_user();`);
    const policiesBefore = (await db.query(`select count(*) c from pg_policies where schemaname = 'public'`)).rows[0];
    await expect(applyFile(db, `${RECON}/001_quarantine_pr5_schema.sql`)).rejects.toThrow(/depend/i);
    expect((await db.query(`select 1 from pg_namespace where nspname = 'legacy_pr5'`)).rows).toEqual([]);
    expect(await count(db, 'public.subjects')).toBe(1);
    expect((await db.query(`select count(*) c from pg_policies where schemaname = 'public'`)).rows[0]).toEqual(policiesBefore);   // politiques supprimées dans la transaction → restaurées
    expect((await db.query(`select 1 from pg_trigger where tgname = 'on_auth_user_created'`)).rows).toHaveLength(1);
    expect((await db.query(`select 1 from pg_trigger where tgname = 'set_subjects_updated_at'`)).rows).toHaveLength(1);
  });
});
