import { stripConflictSuffix, type ConflictChoice } from '@/domain/conflict';
import type { CourseSession } from '@/domain/types';

/** Ce dont la résolution a besoin : le magasin de notes (injecté pour pouvoir tester sans interface). */
export interface ConflictStore {
  loadNotes(id: string): Promise<unknown | undefined>;
  saveNotes(id: string, input: { content: unknown; plainText: string }): Promise<void>;
  deleteSession(id: string): Promise<void>;
  updateSession(id: string, patch: { title?: string; conflictOf?: undefined }): Promise<void>;
}

/**
 * Résout un conflit de notes. `copy` = la séance affichée (copie locale en conflit), `original` = celle qui porte la version du serveur.
 * Ordre des opérations choisi pour qu'une interruption ne perde jamais de contenu : on ÉCRIT d'abord, on ne SUPPRIME qu'ensuite.
 * Renvoie l'identifiant de la séance à ouvrir ensuite.
 */
export async function resolveConflict(choice: ConflictChoice, copy: CourseSession, original: CourseSession, store: ConflictStore): Promise<string> {
  if (choice === 'keep-this') {
    const content = await store.loadNotes(copy.id);
    if (content === undefined) throw new Error('notes de la copie introuvables');
    await store.saveNotes(original.id, { content, plainText: copy.searchText });     // 1. la version choisie remplace l'autre…
    await store.deleteSession(copy.id);                                               // 2. …puis seulement la copie disparaît
    return original.id;
  }
  if (choice === 'keep-other') {
    await store.deleteSession(copy.id);
    return original.id;
  }
  // keep-both : la copie devient une séance ordinaire, clairement nommée ; rien n'est supprimé.
  await store.updateSession(copy.id, { title: `${stripConflictSuffix(copy.title) || 'Séance'} (copie)`, conflictOf: undefined });
  return copy.id;
}
