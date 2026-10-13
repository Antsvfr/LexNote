/**
 * Catalogue des actions « Exploiter la transcription ».
 *
 * Trois natures, jamais confondues dans l'interface :
 *  - 'ai'      : document produit par le moteur IA (serveur) à partir du TEXTE de la transcription. Sans moteur configuré :
 *                « Fonction IA non configurée » — aucune réponse simulée.
 *  - 'local'   : transformation déterministe sur l'appareil (nettoyage léger) — toujours disponible, hors ligne compris.
 *  - 'support' : support structuré produit par le moteur LOCAL existant à partir du cours reconstruit (fiche, flashcards, quiz,
 *                tableau comparatif, chronologie, méthode) — même voie que « Créer un support », aucun système parallèle.
 */
import type { TranscriptTaskId } from '@/services/ai';
import type { CourseArtifactType, DocArtifactType } from '@/domain/study';

export type ActionNature = 'ai' | 'local' | 'support';
export type ActionGroup = 'primary' | 'revise' | 'understand' | 'analyze' | 'text';
/** Panneau d'options à afficher avant de lancer. */
export type ActionOptionsKind = 'summary' | 'translate' | 'source' | 'clean' | 'none';

export interface TranscriptAction {
  id: string;
  label: string;
  /** Une ligne, affichée sous le nom. */
  description: string;
  icon: string;
  group: ActionGroup;
  nature: ActionNature;
  /** Tâche du moteur (nature 'ai' / 'local'). */
  task?: TranscriptTaskId;
  /** Type de document produit (nature 'ai' / 'local'). */
  docType?: DocArtifactType;
  /** Type de support (nature 'support'). */
  supportType?: CourseArtifactType;
  options: ActionOptionsKind;
  /** Mots minimum pour que l'action ait du sens (un résumé de 20 mots n'en a pas). */
  minWords: number;
  /** Titre du document produit. */
  title: (sessionTitle: string, opts?: Record<string, string>) => string;
}

export const GROUP_LABELS: Record<Exclude<ActionGroup, 'primary'>, string> = {
  revise: 'Réviser', understand: 'Comprendre', analyze: 'Analyser', text: 'Texte',
};

const t = (label: string) => (s: string) => `${label} — ${s}`;

