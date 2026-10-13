-- ============================================================================
-- LexNote — VÉRIFICATION du schéma OFFICIEL (chaîne #3 → #8) — lecture seule
-- ============================================================================
-- À lancer après la réconciliation / les migrations : une ligne PASS/FAIL par contrôle, puis « RÉSUMÉ ». Objectif : zéro FAIL.
-- Complète scripts/prod/verify-db.sql (qui contrôle en détail les tables d'intégration).
with
expected(t) as (values ('profiles'), ('subjects'), ('modules'), ('course_sessions'), ('transcript_sessions'), ('transcript_segments'), ('timeline_markers'), ('note_anchors'), ('capture_interruptions'), ('sync_metadata'),
  ('external_accounts'), ('study_artifacts'), ('source_documents'), ('generated_courses'), ('integration_links'), ('integration_link_intents'), ('integration_nonces')),
col(t, c) as (values ('subjects', 'term'), ('subjects', 'version'), ('subjects', 'server_updated_at'), ('course_sessions', 'type'), ('course_sessions', 'date'), ('course_sessions', 'number'), ('course_sessions', 'notes_content'),
  ('course_sessions', 'capture_summary'), ('transcript_sessions', 'session_id'), ('transcript_segments', 'session_id'), ('timeline_markers', 'at_ms'), ('note_anchors', 'session_id'), ('capture_interruptions', 'session_id'),
  ('study_artifacts', 'course_id'), ('study_artifacts', 'course_version'), ('study_artifacts', 'generated_content'), ('generated_courses', 'course_version'), ('profiles', 'usage_type')),
legacy_col(t, c) as (values ('subjects', 'semester'), ('course_sessions', 'session_type'), ('course_sessions', 'session_number'), ('course_sessions', 'session_date'), ('transcript_segments', 'transcript_session_id'),
  ('transcript_segments', 'course_session_id'), ('timeline_markers', 'marker_type'), ('note_anchors', 'nearby_transcript_segment_ids'), ('transcript_sessions', 'audio_metadata'), ('sync_metadata', 'last_error')),
checks(n, controle, ok, detail) as (values
  (1, '17 tables officielles présentes dans public', (select count(*) from pg_tables where schemaname = 'public' and tablename in (select t from expected)) = 17, (select string_agg(t, ', ') from expected where not exists (select 1 from pg_tables where schemaname = 'public' and tablename = expected.t))),
  (2, 'colonnes caractéristiques du schéma officiel', not exists (select 1 from col where not exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = col.t and k.column_name = col.c)), (select string_agg(t || '.' || c, ', ') from col where not exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = col.t and k.column_name = col.c))),
  (3, 'aucune colonne de l''ancien schéma PR #5 dans public', not exists (select 1 from legacy_col l join information_schema.columns k on k.table_schema = 'public' and k.table_name = l.t and k.column_name = l.c), (select string_agg(l.t || '.' || l.c, ', ') from legacy_col l join information_schema.columns k on k.table_schema = 'public' and k.table_name = l.t and k.column_name = l.c)),
  (4, 'fonctions de l''ancien schéma absentes (set_updated_at, handle_new_user)', not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('set_updated_at', 'handle_new_user')), null),
  (5, 'fonctions officielles présentes (lx_touch, lx_profiles_touch, lx_handle_new_user)', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('lx_touch', 'lx_profiles_touch', 'lx_handle_new_user')) = 3, null),
  (6, 'trigger d''inscription auth.users → lx_handle_new_user', exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'auth.users'::regclass and t.tgname = 'on_auth_user_created' and p.proname = 'lx_handle_new_user'), null),
  (7, 'RLS activée sur les 17 tables', (select bool_and(relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname in (select t from expected)), null),
  (8, 'aucune politique n''appelle auth.uid() hors sous-requête (auth_rls_initplan)', not exists (select 1 from pg_policies where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) ~* 'auth\.uid\(\)' and (coalesce(qual, '') || coalesce(with_check, '')) !~* 'select auth\.uid\(\)'), null),
  (9, 'aucun droit pour anon sur les tables publiques', not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' and table_name in (select t from expected)), null),
  (10, 'toutes les clés étrangères sont indexées', not exists (select 1 from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indpred is null and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)), (select string_agg(c.conrelid::regclass::text || '.' || c.conname, ', ') from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indpred is null and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey))),
  (11, 'clés étrangères composites (id, user_id) : une ligne ne peut pas référencer le parent d''un autre utilisateur', (select count(*) from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace and array_length(conkey, 1) = 2) >= 10, null),
  (12, 'quarantaine legacy_pr5 inaccessible aux navigateurs (si elle existe)', not exists (select 1 from pg_namespace n where n.nspname = 'legacy_pr5' and (has_schema_privilege('anon', n.oid, 'usage') or has_schema_privilege('authenticated', n.oid, 'usage'))), null),
  (13, 'index de pagination de synchronisation (user_id, server_updated_at)', (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('study_artifacts_user_cursor', 'source_documents_user_cursor', 'generated_courses_user_cursor')) = 3, null)
)
select n, controle, case when coalesce(ok, false) then 'PASS' else 'FAIL' end as statut, detail from checks
union all
select 999, 'RÉSUMÉ', count(*) filter (where coalesce(ok, false)) || ' PASS / ' || count(*) filter (where not coalesce(ok, false)) || ' FAIL', null from checks
order by 1;
