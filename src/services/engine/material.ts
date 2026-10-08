import type { StorageAdapter } from '@/services/storage/types';
import type { CaptureStorage } from '@/services/capture/storage/types';
import type { CourseSession } from '@/domain/types';
import { buildOutline } from '@/services/study/outline';
import type { CourseMaterial } from './chunking';

/** Rassemble LES SOURCES d'une séance, en lecture seule : notes, transcription, marqueurs, ancrages, documents prêts. */
export async function loadMaterial(session: CourseSession, deps: { adapter: StorageAdapter; capture: CaptureStorage | null; loadNotes?: (id: string) => Promise<unknown> }): Promise<CourseMaterial> {
  const notes = (await (deps.loadNotes ? deps.loadNotes(session.id) : deps.adapter.getNotes(session.id).then((n) => n?.content)));
  const [segments, markers, anchors, documents] = await Promise.all([
    deps.capture?.listSegments(session.id) ?? [], deps.capture?.listMarkers(session.id) ?? [], deps.capture?.listAnchors(session.id) ?? [],
    deps.adapter.loadDocuments().then((l) => l.filter((d) => d.sessionId === session.id && d.status === 'ready')),
  ]);
  const title = session.title || 'Cours';
  return { sessionId: session.id, sessionTitle: title, outline: buildOutline(session.id, title, notes), segments, markers, anchors, documents };
}
