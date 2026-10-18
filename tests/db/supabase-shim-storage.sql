-- Complément du « Supabase » minimal : le schéma `storage` (buckets, objets, storage.foldername) dont dépend REV-EM (000_schema.sql, avatars).
-- Utilisé uniquement par scripts/prod/rehearsal.mjs revem-migrations (vrai PostgreSQL local). Les rôles et auth.* viennent de supabase-shim.sql.
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema storage to anon, authenticated, service_role;
