-- LexNote — StudyArtifacts dérivés du COURS RECONSTRUIT (et non plus des notes seules).
-- Un artefact référence la version précise du cours dont il vient, avec l'instantané des sources et sa provenance.

alter table public.study_artifacts rename column options to settings;
alter table public.study_artifacts rename column ai_content to generated_content;
alter table public.study_artifacts drop column if exists source_hash;
alter table public.study_artifacts drop column if exists generated_by;

alter table public.study_artifacts
  add column course_id uuid,                                   -- cours reconstruit source (sans FK : supprimer un cours ne supprime pas vos supports)
  add column course_version integer not null default 1,
  add column source_snapshot jsonb not null default '{}'::jsonb,
  add column engine_version text not null default '',
  add column provenance jsonb not null default '{}'::jsonb,
  add column generation integer not null default 1 check (generation >= 1);

alter table public.study_artifacts drop constraint if exists study_artifacts_type_check;
alter table public.study_artifacts add constraint study_artifacts_type_check
  check (type in ('COURSE_SHEET','MIND_MAP','DIAGRAM','COMPARISON_TABLE','TIMELINE','METHOD','FLASHCARDS','QUIZ'));
