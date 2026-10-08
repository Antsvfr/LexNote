/**
 * Seul fichier du module d'intégration qui connaît les types INTERNES de LexNote. Il convertit explicitement (liste blanche de champs)
 * vers les contrats publics : un nouveau champ interne n'est JAMAIS exposé par accident, et aucun contenu de cours ne sort.
 */
import type { CourseSession } from '@/domain/types';
import type { StudyArtifact } from '@/domain/study';
import type { GeneratedCourse } from '@/domain/course';
import type { LexNoteSessionReference, StudyArtifactReference } from './contracts';
import { buildLexNoteLink } from './links';
import { INTEGRATION_VERSION } from './version';

export interface SessionRefContext {
  origin: string;
  subject: { id: string; name: string; color?: string };
  /** Évènement REV-EM lié par l'étudiant (si lié). */
  linkedExternalId?: string | null;
  hasNotes: boolean;
  hasTranscript: boolean;
  sourceCount: number;
  latestCourse: Pick<GeneratedCourse, 'courseVersion' | 'generatedAt'> | null;
  artifactCount: number;
}

export function toSessionReference(s: CourseSession, c: SessionRefContext): LexNoteSessionReference {
  return {
    integrationVersion: INTEGRATION_VERSION, kind: 'lexnote-session-reference',
    sessionRef: s.id, linkedExternalId: c.linkedExternalId ?? null,
    title: s.title || 'Séance', sessionType: s.type, number: s.number, date: s.date,
    ...(s.startTime ? { startTime: s.startTime } : {}), ...(s.endTime ? { endTime: s.endTime } : {}),
    status: s.status,
    subject: { app: 'lexnote', ref: c.subject.id, name: c.subject.name, ...(c.subject.color ? { color: c.subject.color } : {}) },
    flags: { hasNotes: c.hasNotes, hasTranscript: c.hasTranscript, sourceCount: c.sourceCount },
    course: { latestVersion: c.latestCourse?.courseVersion ?? null, generatedAt: c.latestCourse?.generatedAt ?? null },
    artifactCount: c.artifactCount, updatedAt: s.updatedAt,
    links: { session: buildLexNoteLink(c.origin, { kind: 'session', ref: s.id }), course: buildLexNoteLink(c.origin, { kind: 'course', ref: s.id }), review: buildLexNoteLink(c.origin, { kind: 'review', ref: s.id }) },
  };
}

/** Nombre d'éléments d'un support (compteur public) — jamais leur contenu. */
export function itemCountOf(a: Pick<StudyArtifact, 'type' | 'content'>): number {
  const c = a.content as unknown as Record<string, any>;
  const nodes = (n: { children?: unknown[] }): number => 1 + (n.children ?? []).reduce<number>((t, k) => t + nodes(k as { children?: unknown[] }), 0);
  switch (a.type) {
    case 'COURSE_SHEET': return (c.sections ?? []).reduce((t: number, s: { items: unknown[] }) => t + s.items.length, 0);
    case 'MIND_MAP': return c.root ? nodes(c.root) : 0;
    case 'DIAGRAM': return (c.nodes ?? []).length;
    case 'COMPARISON_TABLE': return (c.rows ?? []).length;
    case 'TIMELINE': return (c.events ?? []).length;
    case 'METHOD': return (c.steps ?? []).length;
    case 'FLASHCARDS': return (c.cards ?? []).length;
    case 'QUIZ': return (c.questions ?? []).length;
  }
}

export function toArtifactReference(a: StudyArtifact, c: { origin: string; stale: boolean }): StudyArtifactReference {
  return {
    integrationVersion: INTEGRATION_VERSION, kind: 'study-artifact-reference',
    artifactRef: a.id, artifactType: a.type, title: a.title, sessionRef: a.sourceSessionIds[0] ?? '',
    courseVersion: a.courseVersion, generation: a.generation, userEdited: a.userEdited, stale: c.stale,
    itemCount: itemCountOf(a), createdAt: a.createdAt, updatedAt: a.updatedAt,
    link: buildLexNoteLink(c.origin, { kind: 'artifact', ref: a.id }),
  };
}