export const TRANSCRIPT_ACTIONS: readonly TranscriptAction[] = [
  // ------------------------------------------------------------------ principales
  { id: 'summarize', label: 'Résumer', description: 'Express, standard ou détaillé — sans rien inventer.', icon: 'ScrollText', group: 'primary', nature: 'ai', task: 'summarize', docType: 'SUMMARY', options: 'summary', minWords: 60,
    title: (s, o) => `Résumé${o?.modeLabel ? ` ${o.modeLabel.toLowerCase()}` : ''} — ${s}` },
  { id: 'translate', label: 'Traduire', description: 'Une nouvelle version dans la langue choisie ; l’original reste intact.', icon: 'Languages', group: 'primary', nature: 'ai', task: 'translate', docType: 'TRANSLATION', options: 'translate', minWords: 1,
    title: (s, o) => `Traduction${o?.languageLabel ? ` (${o.languageLabel})` : ''} — ${s}` },
  { id: 'structure', label: 'Structurer', description: 'La transcription brute devient un cours lisible : titres, définitions, à retenir.', icon: 'NotebookPen', group: 'primary', nature: 'ai', task: 'structure', docType: 'STRUCTURED_NOTES', options: 'source', minWords: 80, title: t('Cours structuré') },
  { id: 'key-points', label: 'Points clés', description: 'Les idées essentielles, hiérarchisées.', icon: 'ListChecks', group: 'primary', nature: 'ai', task: 'key-points', docType: 'KEY_POINTS', options: 'source', minWords: 40, title: t('Points clés') },

  // ------------------------------------------------------------------ réviser
  { id: 'study-sheet', label: 'Fiche de révision', description: 'Générée par le moteur de cours, avec les sources.', icon: 'FileText', group: 'revise', nature: 'support', supportType: 'COURSE_SHEET', options: 'none', minWords: 0, title: t('Fiche') },
  { id: 'flashcards', label: 'Flashcards', description: 'Questions / réponses tirées du cours.', icon: 'BookOpen', group: 'revise', nature: 'support', supportType: 'FLASHCARDS', options: 'none', minWords: 0, title: t('Flashcards') },
  { id: 'quiz', label: 'Quiz', description: 'QCM, vrai / faux, questions courtes corrigés.', icon: 'HelpCircle', group: 'revise', nature: 'support', supportType: 'QUIZ', options: 'none', minWords: 0, title: t('Quiz') },
  { id: 'exam-questions', label: 'Questions d’examen', description: 'Sujets probables, avec éléments de réponse tirés du cours.', icon: 'GraduationCap', group: 'revise', nature: 'ai', task: 'exam-questions', docType: 'EXAM_QUESTIONS', options: 'source', minWords: 120, title: t('Questions d’examen') },
  { id: 'to-remember', label: 'À retenir', description: 'Une version très courte, l’essentiel en une minute.', icon: 'Bookmark', group: 'revise', nature: 'ai', task: 'to-remember', docType: 'STUDY_NOTE', options: 'source', minWords: 60, title: t('À retenir') },

  // ------------------------------------------------------------------ comprendre
  { id: 'definitions', label: 'Définitions', description: 'Les définitions données pendant la séance.', icon: 'Quote', group: 'understand', nature: 'ai', task: 'definitions', docType: 'GLOSSARY', options: 'source', minWords: 60, title: t('Définitions') },
  { id: 'glossary', label: 'Glossaire', description: 'Les termes techniques, expliqués avec le vocabulaire du cours.', icon: 'BookA', group: 'understand', nature: 'ai', task: 'glossary', docType: 'GLOSSARY', options: 'source', minWords: 80, title: t('Glossaire') },
  { id: 'concepts', label: 'Notions principales', description: 'Les notions du cours et leurs liens.', icon: 'Network', group: 'understand', nature: 'ai', task: 'concepts', docType: 'STUDY_NOTE', options: 'source', minWords: 80, title: t('Notions principales') },
  { id: 'course-plan', label: 'Plan du cours', description: 'Le plan suivi par l’enseignant, partie par partie.', icon: 'ListTree', group: 'understand', nature: 'ai', task: 'course-plan', docType: 'STUDY_NOTE', options: 'source', minWords: 120, title: t('Plan du cours') },

  // ------------------------------------------------------------------ analyser
  { id: 'important-passages', label: 'Passages importants', description: 'Ce que l’enseignant a souligné, avec l’horodatage.', icon: 'Star', group: 'analyze', nature: 'ai', task: 'important-passages', docType: 'STUDY_NOTE', options: 'source', minWords: 80, title: t('Passages importants') },
  { id: 'ambiguities', label: 'Points incomplets ou ambigus', description: 'Ce qui mérite d’être vérifié ou complété.', icon: 'CircleHelp', group: 'analyze', nature: 'ai', task: 'ambiguities', docType: 'STUDY_NOTE', options: 'source', minWords: 80, title: t('Points à vérifier') },
  { id: 'teacher-questions', label: 'Questions à poser', description: 'Des questions précises à poser à l’enseignant.', icon: 'MessageCircleQuestion', group: 'analyze', nature: 'ai', task: 'teacher-questions', docType: 'STUDY_NOTE', options: 'source', minWords: 80, title: t('Questions à poser') },
  { id: 'comparison', label: 'Tableau comparatif', description: 'Quand le cours compare des notions.', icon: 'BarChart3', group: 'analyze', nature: 'support', supportType: 'COMPARISON_TABLE', options: 'none', minWords: 0, title: t('Tableau comparatif') },
  { id: 'timeline', label: 'Chronologie', description: 'Quand le cours cite des dates ou des étapes datées.', icon: 'CalendarClock', group: 'analyze', nature: 'support', supportType: 'TIMELINE', options: 'none', minWords: 0, title: t('Chronologie') },
  { id: 'method', label: 'Méthode / étapes', description: 'Quand le cours décrit une démarche.', icon: 'ListOrdered', group: 'analyze', nature: 'support', supportType: 'METHOD', options: 'none', minWords: 0, title: t('Méthode') },

  // ------------------------------------------------------------------ texte
  { id: 'clean', label: 'Nettoyer la transcription', description: 'Hésitations, répétitions, ponctuation, paragraphes. L’original reste accessible.', icon: 'Wand2', group: 'text', nature: 'local', task: 'clean', docType: 'CLEAN_TRANSCRIPT', options: 'clean', minWords: 1, title: t('Transcription nettoyée') },
] as const;

