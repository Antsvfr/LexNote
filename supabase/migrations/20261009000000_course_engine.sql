-- LexNote — Intelligent Course Engine : documents importés (métadonnées + texte ANALYSÉ) et cours reconstruits (versionnés).
-- Le fichier ORIGINAL d'un document n'est jamais envoyé : il reste sur l'appareil (aucun bucket Storage).
-- Mêmes garanties que le reste : user_id = auth.uid(), RLS forcée, anon sans droit, clés étrangères composites.

create table public.source_documents (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  name text not null check (char_length(name) between 1 and 400),
  mime text not null default '',
  format text not null default 'other' check (format in ('pdf','pptx','docx','text','image','other')),
  size bigint not null default 0,
  status text not null default 'pending' check (status in ('pending','processing','ready','error','unsupported')),
  error text,
  unit_label text not null default 'page' check (unit_label in ('page','slide','section')),
  unit_count integer,
  word_count integer not null default 0,
  extractor_id text,
  extraction jsonb,
  file_hash text not null default '',
  added_at timestamptz not null default now(),
  analyzed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (session_id, user_id) references public.course_sessions (id, user_id)
);
create index source_documents_user_cursor on public.source_documents (user_id, server_updated_at);

create table public.generated_courses (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid not null,
  course_version integer not null check (course_version >= 1),
  generated_at timestamptz not null,
  engine_version text not null default '',
  provider_id text not null default '',
  provider_label text not null default '',
  source_snapshot jsonb not null,
  content jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (session_id, user_id) references public.course_sessions (id, user_id)
);
create index generated_courses_user_cursor on public.generated_courses (user_id, server_updated_at);

do $$
declare t text;
begin
  foreach t in array array['source_documents','generated_courses']
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.lx_touch()', t || '_touch', t);
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
