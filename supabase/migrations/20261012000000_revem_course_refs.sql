-- LexNote — ouverture d'un cours REV-EM : correspondance STABLE évènement REV-EM → séance LexNote, matière REV-EM → matière LexNote.
--
-- Principes :
--   * l'idempotence est garantie PAR LA BASE (contraintes UNIQUE + verrous consultatifs transactionnels), pas par un `if` du navigateur :
--     10 clics, deux onglets, deux appareils, une nouvelle tentative réseau ⇒ UNE matière correspondante, UNE séance ;
--   * le modèle métier (`subjects`, `course_sessions`) n'est PAS modifié : la correspondance vit dans deux tables de référence dédiées ;
--   * les lignes créées sont des lignes LexNote normales (version 1, synchronisées vers les appareils par le moteur de sync existant, modifiables) ;
--   * aucune policy navigateur : tout passe par `integration_course_open` (service role, Edge Function `integration-link`).
-- Ne stocke JAMAIS de contenu de cours (notes, transcription) : seulement des clés opaques de correspondance.

create table public.integration_subject_refs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('revem')),
  -- identifiant STABLE de la matière côté REV-EM (ou, à défaut, `name:<nom normalisé>`)
  external_subject_ref text not null check (char_length(external_subject_ref) between 1 and 200),
  subject_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_subject_refs_unique unique (user_id, provider, external_subject_ref),
  -- une clé composite interdit de référencer la matière d'un autre utilisateur ; supprimer la matière supprime la correspondance
  foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade
);
create index integration_subject_refs_subject on public.integration_subject_refs (user_id, subject_id);

create table public.integration_course_refs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('revem')),
  -- identifiant STABLE de l'évènement de planning côté REV-EM
  external_event_ref text not null check (char_length(external_event_ref) between 1 and 200),
  session_id uuid not null,
  subject_id uuid not null,
  link_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- LA garantie d'idempotence : un évènement REV-EM ne correspond qu'à UNE séance par utilisateur.
  constraint integration_course_refs_unique unique (user_id, provider, external_event_ref),
  foreign key (session_id, user_id) references public.course_sessions (id, user_id) on delete cascade
);
create index integration_course_refs_session on public.integration_course_refs (user_id, session_id);

alter table public.integration_subject_refs enable row level security;
alter table public.integration_subject_refs force row level security;
alter table public.integration_course_refs enable row level security;
alter table public.integration_course_refs force row level security;
revoke all on public.integration_subject_refs, public.integration_course_refs from public, anon, authenticated;
create policy integration_subject_refs_no_client_access on public.integration_subject_refs for all to anon, authenticated using (false) with check (false);
create policy integration_course_refs_no_client_access on public.integration_course_refs for all to anon, authenticated using (false) with check (false);

