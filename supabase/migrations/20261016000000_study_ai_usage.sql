-- LexNote — limitation de débit et de coût de l'Edge Function `study-ai` (actions IA sur la transcription).
--
-- Un journal minimal par appel (aucun texte : seulement l'utilisateur, la tâche, la taille d'entrée, l'horodatage, l'état)
-- et deux fonctions appelées UNIQUEMENT par la fonction serveur (service_role) :
--   * study_ai_acquire  : vérifie atomiquement (verrou consultatif par utilisateur) les limites — appels simultanés, appels par
--                         minute, appels par jour, volume de texte par jour — et réserve l'appel ; sinon renvoie la raison et le délai ;
--   * study_ai_release  : clôt l'appel (ok / erreur / refus) et libère la place « simultanée ».
-- Aucun accès navigateur : RLS forcée, aucune policy, aucun droit pour anon/authenticated.
-- Données de calcul, purgées automatiquement après 2 jours.

create table public.study_ai_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  task text not null check (char_length(task) between 1 and 40),
  input_chars integer not null check (input_chars >= 0),
  status text not null default 'running' check (status in ('running', 'ok', 'error', 'refused', 'expired')),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index study_ai_requests_user_started on public.study_ai_requests (user_id, started_at desc);

alter table public.study_ai_requests enable row level security;
alter table public.study_ai_requests force row level security;
revoke all on public.study_ai_requests from public, anon, authenticated;

create or replace function public.study_ai_acquire(
  p_user uuid, p_task text, p_chars integer,
  p_max_concurrent integer, p_per_minute integer, p_per_day integer, p_chars_per_day bigint
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  running int; last_minute int; last_day int; chars_day bigint; oldest timestamptz; new_id bigint;
begin
  if p_user is null or p_chars is null or p_chars < 0 then
    return jsonb_build_object('ok', false, 'reason', 'bad_request');
  end if;
  -- un seul contrôle à la fois par utilisateur : deux appels simultanés ne peuvent pas « passer » ensemble
  perform pg_advisory_xact_lock(hashtextextended('study_ai:' || p_user::text, 0));
  delete from public.study_ai_requests where user_id = p_user and started_at < now() - interval '2 days';
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

  insert into public.study_ai_requests (user_id, task, input_chars) values (p_user, p_task, p_chars) returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end $$;

create or replace function public.study_ai_release(p_id bigint, p_status text, p_output_tokens integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.study_ai_requests
    set status = case when p_status in ('ok', 'error', 'refused') then p_status else 'error' end,
        output_tokens = p_output_tokens, finished_at = now()
    where id = p_id and status = 'running';
end $$;

-- Appelables par le SERVEUR uniquement (service_role) : jamais par un navigateur.
revoke execute on function public.study_ai_acquire(uuid, text, integer, integer, integer, integer, bigint) from public, anon, authenticated;
revoke execute on function public.study_ai_release(bigint, text, integer) from public, anon, authenticated;
grant execute on function public.study_ai_acquire(uuid, text, integer, integer, integer, integer, bigint) to service_role;
grant execute on function public.study_ai_release(bigint, text, integer) to service_role;
