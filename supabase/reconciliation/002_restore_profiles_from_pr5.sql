-- ============================================================================
-- LexNote — RÉCONCILIATION étape 3/3 : reprise des profils (APRÈS les migrations officielles)
-- ============================================================================
-- Les comptes existants (auth.users) n'ont plus de ligne `profiles` dans le schéma officiel (la table a été mise en quarantaine) et le déclencheur
-- d'inscription ne s'exécute que pour les NOUVEAUX comptes. Ce script :
--   1. recopie les profils de legacy_pr5.profiles vers public.profiles (prénom, nom, avatar, établissement, année, onboarding) ;
--   2. crée un profil minimal pour tout compte qui n'en a toujours pas.
-- Les autres données (matières, séances, notes…) ne sont PAS recopiées (schémas incompatibles ; le projet ne contient pas de données importantes) :
-- elles restent consultables dans legacy_pr5 jusqu'à 003_drop_legacy_pr5.sql. Idempotent.
-- ============================================================================
do $$
declare copied bigint := 0; created bigint := 0;
begin
  if to_regclass('public.profiles') is null or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'usage_type') then
    raise exception 'Le schéma officiel n''est pas en place (public.profiles.usage_type absent) : appliquer d''abord les migrations officielles.';
  end if;

  if to_regclass('legacy_pr5.profiles') is not null then
    insert into public.profiles (id, email, first_name, last_name, avatar_url, institution, academic_year, onboarding_completed, created_at)
    select l.id, l.email, l.first_name, l.last_name, l.avatar_url, l.institution, l.academic_year, coalesce(l.onboarding_completed, false), coalesce(l.created_at, now())
    from legacy_pr5.profiles l join auth.users u on u.id = l.id
    on conflict (id) do update set
      email = coalesce(public.profiles.email, excluded.email), first_name = coalesce(nullif(public.profiles.first_name, ''), excluded.first_name),
      last_name = coalesce(nullif(public.profiles.last_name, ''), excluded.last_name), avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
      institution = coalesce(public.profiles.institution, excluded.institution), academic_year = coalesce(public.profiles.academic_year, excluded.academic_year),
      onboarding_completed = public.profiles.onboarding_completed or excluded.onboarding_completed;
    get diagnostics copied = row_count;
  end if;

  insert into public.profiles (id, email) select u.id, u.email from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id);
  get diagnostics created = row_count;
  raise notice 'Profils repris : %, profils minimaux créés : %.', copied, created;
end $$;
