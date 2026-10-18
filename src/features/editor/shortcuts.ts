import type { NoteBlockKind } from '@/domain/legal';

/** Touche (avec Mod+Alt) de chaque bloc de notes. Fichier léger : importable sans charger l'éditeur. */
export const BLOCK_SHORTCUT_KEYS: Record<NoteBlockKind, string> = {
  article: 'A', caselaw: 'J', definition: 'D', important: 'I', example: 'E', question: 'Q',
};
