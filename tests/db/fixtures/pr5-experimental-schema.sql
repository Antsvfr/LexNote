-- FIXTURE DE TEST — ancien schéma expérimental de la PR #5 (SUPERSEDED), copie verbatim de ses migrations 001 + 002 (commit 7979cea).
-- Ne JAMAIS appliquer à un vrai projet : sert uniquement à tester supabase/reconciliation/.
-- LexNote multi-user foundation (source of truth for a fresh Supabase project)
-- Applied to project ylggagkweyzorhjbihyq on 2026-10-07.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  first_name text,
  last_name text,
  avatar_url text,
  institution text,
  academic_year text,
  quote text,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text,
  icon text,
  teacher text,
  semester text,
  description text,
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table if not exists public.modules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null,
  name text not null,
  description text,
  position integer not null default 0,
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  constraint modules_subject_fk foreign key (subject_id) references public.subjects(id) on delete cascade,
  constraint modules_user_subject_fk foreign key (user_id, subject_id) references public.subjects(user_id, id) on delete cascade
);

create table if not exists public.course_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null,
  module_id uuid,
  session_type text not null default 'COURSE'
    check (session_type in ('CM','TD','TP','COURSE','SEMINAR','WORKSHOP','REVISION','OTHER')),
  session_number integer,
  title text not null,
  session_date date,
  start_time time,
  end_time time,
  teacher text,
  room text,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','IN_PROGRESS','COMPLETED','ARCHIVED')),
  notes jsonb,
  word_count integer not null default 0,
  duration_sec integer not null default 0,
  excerpt text not null default '',
  search_text text not null default '',
  thumbnail text,
  completed_at timestamptz,
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  constraint course_sessions_subject_fk foreign key (subject_id) references public.subjects(id) on delete cascade,
  constraint course_sessions_module_fk foreign key (module_id) references public.modules(id) on delete set null,
  constraint course_sessions_user_subject_fk foreign key (user_id, subject_id) references public.subjects(user_id, id) on delete cascade,
  constraint course_sessions_user_module_fk foreign key (user_id, module_id) references public.modules(user_id, id) on delete set null
);

create table if not exists public.transcript_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_session_id uuid not null,
  provider text,
  status text not null default 'INACTIVE',
  started_at timestamptz,
  ended_at timestamptz,
  audio_metadata jsonb,
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  constraint transcript_sessions_course_fk foreign key (course_session_id) references public.course_sessions(id) on delete cascade,
  constraint transcript_sessions_user_course_fk foreign key (user_id, course_session_id) references public.course_sessions(user_id, id) on delete cascade
);

create table if not exists public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transcript_session_id uuid not null,
  course_session_id uuid not null,
  sequence integer not null default 0,
  start_ms bigint,
  end_ms bigint,
  text text not null default '',
  confidence real,
  provider text,
  status text,
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transcript_segments_session_fk foreign key (transcript_session_id) references public.transcript_sessions(id) on delete cascade,
  constraint transcript_segments_course_fk foreign key (course_session_id) references public.course_sessions(id) on delete cascade,
  constraint transcript_segments_user_transcript_fk foreign key (user_id, transcript_session_id) references public.transcript_sessions(user_id, id) on delete cascade,
  constraint transcript_segments_user_course_fk foreign key (user_id, course_session_id) references public.course_sessions(user_id, id) on delete cascade
);

create table if not exists public.timeline_markers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_session_id uuid not null,
  marker_type text not null default 'IMPORTANT',
  reasons jsonb not null default '[]'::jsonb,
  timestamp_ms bigint not null default 0,
  label text,
  note text,
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timeline_markers_course_fk foreign key (course_session_id) references public.course_sessions(id) on delete cascade,
  constraint timeline_markers_user_course_fk foreign key (user_id, course_session_id) references public.course_sessions(user_id, id) on delete cascade
);

create table if not exists public.note_anchors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_session_id uuid not null,
  timestamp_ms bigint not null default 0,
  note_position jsonb,
  nearby_transcript_segment_ids uuid[] not null default '{}',
  version integer not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint note_anchors_course_fk foreign key (course_session_id) references public.course_sessions(id) on delete cascade,
  constraint note_anchors_user_course_fk foreign key (user_id, course_session_id) references public.course_sessions(user_id, id) on delete cascade
);

create table if not exists public.capture_interruptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_session_id uuid not null,
  at_ms bigint not null default 0,
  kind text not null,
  message text not null,
  recoverable boolean not null default false,
  resolved_at_ms bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capture_interruptions_course_fk foreign key (course_session_id) references public.course_sessions(id) on delete cascade,
  constraint capture_interruptions_user_course_fk foreign key (user_id, course_session_id) references public.course_sessions(user_id, id) on delete cascade
);

