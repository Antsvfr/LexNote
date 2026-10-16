import type { CourseSession } from './types';

/** Suffixe ajouté au titre de la copie locale quand la synchronisation garde les deux versions d'une note. */
export const CONFLICT_SUFFIX = '(version locale en conflit)';

/**
 * Si `session` est la copie créée par un conflit de synchronisation, renvoie la séance d'origine (qui porte maintenant la version
 * du serveur). Reconnaît le marqueur `conflictOf` ET, pour une copie arrivée d'un autre appareil (champ non synchronisé), le suffixe du titre.
 */
export function findConflictOriginal(session: CourseSession, all: readonly CourseSession[]): CourseSession | null {
  if (session.conflictOf) return all.find((s) => s.id === session.conflictOf) ?? null;
  if (!session.title.endsWith(CONFLICT_SUFFIX)) return null;
  const base = session.title.slice(0, -CONFLICT_SUFFIX.length).trim();
  return all.find((s) => s.id !== session.id && s.subjectId === session.subjectId && s.type === session.type && (s.title || 'Séance') === (base || 'Séance') && !s.title.endsWith(CONFLICT_SUFFIX)) ?? null;
}
export const isConflictCopy = (session: CourseSession) => !!session.conflictOf || session.title.endsWith(CONFLICT_SUFFIX);
export const stripConflictSuffix = (title: string) => (title.endsWith(CONFLICT_SUFFIX) ? title.slice(0, -CONFLICT_SUFFIX.length).trim() : title);

export type ConflictChoice = 'keep-this' | 'keep-other' | 'keep-both';
