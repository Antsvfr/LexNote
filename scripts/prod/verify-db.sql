-- ============================================================================
-- verify-db.sql — audit LECTURE SEULE des objets d'intégration (à lancer sur LexNote ET sur REV-EM, après la migration)
-- ============================================================================
-- Supabase → SQL Editor → coller → Run. Résultat : une ligne par contrôle (PASS/FAIL) puis « RÉSUMÉ ». Objectif : zéro FAIL.
-- Aucune écriture : uniquement des SELECT sur les catalogues système.
with
tables as (select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname in ('integration_links', 'integration_link_intents', 'integration_nonces')),
fns as (select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as cfg, has_function_privilege('anon', p.oid, 'execute') as anon_x, has_function_privilege('authenticated', p.oid, 'execute') as auth_x, has_function_privilege('public', p.oid, 'execute') as pub_x, (select count(*) from pg_roles r where r.rolname = 'service_role' and has_function_privilege('service_role', p.oid, 'execute')) as svc_x from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'integration\_%'),
checks(n, controle, ok, detail) as (values
  (1,  '3 tables d''intégration présentes', (select count(*) from tables) = 3, (select string_agg(relname, ', ' order by relname) from tables)),
  (2,  'RLS activée sur les 3 tables', (select bool_and(rls) from tables), null),
  (3,  'FORCE RLS sur les 3 tables', (select bool_and(forced) from tables), null),
  (4,  'aucun droit de table pour anon / PUBLIC', not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name like 'integration\_%' and grantee in ('anon', 'PUBLIC')), null),
  (5,  'authenticated : SELECT seulement, sur integration_links', (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name like 'integration\_%' and grantee = 'authenticated' and privilege_type <> 'SELECT') = 0, null),
  (6,  'authenticated ne peut lire AUCUNE colonne de référence', not has_column_privilege('authenticated', 'public.integration_links', 'local_reference', 'select') and not has_column_privilege('authenticated', 'public.integration_links', 'external_reference', 'select'), null),
  (7,  'authenticated ne peut rien lire dans intentions / nonces', not has_table_privilege('authenticated', 'public.integration_link_intents', 'select') and not has_table_privilege('authenticated', 'public.integration_nonces', 'select'), null),
  (8,  'authenticated ne peut rien écrire', not has_table_privilege('authenticated', 'public.integration_links', 'insert, update, delete') and not has_table_privilege('authenticated', 'public.integration_link_intents', 'insert, update, delete'), null),
  (9,  'policy de lecture integration_links : (select auth.uid())', exists (select 1 from pg_policies where tablename = 'integration_links' and cmd = 'SELECT' and qual ~* 'select auth\.uid\(\)'), (select qual from pg_policies where tablename = 'integration_links' limit 1)),
  (10, 'refus explicite sur intentions et nonces', (select count(*) from pg_policies where tablename in ('integration_link_intents', 'integration_nonces') and qual = 'false') = 2, null),
  (11, '≥ 12 fonctions integration_*', (select count(*) from fns) >= 12, (select count(*)::text from fns)),
  (12, 'fonctions SECURITY DEFINER', (select bool_and(prosecdef) from fns), null),
  (13, 'search_path figé (public, pg_temp)', (select bool_and(cfg like '%search_path=public, pg_temp%') from fns), (select string_agg(proname, ', ') from fns where cfg not like '%search_path=public, pg_temp%')),
  (14, 'aucune fonction exécutable par anon / authenticated / PUBLIC', (select bool_and(not anon_x and not auth_x and not pub_x) from fns), (select string_agg(proname, ', ') from fns where anon_x or auth_x or pub_x)),
  (15, 'toutes exécutables par service_role', (select bool_and(svc_x = 1) from fns), null),
  (16, 'unicité : 1 liaison vivante par utilisateur', exists (select 1 from pg_indexes where indexname = 'integration_links_one_live_per_user' and indexdef ilike '%where%'), null),
  (17, 'unicité : relation 1-1 avec le partenaire', exists (select 1 from pg_indexes where indexname = 'integration_links_one_live_per_partner'), null),
  (18, 'link_id unique', exists (select 1 from pg_constraint where conrelid = 'public.integration_links'::regclass and contype = 'u'), null),
  (19, 'index anti-rejeu : clé primaire (sender, nonce)', exists (select 1 from pg_constraint where conrelid = 'public.integration_nonces'::regclass and contype = 'p' and array_length(conkey, 1) = 2), null),
  (20, 'index de purge des nonces', exists (select 1 from pg_indexes where indexname = 'integration_nonces_expiry'), null),
  (21, 'clés étrangères user_id → auth.users en cascade', (select count(*) from pg_constraint where contype = 'f' and confrelid = 'auth.users'::regclass and confdeltype = 'c' and conrelid in ('public.integration_links'::regclass, 'public.integration_link_intents'::regclass)) = 2, null),
  (22, 'chaque clé étrangère est indexée', not exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid in ('public.integration_links'::regclass, 'public.integration_link_intents'::regclass) and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])), null),
  (23, 'durée d''une intention bornée (CHECK ≤ 15 min)', exists (select 1 from pg_constraint where conrelid = 'public.integration_link_intents'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%00:15:00%'), null),
  (24, 'aucune colonne e-mail / jeton / mot de passe / secret', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name like 'integration\_%' and column_name ~* 'mail|token|passw|secret|service_role|key'), null)
)
select n, controle, case when coalesce(ok, false) then 'PASS' else 'FAIL' end as statut, detail from checks
union all
select 999, 'RÉSUMÉ', count(*) filter (where coalesce(ok, false)) || ' PASS / ' || count(*) filter (where not coalesce(ok, false)) || ' FAIL', null from checks
order by 1;
