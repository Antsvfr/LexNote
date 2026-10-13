-- LexNote — documents DÉRIVÉS de la transcription (résumé, traduction, transcription nettoyée, cours structuré, points clés,
-- glossaire, questions d'examen, notes d'étude) + profil d'études facultatif.
--
-- Rétrocompatible : uniquement des AJOUTS (colonnes nullables ou avec valeur par défaut, contrainte de type élargie).
-- Aucune donnée existante n'est modifiée ; les supports du cours reconstruit gardent exactement leur forme
-- (source_type = 'reconstructed-course' par défaut). La RLS existante de study_artifacts et profiles s'applique telle quelle.

-- ---------------------------------------------------------------------------------------------------------------------------
-- study_artifacts : un SEUL modèle pour tous les supports (pas de table parallèle)
-- ---------------------------------------------------------------------------------------------------------------------------
alter table public.study_artifacts drop constraint if exists study_artifacts_type_check;
alter table public.study_artifacts add constraint study_artifacts_type_check
  check (type in (
    'COURSE_SHEET','MIND_MAP','DIAGRAM','COMPARISON_TABLE','TIMELINE','METHOD','FLASHCARDS','QUIZ',
    'SUMMARY','TRANSLATION','CLEAN_TRANSCRIPT','STRUCTURED_NOTES','KEY_POINTS','GLOSSARY','EXAM_QUESTIONS','STUDY_NOTE'
  ));

alter table public.study_artifacts
  -- d'où vient le contenu : le cours reconstruit (supports structurés) ou la transcription (documents dérivés)
  add column if not exists source_type text not null default 'reconstructed-course'
    check (source_type in ('reconstructed-course', 'transcript')),
  -- séance source (sans clé étrangère, comme course_id : supprimer une séance ne supprime pas vos supports)
  add column if not exists source_session_id uuid,
  -- empreinte de la transcription au moment de la génération
  add column if not exists source_transcript_version text check (source_transcript_version is null or char_length(source_transcript_version) <= 128),
  -- langue du contenu (code court : fr, en, es, de, it…)
  add column if not exists language text check (language is null or char_length(language) between 2 and 12),
  -- action qui a produit le contenu : summary, translate, clean, structure, key-points…
  add column if not exists generation_type text check (generation_type is null or char_length(generation_type) <= 64),
  -- moteur : { providerId, model, local } — jamais de clé ni de secret
  add column if not exists generator jsonb,
  -- support dont celui-ci dérive (ex. traduction d'un résumé)
  add column if not exists parent_artifact_id uuid,
  -- versions antérieures conservées à chaque régénération (bornées côté application à 10)
  add column if not exists revisions jsonb not null default '[]'::jsonb check (jsonb_typeof(revisions) = 'array');

-- Cohérence : un document dérivé de la transcription porte toujours sa séance source.
alter table public.study_artifacts drop constraint if exists study_artifacts_transcript_source_check;
alter table public.study_artifacts add constraint study_artifacts_transcript_source_check
  check (source_type <> 'transcript' or source_session_id is not null);

-- Lister les documents d'une séance (récapitulatif) sans parcourir tous les supports de l'utilisateur.
create index if not exists study_artifacts_user_source_session on public.study_artifacts (user_id, source_session_id)
  where source_session_id is not null;

-- ---------------------------------------------------------------------------------------------------------------------------
-- profiles : domaine d'études et usage principal, FACULTATIFS — ne bloquent jamais une fonctionnalité
-- ---------------------------------------------------------------------------------------------------------------------------
alter table public.profiles
  add column if not exists field_of_study text check (field_of_study is null or char_length(field_of_study) <= 80),
  add column if not exists primary_use text check (primary_use is null or char_length(primary_use) <= 80);
