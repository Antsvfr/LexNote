import type { AudioSession, Interruption, NoteAnchor, TimelineMarker, TranscriptSegment } from '@/domain/capture';
import type { CourseSession, Module, Subject } from '@/domain/types';
import type { GeneratedCourse, SourceDocument } from '@/domain/course';
import { ARTIFACT_TYPES, type ArtifactContent, type StudyArtifact } from '@/domain/study';
import { isSessionType } from '@/domain/sessionType';
import type { RemoteRow } from './types';

const orUndef = <T>(v: T | null | undefined): T | undefined => (v === null || v === undefined || v === '' ? undefined : v);
const hhmm = (v: unknown): string | undefined => (typeof v === 'string' && v ? v.slice(0, 5) : undefined);

/* ---------------- subjects ---------------- */
export const subjectToRow = (s: Subject): RemoteRow => ({
  id: s.id, user_id: s.userId, name: s.name, color: s.color, icon: s.icon ?? null, term: s.term ?? null, teacher: s.teacher ?? null,
  description: s.description ?? null, created_at: s.createdAt, updated_at: s.updatedAt, deleted_at: null,
});
export const subjectFromRow = (r: RemoteRow): Subject => ({
  id: r.id, userId: String(r.user_id), name: String(r.name), color: String(r.color ?? 'indigo'), icon: orUndef(r.icon as string),
  term: orUndef(r.term as string), teacher: orUndef(r.teacher as string), description: orUndef(r.description as string),
  createdAt: String(r.created_at), updatedAt: String(r.updated_at), version: r.version,
});

/* ---------------- modules ---------------- */
export const moduleToRow = (m: Module): RemoteRow => ({
  id: m.id, user_id: m.userId, subject_id: m.subjectId, name: m.name, created_at: m.createdAt, updated_at: m.updatedAt, deleted_at: null,
});
export const moduleFromRow = (r: RemoteRow): Module => ({
  id: r.id, userId: String(r.user_id), subjectId: String(r.subject_id), name: String(r.name),
  createdAt: String(r.created_at), updatedAt: String(r.updated_at), version: r.version,
});

/* ---------------- course_sessions ---------------- */
export const sessionToRow = (s: CourseSession, notes: unknown): RemoteRow => ({
  id: s.id, user_id: s.userId, subject_id: s.subjectId, module_id: s.moduleId, type: s.type, number: s.number, title: s.title, date: s.date,
  start_time: s.startTime ?? null, end_time: s.endTime ?? null, teacher: s.teacher ?? null, room: s.room ?? null, status: s.status,
  duration_sec: s.durationSec, word_count: s.wordCount, excerpt: s.excerpt, search_text: s.searchText, thumbnail: s.thumbnail ?? null,
  notes_content: notes ?? null, completed_at: s.completedAt, capture_summary: s.captureSummary ?? null,
  created_at: s.createdAt, updated_at: s.updatedAt, deleted_at: null,
});
export function sessionFromRow(r: RemoteRow): { session: CourseSession; notes: unknown } {
  const type = isSessionType(r.type) ? r.type : 'OTHER';
  return {
    notes: r.notes_content ?? undefined,
    session: {
      id: r.id, userId: String(r.user_id), subjectId: String(r.subject_id), moduleId: (r.module_id as string | null) ?? null, type,
      number: (r.number as number | null) ?? null, title: String(r.title ?? ''), date: String(r.date).slice(0, 10),
      startTime: hhmm(r.start_time), endTime: hhmm(r.end_time), teacher: orUndef(r.teacher as string), room: orUndef(r.room as string),
      status: r.status === 'completed' ? 'completed' : 'in_progress', completedAt: (r.completed_at as string | null) ?? null,
      durationSec: Number(r.duration_sec ?? 0), wordCount: Number(r.word_count ?? 0), excerpt: String(r.excerpt ?? ''),
      searchText: String(r.search_text ?? ''), thumbnail: orUndef(r.thumbnail as CourseSession['thumbnail']),
      captureSummary: (r.capture_summary as CourseSession['captureSummary']) ?? null,
      createdAt: String(r.created_at), updatedAt: String(r.updated_at), version: r.version,
      transcript: null, audio: null, documents: [], aiOutputs: {}, legalItems: [], flashcards: [], questions: [], aiMeta: null,
    },
  };
}

