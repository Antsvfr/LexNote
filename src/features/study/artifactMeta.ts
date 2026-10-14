import {
  BarChart3, BookA, BookOpen, Brain, CalendarClock, FileText, HelpCircle, Languages, ListChecks, ListOrdered, Network, NotebookPen, ScrollText, Sparkles, Wand2,
  type LucideIcon,
} from 'lucide-react';
import type { ArtifactType } from '@/domain/study';

/** Icône de chaque type de support : une seule table pour toutes les listes (Réviser, Mes supports, récapitulatif). */
export const ARTIFACT_ICONS: Record<ArtifactType, LucideIcon> = {
  COURSE_SHEET: FileText, MIND_MAP: Brain, DIAGRAM: Network, COMPARISON_TABLE: BarChart3, TIMELINE: CalendarClock, METHOD: ListOrdered,
  FLASHCARDS: BookOpen, QUIZ: HelpCircle,
  SUMMARY: ScrollText, TRANSLATION: Languages, CLEAN_TRANSCRIPT: Wand2, STRUCTURED_NOTES: NotebookPen, KEY_POINTS: ListChecks,
  GLOSSARY: BookA, EXAM_QUESTIONS: HelpCircle, STUDY_NOTE: Sparkles,
};

export const ARTIFACT_PLURALS: Record<ArtifactType, string> = {
  COURSE_SHEET: 'Fiches', MIND_MAP: 'Cartes mentales', DIAGRAM: 'Schémas', COMPARISON_TABLE: 'Tableaux comparatifs', TIMELINE: 'Chronologies',
  METHOD: 'Méthodes', FLASHCARDS: 'Flashcards', QUIZ: 'Quiz',
  SUMMARY: 'Résumés', TRANSLATION: 'Traductions', CLEAN_TRANSCRIPT: 'Transcriptions nettoyées', STRUCTURED_NOTES: 'Cours structurés',
  KEY_POINTS: 'Points clés', GLOSSARY: 'Glossaires', EXAM_QUESTIONS: 'Questions d’examen', STUDY_NOTE: 'Notes d’étude',
};
