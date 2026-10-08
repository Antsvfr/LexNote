-- ============================================================================
-- LexNote — RÉCONCILIATION étape 1/3 : mise en quarantaine de l'ancien schéma expérimental (PR #5, `001_multiuser_core.sql` + `002_performance_hardening.sql`)
-- ============================================================================
-- À exécuter UNE fois sur un projet Supabase LexNote qui porte l'ancien schéma de la PR #5 (SUPERSEDED), AVANT d'appliquer les migrations officielles.
-- Voir docs/SCHEMA_RECONCILIATION.md. Ne PAS lancer 20261007000000_lexnote_init.sql « par-dessus » : les tables existent déjà avec une autre structure.
--
-- Ce que fait ce script (atomique : tout ou rien) :
--   1. vérifie la SIGNATURE de l'ancien schéma — refuse de toucher à un schéma inconnu ou déjà officiel (dans ce dernier cas : rien à faire) ;
--   2. supprime ses déclencheurs, politiques et fonctions (`set_updated_at`, `handle_new_user`, trigger `on_auth_user_created` sur auth.users) ;
--   3. DÉPLACE ses 10 tables vers le schéma `legacy_pr5` (aucune donnée n'est supprimée) et les rend inaccessibles à tout navigateur / API (RLS forcée, aucun droit, schéma non exposé) ;
--   4. laisse `public` vide de tout objet LexNote : les migrations officielles peuvent alors s'appliquer sur une base « propre ».
-- Aucune ligne de auth.users n'est touchée. Les données restent dans `legacy_pr5` jusqu'à 003_drop_legacy_pr5.sql (à lancer après vérification).
-- Idempotent : relancé après coup, il constate l'absence de l'ancien schéma et ne fait rien.
-- ============================================================================
do $$
declare
  legacy_tables constant text[] := array['profiles', 'subjects', 'modules', 'course_sessions', 'transcript_sessions', 'transcript_segments', 'timeline_markers', 'note_anchors', 'capture_interruptions', 'sync_metadata'];
  t text; p record; rows_total bigint := 0; n bigint;
  is_legacy boolean; is_official boolean; has_any boolean;
begin
  has_any := to_regclass('public.subjects') is not null or to_regclass('public.course_sessions') is not null or to_regclass('public.profiles') is not null;
  is_official := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'subjects' and column_name = 'term')
                 and exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'lx_touch');
  is_legacy := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'subjects' and column_name = 'semester')
               and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'course_sessions' and column_name = 'session_type')
               and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'transcript_segments' and column_name = 'transcript_session_id');

  if is_official then raise notice 'Schéma OFFICIEL déjà en place : rien à mettre en quarantaine.'; return; end if;
  if not has_any then raise notice 'Aucune table LexNote dans public : projet vierge, appliquer directement les migrations officielles (étape 2).'; return; end if;
  if not is_legacy then
    raise exception 'Schéma inconnu (ni officiel, ni celui de la PR #5) : arrêt sans rien modifier. Inspecter public.subjects / public.course_sessions avant de continuer.';
  end if;

  -- Volume de données conservé (information, pas un blocage : tout est préservé dans legacy_pr5)
  foreach t in array legacy_tables loop
    if to_regclass(format('public.%I', t)) is not null then execute format('select count(*) from public.%I', t) into n; rows_total := rows_total + n; end if;
  end loop;
  raise notice 'Ancien schéma PR #5 détecté — % ligne(s) seront CONSERVÉES dans le schéma legacy_pr5.', rows_total;

  -- 2. déclencheurs, politiques, fonctions de l'ancien schéma
  drop trigger if exists on_auth_user_created on auth.users;
  foreach t in array legacy_tables loop
    if to_regclass(format('public.%I', t)) is not null then
      for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
        execute format('drop policy %I on public.%I', p.policyname, t);
      end loop;
      execute format('drop trigger if exists %I on public.%I', 'set_' || t || '_updated_at', t);
    end if;
  end loop;

  -- 3. quarantaine
  create schema if not exists legacy_pr5;
  revoke all on schema legacy_pr5 from public, anon, authenticated;
  foreach t in array legacy_tables loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table public.%I set schema legacy_pr5', t);
      execute format('alter table legacy_pr5.%I enable row level security', t);
      execute format('alter table legacy_pr5.%I force row level security', t);
      execute format('revoke all on legacy_pr5.%I from public, anon, authenticated', t);
    end if;
  end loop;
  comment on schema legacy_pr5 is 'Quarantaine de l''ancien schéma PR #5 (SUPERSEDED). Aucun accès navigateur. Supprimer avec 003_drop_legacy_pr5.sql après vérification.';

  drop function if exists public.set_updated_at();
  drop function if exists public.handle_new_user();

  raise notice 'Quarantaine terminée. Étape suivante : appliquer les migrations officielles dans l''ordre (docs/SCHEMA_RECONCILIATION.md §5).';
end $$;
