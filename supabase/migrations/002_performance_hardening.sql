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
