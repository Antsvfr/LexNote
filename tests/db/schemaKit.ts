// Outillage de test des migrations : un « Supabase » minimal (rôles, auth.users, auth.uid, droits par défaut comme sur Supabase) au-dessus de PGlite.
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const MIGRATIONS_DIR = 'supabase/migrations';
/** L'ordre EXACT et COMPLET de la chaîne officielle #3 → #9 (+ hardening production). Toute migration future s'ajoute ici. */
export const OFFICIAL_MIGRATIONS = [
  '20261007000000_lexnote_init.sql',
  '20261008000000_study_artifacts.sql',
  '20261009000000_course_engine.sql',
  '20261010000000_study_artifacts_from_course.sql',
  '20261011000000_integration_links.sql',
  '20261012000000_fk_indexes.sql',
  '20261013000000_security_hardening.sql',
] as const;
export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';
export const C = '33333333-3333-4333-8333-333333333333';

const read = (f: string) => readFileSync(f, 'utf8').replace(/create extension[^;]*;/gi, '');   // pgcrypto : natif dans PGlite (gen_random_uuid)

export async function supabaseShim(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated, service_role;
    -- Comportement par défaut de Supabase : tout nouvel objet de public est accessible aux rôles API (les migrations doivent donc REVOQUER ce qu'elles ne veulent pas exposer).
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);
  return db;
}
export const applyFile = (db: PGlite, file: string) => db.exec(read(file));
export const applyOfficial = async (db: PGlite, upTo?: number) => { for (const f of OFFICIAL_MIGRATIONS.slice(0, upTo)) await applyFile(db, `${MIGRATIONS_DIR}/${f}`); };
export const officialFiles = () => readdirSync(MIGRATIONS_DIR).sort();
export async function rowsOf<T = Record<string, unknown>>(db: PGlite, file: string): Promise<T[]> {
  const res = await db.exec(readFileSync(file, 'utf8'));
  return res[res.length - 1]!.rows as T[];
}
export async function as<T>(db: PGlite, user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${user ? 'authenticated' : 'anon'};`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}

/** Instantané normalisé de TOUT ce qui est dans `public` (hors données) : sert à prouver que deux chemins aboutissent au MÊME schéma. */
export async function catalog(db: PGlite) {
  const q = async (s: string) => (await db.query<Record<string, string>>(s)).rows;
  const norm = (rows: Record<string, string>[]) => rows.map((r) => Object.values(r).join(' | ')).sort();
  return {
    columns: norm(await q(`select table_name, column_name, data_type, is_nullable, coalesce(column_default, '') from information_schema.columns where table_schema = 'public'`)),
    constraints: norm(await q(`select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace`)),
    indexes: norm(await q(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public'`)),
    policies: norm(await q(`select tablename, policyname, cmd, roles::text, coalesce(qual, ''), coalesce(with_check, '') from pg_policies where schemaname = 'public'`)),
    triggers: norm(await q(`select event_object_table, trigger_name, action_timing, event_manipulation, action_statement from information_schema.triggers where trigger_schema = 'public' or event_object_schema = 'auth'`)),
    functions: norm(await q(`select proname, pg_get_function_identity_arguments(oid), prosecdef::text, coalesce(array_to_string(proconfig, ','), ''), has_function_privilege('anon', oid, 'execute')::text, has_function_privilege('authenticated', oid, 'execute')::text, has_function_privilege('service_role', oid, 'execute')::text from pg_proc where pronamespace = 'public'::regnamespace`)),
    rls: norm(await q(`select relname, relrowsecurity::text, relforcerowsecurity::text from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`)),
    tableGrants: norm(await q(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')`)),
    columnGrants: norm(await q(`select table_name, column_name, grantee, privilege_type from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT' or (table_schema = 'public' and table_name like 'integration\\_%' and grantee in ('anon', 'authenticated'))`)),
  };
}