-- ---------------------------------------------------------------------------
-- integration_course_open : matière + séance, idempotentes. Renvoie un jsonb {reason, session_id, subject_id, created_*, number}.
-- ---------------------------------------------------------------------------
create or replace function public.integration_course_open(
  p_user uuid, p_provider text, p_link_id text, p_event_key text, p_subject_key text, p_subject_name text,
  p_type text, p_title text, p_date date, p_start time, p_end time, p_teacher text, p_room text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_subject uuid; v_session uuid; v_session_subject uuid; v_created_subject boolean := false; v_created_session boolean := false;
  v_number int; v_color text; v_colors text[] := array['indigo','brass','teal','plum','rust','moss','slate','rose']; v_name text;
begin
  if p_user is null or p_provider is distinct from 'revem' or coalesce(p_event_key, '') = '' or coalesce(p_subject_key, '') = ''
     or char_length(p_event_key) > 200 or char_length(p_subject_key) > 200 or p_date is null then
    return jsonb_build_object('reason', 'INVALID');
  end if;
  v_name := left(btrim(coalesce(nullif(btrim(p_subject_name), ''), 'Cours')), 160);

  -- La liaison doit exister, appartenir à CET utilisateur et être CONNECTED (le serveur l'a déjà vérifiée ; défense en profondeur).
  if not exists (select 1 from public.integration_links l where l.user_id = p_user and l.link_id = p_link_id and l.provider = p_provider and l.status = 'CONNECTED') then
    return jsonb_build_object('reason', 'LINK_NOT_CONNECTED');
  end if;

  -- Verrous transactionnels, TOUJOURS dans cet ordre (matière puis évènement) : pas d'interblocage, et deux ouvertures concurrentes se sérialisent.
  perform pg_advisory_xact_lock(hashtextextended('lxrv:' || p_user::text || ':subject:' || p_subject_key, 0));
  perform pg_advisory_xact_lock(hashtextextended('lxrv:' || p_user::text || ':event:' || p_event_key, 0));

  -- 1) la séance existe déjà pour cet évènement ? (et n'a pas été supprimée par l'étudiant)
  select r.session_id, c.subject_id into v_session, v_session_subject
    from public.integration_course_refs r
    join public.course_sessions c on c.id = r.session_id and c.user_id = r.user_id and c.deleted_at is null
   where r.user_id = p_user and r.provider = p_provider and r.external_event_ref = p_event_key;
  if v_session is not null then
    return jsonb_build_object('reason', 'OK', 'session_id', v_session, 'subject_id', v_session_subject, 'created_subject', false, 'created_session', false);
  end if;

  -- 2) la matière : correspondance stable d'abord ; sinon adoption d'une matière LexNote de même nom (non liée à une AUTRE matière REV-EM) ; sinon création.
  select r.subject_id into v_subject
    from public.integration_subject_refs r
    join public.subjects s on s.id = r.subject_id and s.user_id = r.user_id and s.deleted_at is null
   where r.user_id = p_user and r.provider = p_provider and r.external_subject_ref = p_subject_key;
  if v_subject is null then
    select s.id into v_subject from public.subjects s
     where s.user_id = p_user and s.deleted_at is null and lower(btrim(s.name)) = lower(v_name)
       and not exists (select 1 from public.integration_subject_refs r where r.user_id = p_user and r.provider = p_provider and r.subject_id = s.id and r.external_subject_ref <> p_subject_key)
     order by s.created_at, s.id limit 1;
    if v_subject is null then
      select c into v_color from unnest(v_colors) c
       left join (select color, count(*) n from public.subjects where user_id = p_user and deleted_at is null group by color) u on u.color = c
       order by coalesce(u.n, 0), array_position(v_colors, c) limit 1;
      v_subject := gen_random_uuid();
      insert into public.subjects (id, user_id, name, color) values (v_subject, p_user, v_name, coalesce(v_color, 'indigo'));
      v_created_subject := true;
    end if;
    insert into public.integration_subject_refs (user_id, provider, external_subject_ref, subject_id)
      values (p_user, p_provider, p_subject_key, v_subject)
      on conflict (user_id, provider, external_subject_ref) do update set subject_id = excluded.subject_id, updated_at = now();
  end if;

  -- 3) la séance : numéro suivant pour ce type dans cette matière (CM 04 si CM 01-03 existent), comme dans l'application.
  select coalesce(max(number), 0) + 1 into v_number from public.course_sessions
   where user_id = p_user and subject_id = v_subject and type = p_type and deleted_at is null;
  v_session := gen_random_uuid();
  insert into public.course_sessions (id, user_id, subject_id, type, number, title, date, start_time, end_time, teacher, room)
    values (v_session, p_user, v_subject, left(p_type, 32), v_number, left(coalesce(p_title, ''), 300), p_date, p_start, p_end, nullif(left(btrim(coalesce(p_teacher, '')), 120), ''), nullif(left(btrim(coalesce(p_room, '')), 120), ''));
  v_created_session := true;
  insert into public.integration_course_refs (user_id, provider, external_event_ref, session_id, subject_id, link_id)
    values (p_user, p_provider, p_event_key, v_session, v_subject, p_link_id)
    on conflict (user_id, provider, external_event_ref) do update set session_id = excluded.session_id, subject_id = excluded.subject_id, link_id = excluded.link_id, updated_at = now();

  return jsonb_build_object('reason', 'OK', 'session_id', v_session, 'subject_id', v_subject, 'created_subject', v_created_subject, 'created_session', v_created_session, 'number', v_number);
end $$;

do $$
begin
  revoke all on function public.integration_course_open(uuid, text, text, text, text, text, text, text, date, time, time, text, text) from public, anon, authenticated;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.integration_course_open(uuid, text, text, text, text, text, text, text, date, time, time, text, text) to service_role;
  end if;
end $$;
