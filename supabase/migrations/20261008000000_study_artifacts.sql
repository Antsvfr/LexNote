-- LexNote — supports d'étude (fiches, cartes mentales, schémas, tableaux, flashcards, quiz, chronologies).
-- Un SEUL modèle pour tous les types : `type` + `content` (jsonb validé côté application par un schéma strict).
-- Même règles de sécurité que le reste : RLS forcée, user_id = auth.uid(), anon sans aucun droit.

create table public.study_artifacts (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null check (type in ('COURSE_SHEET','MIND_MAP','DIAGRAM','COMPARISON_TABLE','TIMELINE','FLASHCARDS','QUIZ')),
  title text not null check (char_length(title) between 1 and 300),
  subject_id uuid,
  source_session_ids jsonb not null default '[]'::jsonb,
  scope jsonb,
  options jsonb not null default '{}'::jsonb,
  content jsonb not null,
  ai_content jsonb,
  source_hash text not null default '',
  user_edited boolean not null default false,
  generated_by jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (subject_id, user_id) references public.subjects (id, user_id)
);

create index study_artifacts_user_cursor on public.study_artifacts (user_id, server_updated_at);

create trigger study_artifacts_touch before insert or update on public.study_artifacts
  for each row execute function public.lx_touch();

alter table public.study_artifacts enable row level security;
alter table public.study_artifacts force row level security;
create policy study_artifacts_select on public.study_artifacts for select to authenticated using (user_id = (select auth.uid()));
create policy study_artifacts_insert on public.study_artifacts for insert to authenticated with check (user_id = (select auth.uid()));
create policy study_artifacts_update on public.study_artifacts for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy study_artifacts_delete on public.study_artifacts for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.study_artifacts from anon;
grant select, insert, update, delete on public.study_artifacts to authenticated;