export const actionById = (id: string) => TRANSCRIPT_ACTIONS.find((a) => a.id === id);
export const PRIMARY_ACTIONS = TRANSCRIPT_ACTIONS.filter((a) => a.group === 'primary');
export const SECONDARY_ACTIONS = TRANSCRIPT_ACTIONS.filter((a) => a.group !== 'primary');

/** Types de résumé. */
export const SUMMARY_MODES = [
  { id: 'express', label: 'Express', hint: '5 à 10 points essentiels.' },
  { id: 'standard', label: 'Standard', hint: 'Résumé structuré, par sections.' },
  { id: 'detailed', label: 'Détaillé', hint: 'Complet mais condensé.' },
] as const;
export type SummaryMode = (typeof SUMMARY_MODES)[number]['id'];

/* ------------------------------------------------------------------ actions contextuelles */
export interface ActionSuggestion { actionId: string; reason: string }

const count = (re: RegExp, text: string) => text.match(re)?.length ?? 0;

/**
 * Suggestions LÉGÈRES selon le contenu (indices lexicaux, multilingues) : jamais bloquantes, jamais plus de 3.
 * Un indice n'est pas une analyse : l'étudiant reste libre de lancer n'importe quelle action.
 */
export function suggestActions(text: string, words: number): ActionSuggestion[] {
  if (words < 80) return [];
  const lower = text.toLowerCase();
  const defs = count(/\b(se définit|on appelle|on entend par|c['’]est-à-dire|désigne|is defined as|refers to|we call|se define como|bezeichnet man|si definisce)\b/g, lower);
  const cmp = count(/\b(contrairement à|à la différence de|alors que|par rapport à|en revanche|différence entre|compared to|unlike|whereas|in contrast|a diferencia de|im gegensatz zu|a differenza di)\b/g, lower);
  const dates = count(/\b(1[0-9]{3}|20[0-9]{2})\b/g, text);
  const steps = count(/\b(premièrement|deuxièmement|ensuite|enfin|étape|d['’]abord|first(?:ly)?|secondly|step|then|primero|luego|zuerst|dann|schritt|prima|poi)\b/g, lower);
  const terms = count(/\b[\p{Lu}][\p{L}-]{3,}(?:\s+[\p{Lu}][\p{L}-]{3,})?\b/gu, text);
  const out: ActionSuggestion[] = [];
  if (defs >= 3) out.push({ actionId: 'flashcards', reason: `${defs} définitions repérées : de quoi faire des flashcards.` });
  if (cmp >= 3) out.push({ actionId: 'comparison', reason: 'Le cours compare plusieurs notions.' });
  if (dates >= 4) out.push({ actionId: 'timeline', reason: `${dates} dates citées : une chronologie peut aider.` });
  if (steps >= 5) out.push({ actionId: 'method', reason: 'Le cours décrit une démarche en plusieurs étapes.' });
  if (defs + terms / 20 >= 6 && !out.some((x) => x.actionId === 'flashcards')) out.push({ actionId: 'glossary', reason: 'Beaucoup de notions techniques : un glossaire est utile.' });
  if (words >= 2500) out.push({ actionId: 'study-sheet', reason: 'Séance dense : une fiche de révision résume l’essentiel.' });
  return out.slice(0, 3);
}
