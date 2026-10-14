-- LexNote — index sur les clés étrangères (recommandation « unindexed_foreign_keys » du Performance Advisor).
--
-- Repris de l'idée de la PR #5 (supersédée : migration « performance hardening »), réécrit pour le schéma OFFICIEL (colonnes `session_id`, clés composites
-- `(session_id, user_id)`). Sans index sur la colonne référençante, supprimer ou mettre à jour une ligne parente (séance, matière, compte) force un balayage
-- complet de chaque table enfant. Toutes les créations sont idempotentes (`if not exists`).

-- Clés vers auth.users (suppression en cascade d'un compte)
create index if not exists subjects_user_idx on public.subjects (user_id);
create index if not exists modules_user_idx on public.modules (user_id);
create index if not exists transcript_sessions_user_idx on public.transcript_sessions (user_id);
create index if not exists timeline_markers_user_idx on public.timeline_markers (user_id);
create index if not exists note_anchors_user_idx on public.note_anchors (user_id);
create index if not exists capture_interruptions_user_idx on public.capture_interruptions (user_id);

-- Clés composites vers la matière / le module / la séance
create index if not exists modules_subject_idx on public.modules (subject_id, user_id);
create index if not exists course_sessions_subject_idx on public.course_sessions (subject_id, user_id);
create index if not exists course_sessions_module_idx on public.course_sessions (module_id, user_id);
create index if not exists transcript_sessions_session_idx on public.transcript_sessions (session_id, user_id);
create index if not exists transcript_segments_session_fk_idx on public.transcript_segments (session_id, user_id);
create index if not exists timeline_markers_session_idx on public.timeline_markers (session_id, user_id);
create index if not exists note_anchors_session_idx on public.note_anchors (session_id, user_id);
create index if not exists capture_interruptions_session_idx on public.capture_interruptions (session_id, user_id);
create index if not exists source_documents_session_idx on public.source_documents (session_id, user_id);
create index if not exists generated_courses_session_idx on public.generated_courses (session_id, user_id);
create index if not exists study_artifacts_subject_idx on public.study_artifacts (subject_id, user_id);
