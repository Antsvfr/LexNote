-- « Supabase » minimal pour les tests : rôles, schéma auth, auth.uid(), droits par défaut. Utilisé par tests/db/schemaKit.ts (PGlite)
-- ET par scripts/prod/rehearsal.mjs (vrai PostgreSQL local).
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users (id) on delete cascade);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
-- Comportement par défaut de Supabase : tout nouvel objet de public est accessible aux rôles API (les migrations doivent donc REVOQUER ce qu'elles ne veulent pas exposer).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
