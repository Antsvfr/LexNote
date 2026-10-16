-- LexNote — exploitation de `study-ai` : métadonnées d'usage (SANS contenu), budget GLOBAL, rétention, et sonde de santé du schéma.
--
-- Additif et rétro-compatible :
--   * les colonnes ajoutées sont facultatives ; l'ancien appel de la fonction serveur (7 arguments / 3 arguments) fonctionne encore
--     (les nouveaux paramètres ont des valeurs par défaut) → on peut appliquer la migration AVANT de redéployer la fonction ;
--   * aucune donnée n'est supprimée, hormis la purge de rétention (journal technique, 30 jours).
--
-- Ce que le journal contient : utilisateur (UUID), tâche, taille d'entrée, état, jetons, modèle, durée, code d'erreur.
-- Ce qu'il ne contient JAMAIS : transcription, notes, prompt, document, réponse du modèle.

alter table public.study_ai_requests
  add column model text check (model is null or char_length(model) <= 80),
  add column input_tokens integer check (input_tokens is null or input_tokens >= 0),
  add column duration_ms integer check (duration_ms is null or duration_ms >= 0),
  add column error_code text check (error_code is null or char_length(error_code) <= 40);
create index study_ai_requests_started on public.study_ai_requests (started_at);

/* --------------------------------------------------------------- acquire : + budget global + rétention 30 jours */
drop function public.study_ai_acquire(uuid, text, integer, integer, integer, integer, bigint);
create or replace function public.study_ai_acquire(
  p_user uuid, p_task text, p_chars integer,
  p_max_concurrent integer, p_per_minute integer, p_per_day integer, p_chars_per_day bigint,
  p_global_per_day integer default 0, p_global_chars_per_day bigint default 0
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  running int; last_minute int; last_day int; chars_day bigint; oldest timestamptz; new_id bigint;
  g_count int; g_chars bigint; g_oldest timestamptz;
begin
  if p_user is null or p_chars is null or p_chars < 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  -- un seul contrôle à la fois par utilisateur : deux appels simultanés ne peuvent pas « passer » ensemble
  perform pg_advisory_xact_lock(hashtextextended('study_ai:' || p_user::text, 0));
  -- rétention : 30 jours de journal technique (les limites ne regardent que les dernières 24 h)
  delete from public.study_ai_requests where user_id = p_user and started_at < now() - interval '30 days';
  if random() < 0.02 then delete from public.study_ai_requests where started_at < now() - interval '30 days'; end if;
  -- un appel resté « en cours » au-delà du délai maximal de la fonction (plantage, coupure) ne bloque pas l'utilisateur
  update public.study_ai_requests set status = 'expired', finished_at = now()
    where user_id = p_user and status = 'running' and started_at < now() - interval '5 minutes';

  select count(*) into running from public.study_ai_requests where user_id = p_user and status = 'running';
  if running >= p_max_concurrent then
    return jsonb_build_object('ok', false, 'reason', 'concurrent', 'limit', p_max_concurrent, 'retry_after', 10);
  end if;

  select count(*), min(started_at) into last_minute, oldest from public.study_ai_requests
    where user_id = p_user and started_at > now() - interval '1 minute';
  if last_minute >= p_per_minute then
    return jsonb_build_object('ok', false, 'reason', 'per_minute', 'limit', p_per_minute,
      'retry_after', greatest(1, ceil(extract(epoch from (oldest + interval '1 minute' - now())))::int));
  end if;

  select count(*), coalesce(sum(input_chars), 0), min(started_at) into last_day, chars_day, oldest from public.study_ai_requests
    where user_id = p_user and started_at > now() - interval '1 day';
  if last_day >= p_per_day then
    return jsonb_build_object('ok', false, 'reason', 'per_day', 'limit', p_per_day,
      'retry_after', greatest(1, ceil(extract(epoch from (oldest + interval '1 day' - now())))::int));
  end if;
  if chars_day + p_chars > p_chars_per_day then
    return jsonb_build_object('ok', false, 'reason', 'chars_per_day', 'limit', p_chars_per_day,
      'retry_after', greatest(1, ceil(extract(epoch from (oldest + interval '1 day' - now())))::int));
  end if;

  -- budget GLOBAL (tous utilisateurs, 24 h glissantes). Verrou global pris APRÈS le verrou utilisateur, toujours dans cet ordre
  -- (aucun interblocage) ; tenu jusqu'à l'insertion ci-dessous, donc deux utilisateurs ne peuvent pas dépasser le budget ensemble.
  if coalesce(p_global_per_day, 0) > 0 or coalesce(p_global_chars_per_day, 0) > 0 then
    perform pg_advisory_xact_lock(hashtextextended('study_ai:global', 0));
    select count(*), coalesce(sum(input_chars), 0), min(started_at) into g_count, g_chars, g_oldest from public.study_ai_requests
      where started_at > now() - interval '1 day';
    if coalesce(p_global_per_day, 0) > 0 and g_count >= p_global_per_day then
      return jsonb_build_object('ok', false, 'reason', 'global_per_day', 'limit', p_global_per_day,
        'retry_after', greatest(60, ceil(extract(epoch from (g_oldest + interval '1 day' - now())))::int));
    end if;
    if coalesce(p_global_chars_per_day, 0) > 0 and g_chars + p_chars > p_global_chars_per_day then
      return jsonb_build_object('ok', false, 'reason', 'global_chars_per_day', 'limit', p_global_chars_per_day,
        'retry_after', greatest(60, ceil(extract(epoch from (g_oldest + interval '1 day' - now())))::int));
    end if;
  end if;

  insert into public.study_ai_requests (user_id, task, input_chars) values (p_user, p_task, p_chars) returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end $$;

/* --------------------------------------------------------------- release : + métadonnées d'usage */
drop function public.study_ai_release(bigint, text, integer);
create or replace function public.study_ai_release(
  p_id bigint, p_status text, p_output_tokens integer,
  p_input_tokens integer default null, p_model text default null, p_duration_ms integer default null, p_error_code text default null
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.study_ai_requests
    set status = case when p_status in ('ok', 'error', 'refused') then p_status else 'error' end,
        output_tokens = case when p_output_tokens is null then null else greatest(0, p_output_tokens) end,
        input_tokens = case when p_input_tokens is null then null else greatest(0, p_input_tokens) end,
        model = nullif(left(p_model, 80), ''),
        duration_ms = case when p_duration_ms is null then null else greatest(0, p_duration_ms) end,
        error_code = nullif(left(regexp_replace(coalesce(p_error_code, ''), '[^a-z0-9_.-]', '', 'gi'), 40), ''),
        finished_at = now()
    where id = p_id and status = 'running';
end $$;

/* --------------------------------------------------------------- usage agrégé (lecture seule, serveur) */
-- Aucun contenu, aucun utilisateur : des totaux par jour, tâche et état, pour suivre le coût.
create or replace function public.study_ai_usage_summary(p_days integer default 7) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.day desc, t.task), '[]'::jsonb) from (
    select date_trunc('day', started_at)::date as day, task, status, count(*)::int as requests,
           coalesce(sum(input_chars), 0)::bigint as input_chars, coalesce(sum(input_tokens), 0)::bigint as input_tokens,
           coalesce(sum(output_tokens), 0)::bigint as output_tokens, coalesce(round(avg(duration_ms)), 0)::int as avg_ms
    from public.study_ai_requests
    where started_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)))
    group by 1, 2, 3
  ) t
