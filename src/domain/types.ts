import type { LegalItem } from './legal';
import type { CaptureSummary } from './capture';
import type { SessionType } from './sessionType';

export type ID = string;
/** Date-heure ISO 8601. */
export type ISODateTime = string;
/** Date seule, `YYYY-MM-DD`. */
export type ISODate = string;

/**
 * Champs communs de toute donnée personnelle.
 *  - `userId` : propriétaire (la base distante le garantit aussi par Row Level Security) ;
 *  - `version` : dernière version CONNUE du serveur (absente tant que la ligne n'a jamais été synchronisée) ;
 *  - `dirty` : modifié localement, pas encore envoyé au cloud.
 */
interface Entity {
  id: ID;
  userId: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  version?: number;
  dirty?: boolean;
}

export interface Subject extends Entity {
  name: string;
  /** Clé de couleur de la palette (voir `lib/palette.ts`). */
  color: string;
  icon?: string;
  /** Année / semestre. */
  term?: string;
  teacher?: string;
  description?: string;
}

/** Module / chapitre / unité au sein d'une matière (ex. "Droit des contrats"). */
export interface Module extends Entity {
  subjectId: ID;
  name: string;
}

/** Vignette d'un CM : illustration locale (aucune image distante). */
export type ThumbKey = 'architecture' | 'justice' | 'chart' | 'skyline' | 'document' | 'abstract';

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
  kind: 'pdf' | 'pptx' | 'docx' | 'image' | 'other';
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

/** Une séance (CM, TD, TP…). Le contenu des notes est stocké à part (`NoteDocument`). */
export interface CourseSession extends Entity {
  subjectId: ID;
  /** Facultatif : une séance peut exister directement sous une matière. */
  moduleId: ID | null;
  /** CM, TD, TP, cours… (même moteur pour tous). */
  type: SessionType;
  /** Numéro dans la matière pour ce type (CM 01, TD 01…). */
  number: number | null;
  title: string;
  date: ISODate;
  /** `HH:MM`, facultatifs. */
  startTime?: string;
  endTime?: string;
  teacher?: string;
  room?: string;
  /** Temps de prise de notes cumulé, en secondes. */
  durationSec: number;
  status: SessionStatus;
  completedAt: ISODateTime | null;
  /** Vignette choisie ; sinon déterministe selon la matière (voir `lib/thumbs.ts`). */
  thumbnail?: ThumbKey;

  /* Dérivés des notes — dupliqués ici pour lister/rechercher sans charger le contenu. */
  wordCount: number;
  excerpt: string;
  searchText: string;

  /** Résumé de la capture (audio/transcription/marqueurs). Les données elles-mêmes vivent dans la base `lexnote-capture`. */
  captureSummary?: CaptureSummary | null;

  /* Réservés. `transcript`/`audio` sont remplacés par la base de capture (domain/capture.ts) ; conservés pour compatibilité. */
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