create table if not exists public.sync_metadata (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, device_id)
);

create index if not exists subjects_user_id_idx on public.subjects(user_id);
create index if not exists modules_user_id_idx on public.modules(user_id);
create index if not exists modules_subject_id_idx on public.modules(subject_id);
create index if not exists course_sessions_user_id_idx on public.course_sessions(user_id);
create index if not exists course_sessions_subject_id_idx on public.course_sessions(subject_id);
create index if not exists course_sessions_module_id_idx on public.course_sessions(module_id);
create index if not exists transcript_sessions_course_idx on public.transcript_sessions(course_session_id);
create index if not exists transcript_segments_course_idx on public.transcript_segments(course_session_id);
create index if not exists timeline_markers_course_idx on public.timeline_markers(course_session_id);
create index if not exists note_anchors_course_idx on public.note_anchors(course_session_id);
create index if not exists capture_interruptions_course_idx on public.capture_interruptions(course_session_id);

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','subjects','modules','course_sessions','transcript_sessions',
    'transcript_segments','timeline_markers','note_anchors','capture_interruptions','sync_metadata'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (auth.uid() = id);
create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = id);
create policy profiles_update_own on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy profiles_delete_own on public.profiles for delete using (auth.uid() = id);

do $$
declare t text;
begin
  foreach t in array array[
    'subjects','modules','course_sessions','transcript_sessions','transcript_segments',
    'timeline_markers','note_anchors','capture_interruptions','sync_metadata'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_own_all', t);
    execute format(
      'create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_own_all', t
    );
  end loop;
end $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, first_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'first_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','subjects','modules','course_sessions','transcript_sessions',
    'transcript_segments','timeline_markers','note_anchors','capture_interruptions','sync_metadata'
  ]
  loop
    execute format('drop trigger if exists set_%s_updated_at on public.%I', t, t);
    execute format(
      'create trigger set_%s_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      t, t
    );
  end loop;
end $$;

-- Performance hardening for RLS and composite foreign keys.

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_select_own on public.profiles for select using ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles for insert with check ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy profiles_delete_own on public.profiles for delete using ((select auth.uid()) = id);

drop policy if exists subjects_own_all on public.subjects;
create policy subjects_own_all on public.subjects for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists modules_own_all on public.modules;
create policy modules_own_all on public.modules for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists course_sessions_own_all on public.course_sessions;
create policy course_sessions_own_all on public.course_sessions for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists transcript_sessions_own_all on public.transcript_sessions;
create policy transcript_sessions_own_all on public.transcript_sessions for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists transcript_segments_own_all on public.transcript_segments;
create policy transcript_segments_own_all on public.transcript_segments for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists timeline_markers_own_all on public.timeline_markers;
create policy timeline_markers_own_all on public.timeline_markers for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists note_anchors_own_all on public.note_anchors;
create policy note_anchors_own_all on public.note_anchors for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists capture_interruptions_own_all on public.capture_interruptions;
create policy capture_interruptions_own_all on public.capture_interruptions for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists sync_metadata_own_all on public.sync_metadata;
create policy sync_metadata_own_all on public.sync_metadata for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create index if not exists modules_user_subject_idx on public.modules(user_id, subject_id);
create index if not exists course_sessions_user_subject_idx on public.course_sessions(user_id, subject_id);
create index if not exists course_sessions_user_module_idx on public.course_sessions(user_id, module_id);
create index if not exists transcript_sessions_user_course_idx on public.transcript_sessions(user_id, course_session_id);
create index if not exists transcript_segments_user_idx on public.transcript_segments(user_id);
create index if not exists transcript_segments_transcript_idx on public.transcript_segments(transcript_session_id);
create index if not exists transcript_segments_user_transcript_idx on public.transcript_segments(user_id, transcript_session_id);
create index if not exists transcript_segments_user_course_idx on public.transcript_segments(user_id, course_session_id);
create index if not exists timeline_markers_user_idx on public.timeline_markers(user_id);
create index if not exists timeline_markers_user_course_idx on public.timeline_markers(user_id, course_session_id);
create index if not exists note_anchors_user_idx on public.note_anchors(user_id);
create index if not exists note_anchors_user_course_idx on public.note_anchors(user_id, course_session_id);
create index if not exists capture_interruptions_user_idx on public.capture_interruptions(user_id);
create index if not exists capture_interruptions_user_course_idx on public.capture_interruptions(user_id, course_session_id);