$$;

/* --------------------------------------------------------------- sonde de santé du schéma (booléens uniquement) */
create or replace function public.app_health() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'core', to_regclass('public.profiles') is not null and to_regclass('public.subjects') is not null
            and to_regclass('public.modules') is not null and to_regclass('public.course_sessions') is not null,
    'study', to_regclass('public.study_artifacts') is not null,
    'transcript_artifacts', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'study_artifacts' and column_name = 'source_type'),
    'integration', to_regclass('public.integration_links') is not null and to_regclass('public.integration_link_intents') is not null
                   and to_regclass('public.integration_nonces') is not null,
    'course_refs', to_regclass('public.integration_course_refs') is not null and to_regclass('public.integration_subject_refs') is not null,
    'devices', to_regclass('public.user_devices') is not null
               and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'integration_links' and column_name = 'auto_login'),
    'ai_usage', to_regclass('public.study_ai_requests') is not null
                and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'study_ai_requests' and column_name = 'model')
  )
$$;

/* --------------------------------------------------------------- droits : serveur uniquement */
revoke all on function public.study_ai_acquire(uuid, text, integer, integer, integer, integer, bigint, integer, bigint) from public, anon, authenticated;
revoke all on function public.study_ai_release(bigint, text, integer, integer, text, integer, text) from public, anon, authenticated;
revoke all on function public.study_ai_usage_summary(integer) from public, anon, authenticated;
revoke all on function public.app_health() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.study_ai_acquire(uuid, text, integer, integer, integer, integer, bigint, integer, bigint) to service_role;
    grant execute on function public.study_ai_release(bigint, text, integer, integer, text, integer, text) to service_role;
    grant execute on function public.study_ai_usage_summary(integer) to service_role;
    grant execute on function public.app_health() to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
