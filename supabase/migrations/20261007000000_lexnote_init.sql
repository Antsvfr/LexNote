-- LexNote — schéma initial (projet Supabase DÉDIÉ à LexNote : ne jamais pointer vers celui de REV-EM).
--
-- Principes :
--   * chaque ligne appartient à UN utilisateur (user_id) ; la sécurité est garantie par Row Level Security,
--     pas par le code React ;
--   * des clés étrangères COMPOSITES (id, user_id) interdisent à une ligne de référencer le parent d'un autre
--     utilisateur, même avec un id deviné ;
--   * les identifiants sont des UUID générés par le client (création hors ligne possible) ;
--   * suppression « douce » (deleted_at) pour que les autres appareils apprennent les suppressions ;
--   * `version` (incrémentée par le serveur) détecte les conflits d'édition ; `server_updated_at` sert de
--     curseur de synchronisation.

-- ---------------------------------------------------------------------------
-- Fonctions communes
-- ---------------------------------------------------------------------------
create or replace function public.lx_touch() returns trigger
language plpgsql as $$
begin
  new.server_updated_at := now();
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'user_id est immuable';
    end if;
    new.version := old.version + 1;
    new.created_at := old.created_at;
  else
    new.version := 1;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- profiles (1 ligne par utilisateur Auth)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  first_name text,
  last_name text,
  avatar_url text,
  institution text,
  academic_year text,
  usage_type text,                       -- université / école / prépa / autre (facultatif)
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.lx_profiles_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.id is distinct from old.id then raise exception 'id immuable'; end if;
  return new;
end $$;
create trigger profiles_touch before insert or update on public.profiles
  for each row execute function public.lx_profiles_touch();

-- Création automatique du profil à l'inscription.
create or replace function public.lx_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.lx_handle_new_user();

-- ---------------------------------------------------------------------------
-- Données académiques
-- ---------------------------------------------------------------------------
create table public.subjects (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  color text not null default 'indigo',
  icon text,
  term text,                             -- année / semestre
  teacher text,
  description text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),      -- horodatage d'édition fourni par le client
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id)
);

create table public.modules (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null,
  name text not null check (char_length(name) between 1 and 160),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (subject_id, user_id) references public.subjects (id, user_id)
);

-- Séances : CM, TD, TP, cours, séminaire… un SEUL modèle (pas de table par type).
create table public.course_sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null,
  module_id uuid,                        -- facultatif : une séance peut exister sans module
  type text not null default 'CM' check (char_length(type) between 1 and 32),
  number integer,
  title text not null default '',
  date date not null,
  start_time time,
  end_time time,
  teacher text,
  room text,
  status text not null default 'in_progress',
  duration_sec integer not null default 0,
  word_count integer not null default 0,
  excerpt text not null default '',
  search_text text not null default '',
  thumbnail text,
  notes_content jsonb,                   -- document riche de l'éditeur (JSON TipTap)
  completed_at timestamptz,
  capture_summary jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (subject_id, user_id) references public.subjects (id, user_id),
  foreign key (module_id, user_id) references public.modules (id, user_id)
);
create index course_sessions_user_date on public.course_sessions (user_id, date desc);

-- ---------------------------------------------------------------------------
-- Capture : transcription, marqueurs, ancrages (les FICHIERS AUDIO ne sont pas synchronisés)
-- ---------------------------------------------------------------------------
create table public.transcript_sessions (
  id uuid primary key,                   -- = id de la séance
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  origin_at timestamptz not null,
  mime_type text,
  provider_id text,
  keep_audio boolean not null default true,
  runs jsonb not null default '[]'::jsonb,
  status text not null default 'INACTIVE',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (session_id, user_id) references public.course_sessions (id, user_id)
);

create table public.transcript_segments (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  start_ms bigint not null,
  end_ms bigint not null,
  text text not null,
  confidence real,
  provider text not null,
  status text not null default 'final',
  source text not null default 'TRANSCRIPTION',
  verification text not null default 'UNVERIFIED',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (session_id, user_id) references public.course_sessions (id, user_id)
);
create index transcript_segments_session on public.transcript_segments (user_id, session_id, start_ms);

create table public.timeline_markers (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  at_ms bigint not null,
  reasons text[] not null default '{}',
  note text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (session_id, user_id) references public.course_sessions (id, user_id)
);

create table public.note_anchors (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  timestamp_ms bigint not null,
  note_position integer not null,
  text_snippet text not null default '',
  nearby_segment_ids uuid[] not null default '{}',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (session_id, user_id) references public.course_sessions (id, user_id)
);

create table public.capture_interruptions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  at_ms bigint not null,
  kind text not null,
  message text not null,
  recoverable boolean not null default true,
  resolved_at_ms bigint,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (session_id, user_id) references public.course_sessions (id, user_id)
);

-- Dernière synchronisation par appareil (information, jamais source de vérité).
create table public.sync_metadata (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device_id uuid not null,
  last_sync_at timestamptz not null default now(),
  client_info text,
  primary key (user_id, device_id)
);

-- Futur : liaison explicite avec un compte REV-EM. NON utilisée — aucune donnée n'est partagée.
create table public.external_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider text not null check (provider in ('rev-em')),
  external_account_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- ---------------------------------------------------------------------------
-- Triggers de version / curseur
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['subjects','modules','course_sessions','transcript_sessions','transcript_segments',
                           'timeline_markers','note_anchors','capture_interruptions']
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.lx_touch()', t || '_touch', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security — NON NÉGOCIABLE
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['subjects','modules','course_sessions','transcript_sessions','transcript_segments',
                           'timeline_markers','note_anchors','capture_interruptions','sync_metadata','external_accounts']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
create policy profiles_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_delete on public.profiles for delete to authenticated using (id = (select auth.uid()));
revoke all on public.profiles from anon;
grant select, insert, update, delete on public.profiles to authenticated;
