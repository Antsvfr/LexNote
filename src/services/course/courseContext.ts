/**
 * CourseContext — la matière première du futur moteur IA, assemblée au même endroit.
 *
 * Les trois sources restent SÉPARÉES et étiquetées par provenance : l'IA saura toujours ce qui vient
 * des notes de l'étudiant, de ce que le moteur a entendu, ou du support du professeur.
 * Rien ici n'appelle d'IA ; c'est une interface de lecture.
 */
import type {
  AudioSession, Interruption, NoteAnchor, TimelineMarker, TranscriptSegment,
} from '@/domain/capture';
import { segmentsWordCount } from '@/domain/capture';
import type { SourceDocument } from '@/domain/documents';
import type { Provenance } from '@/domain/legal';
import type { CourseSession } from '@/domain/types';
import { docToPlainText } from '@/lib/docText';
import { countWords } from '@/lib/text';
import type { CaptureStorage } from '@/services/capture/storage/types';
import { noDocuments, type DocumentSource } from '@/services/documents';

export interface SourceInfo {
  provenance: Provenance;
  available: boolean;
  wordCount: number;
}

export interface CourseContext {
  session: CourseSession;
  notes: { content: unknown; plainText: string; wordCount: number };
  transcript: { segments: TranscriptSegment[]; wordCount: number };
  markers: TimelineMarker[];
  noteAnchors: NoteAnchor[];
  interruptions: Interruption[];
  audio: AudioSession | null;
  /** Vide pour l'instant (import de documents non implémenté). */
  documents: SourceDocument[];
  /** Les trois sources, séparées. */
  sources: { notes: SourceInfo; transcript: SourceInfo; documents: SourceInfo };
}

export interface CourseContextDeps {
  getSession(id: string): CourseSession | undefined;
  loadNotes(id: string): Promise<unknown | undefined>;
  capture: CaptureStorage;
  documents?: DocumentSource;
}

export async function buildCourseContext(sessionId: string, deps: CourseContextDeps): Promise<CourseContext> {
  const session = deps.getSession(sessionId);
  if (!session) throw new Error(`CM introuvable : ${sessionId}`);
  const [content, segments, markers, noteAnchors, interruptions, audio, documents] = await Promise.all([
    deps.loadNotes(sessionId),
    deps.capture.listSegments(sessionId),
    deps.capture.listMarkers(sessionId),
    deps.capture.listAnchors(sessionId),
    deps.capture.listInterruptions(sessionId),
    deps.capture.getAudioSession(sessionId),
    (deps.documents ?? noDocuments).list(sessionId),
  ]);
  const plainText = content ? docToPlainText(content) : '';
  const notesWords = countWords(plainText);
  const tWords = segmentsWordCount(segments);
  return {
    session,
    notes: { content: content ?? null, plainText, wordCount: notesWords },
    transcript: { segments, wordCount: tWords },
    markers, noteAnchors, interruptions, audio: audio ?? null, documents,
    sources: {
      notes: { provenance: 'USER_NOTE', available: notesWords > 0, wordCount: notesWords },
      transcript: { provenance: 'TRANSCRIPTION', available: segments.length > 0, wordCount: tWords },
      documents: { provenance: 'DOCUMENT', available: documents.length > 0, wordCount: 0 },
    },
  };
}