/* ---------------- capture ---------------- */
export const audioSessionToRow = (a: AudioSession, userId: string): RemoteRow => ({
  id: a.id, user_id: userId, session_id: a.sessionId, origin_at: new Date(a.originAt).toISOString(), mime_type: a.mimeType || null,
  provider_id: a.providerId, keep_audio: a.keepAudio, runs: a.runs, status: a.status, created_at: a.createdAt, updated_at: a.updatedAt, deleted_at: null,
});
export const audioSessionFromRow = (r: RemoteRow): AudioSession => ({
  id: r.id, userId: String(r.user_id), sessionId: String(r.session_id), originAt: new Date(String(r.origin_at)).getTime(),
  mimeType: String(r.mime_type ?? ''), bitsPerSecond: 32000, chunkMs: 30000, keepAudio: r.keep_audio !== false,
  providerId: (r.provider_id as string | null) ?? null, runs: (r.runs as AudioSession['runs']) ?? [],
  // Sur un autre appareil il n'y a pas d'audio local : la séance est consultable, la reprise crée un nouveau run.
  status: (r.status as AudioSession['status']) === 'COMPLETED' ? 'COMPLETED' : 'PAUSED',
  createdAt: String(r.created_at), updatedAt: String(r.updated_at),
});

export const segmentToRow = (s: TranscriptSegment, userId: string): RemoteRow => ({
  id: s.id, user_id: userId, session_id: s.sessionId, start_ms: s.startMs, end_ms: s.endMs, text: s.text, confidence: s.confidence ?? null,
  provider: s.provider, status: s.status, source: s.source, verification: s.verification, created_at: s.createdAt, updated_at: s.createdAt, deleted_at: null,
});
export const segmentFromRow = (r: RemoteRow): TranscriptSegment => ({
  id: r.id, userId: String(r.user_id), sessionId: String(r.session_id), startMs: Number(r.start_ms), endMs: Number(r.end_ms), text: String(r.text),
  confidence: (r.confidence as number | null) ?? undefined, provider: String(r.provider), status: r.status === 'edited' ? 'edited' : 'final',
  source: 'TRANSCRIPTION', verification: 'UNVERIFIED', createdAt: String(r.created_at),
});

export const markerToRow = (m: TimelineMarker, userId: string): RemoteRow => ({
  id: m.id, user_id: userId, session_id: m.sessionId, at_ms: m.atMs, reasons: m.reasons, note: m.note ?? null, created_at: m.createdAt, updated_at: new Date().toISOString(), deleted_at: null,
});
export const markerFromRow = (r: RemoteRow): TimelineMarker => ({
  id: r.id, userId: String(r.user_id), sessionId: String(r.session_id), atMs: Number(r.at_ms), reasons: ((r.reasons as string[]) ?? []) as TimelineMarker['reasons'],
  note: orUndef(r.note as string), createdAt: String(r.created_at),
});

export const anchorToRow = (a: NoteAnchor, userId: string): RemoteRow => ({
  id: a.id, user_id: userId, session_id: a.sessionId, timestamp_ms: a.timestamp, note_position: a.notePosition, text_snippet: a.textSnippet,
  nearby_segment_ids: a.nearbyTranscriptSegmentIds, created_at: a.createdAt, updated_at: new Date().toISOString(), deleted_at: null,
});
export const anchorFromRow = (r: RemoteRow): NoteAnchor => ({
  id: r.id, userId: String(r.user_id), sessionId: String(r.session_id), timestamp: Number(r.timestamp_ms), notePosition: Number(r.note_position),
  textSnippet: String(r.text_snippet ?? ''), nearbyTranscriptSegmentIds: (r.nearby_segment_ids as string[]) ?? [], createdAt: String(r.created_at),
});

export const interruptionToRow = (i: Interruption, userId: string): RemoteRow => ({
  id: i.id, user_id: userId, session_id: i.sessionId, at_ms: i.atMs, kind: i.kind, message: i.message, recoverable: i.recoverable,
  resolved_at_ms: i.resolvedAtMs ?? null, updated_at: new Date().toISOString(), deleted_at: null,
});
export const interruptionFromRow = (r: RemoteRow): Interruption => ({
  id: r.id, userId: String(r.user_id), sessionId: String(r.session_id), atMs: Number(r.at_ms), kind: r.kind as Interruption['kind'],
  message: String(r.message), recoverable: r.recoverable !== false, resolvedAtMs: (r.resolved_at_ms as number | null) ?? undefined,
});

