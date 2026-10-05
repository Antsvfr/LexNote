import type { LibrarySnapshot } from './types';
import type { ChangeSet } from '@/services/storage/types';

/**
 * Calcule la suppression des données de démonstration, sans connaître leur contenu.
 *
 *  - toutes les séances `isDemo` sont supprimées (une séance modifiée par l'étudiant
 *    perd son drapeau `isDemo` et est donc conservée) ;
 *  - un module/une matière de démo est supprimé(e) seulement s'il/elle est devenu(e) vide ;
 *  - sinon il/elle est conservé(e) et "adopté(e)" (drapeau retiré).
 */
export function computeDemoRemoval(lib: LibrarySnapshot): ChangeSet {
  const deleteSessions = lib.sessions.filter((s) => s.isDemo).map((s) => s.id);
  const gone = new Set(deleteSessions);
  const remaining = lib.sessions.filter((s) => !gone.has(s.id));

  const deleteModules: string[] = [];
  const putModules = [];
  for (const m of lib.modules.filter((m) => m.isDemo)) {
    if (remaining.some((s) => s.moduleId === m.id)) putModules.push({ ...m, isDemo: undefined });
    else deleteModules.push(m.id);
  }
  const goneModules = new Set(deleteModules);
  const remainingModules = lib.modules.filter((m) => !goneModules.has(m.id));

  const deleteSubjects: string[] = [];
  const putSubjects = [];
  for (const s of lib.subjects.filter((s) => s.isDemo)) {
    if (remainingModules.some((m) => m.subjectId === s.id)) putSubjects.push({ ...s, isDemo: undefined });
    else deleteSubjects.push(s.id);
  }
  return { deleteSessions, deleteModules, deleteSubjects, putModules, putSubjects };
}

export function hasDemoData(lib: LibrarySnapshot): boolean {
  return lib.subjects.some((s) => s.isDemo) || lib.modules.some((m) => m.isDemo) || lib.sessions.some((s) => s.isDemo);
}
