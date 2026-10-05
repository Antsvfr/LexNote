import type { LegalItem } from './legal';

export type ID = string;
/** Date-heure ISO 8601. */
export type ISODateTime = string;
/** Date seule, `YYYY-MM-DD`. */
export type ISODate = string;

interface Entity {
  id: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Donnée de démonstration (supprimable en un clic, jamais mélangée à la logique). */
  isDemo?: boolean;
}

export interface Subject extends Entity {
  name: string;
  /** Clé de couleur de la palette (voir `lib/palette.ts`). */
  color: string;
}

/** Un cours / module au sein d'une matière (ex. "Droit des contrats"). */
export interface Module extends Entity {
  subjectId: ID;
  name: string;
}

export type SessionStatus = 'in_progress' | 'completed';

/* ------------------------------------------------------------------ */
/* Emplacements réservés aux fonctionnalités futures (non implémentées) */
/* ------------------------------------------------------------------ */

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
}
export interface Transcript {
  providerId: string;
  language: string;
  segments: TranscriptSegment[];
  createdAt: ISODateTime;
}
export interface AudioRef {
  /** Clé du blob dans le stockage local (futur store `blobs`). */
  blobKey: string;
  mimeType: string;
  durationMs: number;
  /** L'enregistrement n'a lieu qu'avec une autorisation explicite. */
  consentGivenAt: ISODateTime;
}
export interface DocumentRef {
  id: ID;
  name: string;
  kind: 'pdf' | 'pptx' | 'other';
  blobKey: string;
  addedAt: ISODateTime;
}
export interface Flashcard {
  id: ID;
  front: string;
  back: string;
  source: import('./legal').SourceRef;
  provenance: import('./legal').Provenance;
  verification: import('./legal').VerificationStatus;
}
export interface StudyQuestion {
  id: ID;
  prompt: string;
  answer?: string;
  provenance: import('./legal').Provenance;
  verification: import('./legal').VerificationStatus;
}
/** Sorties générées : toujours étiquetées avec leur provenance et le modèle utilisé. */
export interface GeneratedOutput {
  markdown: string;
  generatedAt: ISODateTime;
  providerId: string;
  model: string;
  verification: import('./legal').VerificationStatus;
}
export interface AIOutputs {
  restructured?: GeneratedOutput;
  summary?: GeneratedOutput;
  studySheet?: GeneratedOutput;
}
export interface AIMeta {
  lastRunAt?: ISODateTime;
  providerId?: string;
  model?: string;
}

/** Une séance de cours magistral. Le contenu des notes est stocké à part (`NoteDocument`). */
export interface CourseSession extends Entity {
  subjectId: ID;
  moduleId: ID;
  /** Numéro du CM dans le module (CM 01…). */
  number: number | null;
  title: string;
  date: ISODate;
  /** Temps de prise de notes cumulé, en secondes. */
  durationSec: number;
  status: SessionStatus;
  completedAt: ISODateTime | null;

  /* Dérivés des notes — dupliqués ici pour lister/rechercher sans charger le contenu. */
  wordCount: number;
  excerpt: string;
  searchText: string;

  /* Futur : transcription, audio, documents, IA. Vides en V1. */
  transcript: Transcript | null;
  audio: AudioRef | null;
  documents: DocumentRef[];
  aiOutputs: AIOutputs;
  legalItems: LegalItem[];
  flashcards: Flashcard[];
  questions: StudyQuestion[];
  aiMeta: AIMeta | null;
}

/** Contenu riche des notes (document ProseMirror/TipTap sérialisé). */
export interface NoteDocument {
  sessionId: ID;
  /** JSON TipTap. Opaque pour la couche de stockage. */
  content: unknown;
  updatedAt: ISODateTime;
}

export interface LibrarySnapshot {
  subjects: Subject[];
  modules: Module[];
  sessions: CourseSession[];
}