/* ---------------- study_artifacts ---------------- */
export const artifactToRow = (a: StudyArtifact): RemoteRow => ({
  id: a.id, user_id: a.userId, type: a.type, title: a.title, subject_id: a.subjectId, source_session_ids: a.sourceSessionIds, scope: a.scope,
  settings: a.settings, content: a.content, generated_content: a.generatedContent, user_edited: a.userEdited,
  course_id: a.courseId, course_version: a.courseVersion, source_snapshot: a.sourceSnapshot, engine_version: a.engineVersion, provenance: a.provenance, generation: a.generation,
  created_at: a.createdAt, updated_at: a.updatedAt, deleted_at: null,
});
export const artifactFromRow = (r: RemoteRow): StudyArtifact => ({
  id: r.id, userId: String(r.user_id), type: (ARTIFACT_TYPES as readonly string[]).includes(String(r.type)) ? (r.type as StudyArtifact['type']) : 'COURSE_SHEET',
  title: String(r.title), subjectId: (r.subject_id as string | null) ?? null, sourceSessionIds: (r.source_session_ids as string[]) ?? [],
  scope: (r.scope as StudyArtifact['scope']) ?? null, settings: (r.settings as StudyArtifact['settings']) ?? {},
  content: r.content as ArtifactContent, generatedContent: (r.generated_content as ArtifactContent | null) ?? null, userEdited: !!r.user_edited,
  courseId: String(r.course_id ?? ''), courseVersion: Number(r.course_version ?? 1), sourceSnapshot: (r.source_snapshot as StudyArtifact['sourceSnapshot']) ?? { sources: [], hash: '' },
  engineVersion: String(r.engine_version ?? ''), provenance: r.provenance as StudyArtifact['provenance'], generation: Number(r.generation ?? 1),
  createdAt: String(r.created_at), updatedAt: String(r.updated_at), version: r.version,
});

/* ---------------- source_documents (le fichier original n'est JAMAIS envoyé : seulement les métadonnées et le texte analysé) ---------------- */
export const documentToRow = (d: SourceDocument): RemoteRow => ({
  id: d.id, user_id: d.userId, session_id: d.sessionId, name: d.name, mime: d.mime, format: d.format, size: d.size, status: d.status, error: d.error ?? null,
  unit_label: d.unitLabel, unit_count: d.count ?? null, word_count: d.wordCount, extractor_id: d.extractorId ?? null, extraction: d.extraction, file_hash: d.fileHash,
  added_at: d.addedAt, analyzed_at: d.analyzedAt ?? null, created_at: d.createdAt, updated_at: d.updatedAt, deleted_at: null,
});
export const documentFromRow = (r: RemoteRow): SourceDocument => ({
  id: r.id, userId: String(r.user_id), sessionId: String(r.session_id), name: String(r.name), mime: String(r.mime ?? ''), format: (r.format as SourceDocument['format']) ?? 'other',
  size: Number(r.size ?? 0), status: (r.status as SourceDocument['status']) ?? 'ready', error: orUndef(r.error as string), unitLabel: (r.unit_label as SourceDocument['unitLabel']) ?? 'page',
  count: (r.unit_count as number | null) ?? undefined, wordCount: Number(r.word_count ?? 0), extractorId: orUndef(r.extractor_id as string),
  extraction: (r.extraction as SourceDocument['extraction']) ?? null, fileHash: String(r.file_hash ?? ''), addedAt: String(r.added_at), analyzedAt: orUndef(r.analyzed_at as string),
  createdAt: String(r.created_at), updatedAt: String(r.updated_at), version: r.version,
});

/* ---------------- generated_courses ---------------- */
export const courseToRow = (c: GeneratedCourse): RemoteRow => ({
  id: c.id, user_id: c.userId, session_id: c.sessionId, course_version: c.courseVersion, generated_at: c.generatedAt, engine_version: c.engineVersion,
  provider_id: c.providerId, provider_label: c.providerLabel, source_snapshot: c.sourceSnapshot, content: c.content,
  created_at: c.createdAt, updated_at: c.updatedAt, deleted_at: null,
});
export const courseFromRow = (r: RemoteRow): GeneratedCourse => ({
  id: r.id, userId: String(r.user_id), sessionId: String(r.session_id), courseVersion: Number(r.course_version ?? 1), generatedAt: String(r.generated_at),
  engineVersion: String(r.engine_version ?? ''), providerId: String(r.provider_id ?? ''), providerLabel: String(r.provider_label ?? ''),
  sourceSnapshot: r.source_snapshot as GeneratedCourse['sourceSnapshot'], content: r.content as GeneratedCourse['content'],
  createdAt: String(r.created_at), updatedAt: String(r.updated_at), version: r.version,
});
