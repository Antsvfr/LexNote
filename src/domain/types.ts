import type { LegalItem } from './legal';
import type { CaptureSummary } from './capture';

export type ID = string;
export type ISODateTime = string;
export type ISODate = string;

interface Entity {
  id: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Subject extends Entity {
  name: string;
  color: string;
}

export interface Module extends Entity {
  subjectId: ID;
  name: string;
}

export type ThumbKey = 'architecture' | 'justice' | 'chart' | 'skyline' | 'document' | 'abstract';
export type SessionStatus = 'in_progress' | 'completed';
export type SessionType = 'CM' | 'TD' | 'TP' | 'COURSE' | 'SEMINAR' | 'WORKSHOP' | 'REVISION' | 'OTHER';

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
  blobKey: string;
  mimeType: string;
  durationMs: number;
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

export interface CourseSession extends Entity {
  subjectId: ID;
  moduleId: ID;
  type: SessionType;
  number: number | null;
  title: string;
  date: ISODate;
  startTime?: string;
  endTime?: string;
  teacher?: string;
  room?: string;
  durationSec: number;
  status: SessionStatus;
  completedAt: ISODateTime | null;
  thumbnail?: ThumbKey;
  wordCount: number;
  excerpt: string;
  searchText: string;
  captureSummary?: CaptureSummary | null;
  transcript: Transcript | null;
  audio: AudioRef | null;
  documents: DocumentRef[];
  aiOutputs: AIOutputs;
  legalItems: LegalItem[];
  flashcards: Flashcard[];
  questions: StudyQuestion[];
  aiMeta: AIMeta | null;
}

export interface NoteDocument {
  sessionId: ID;
  content: unknown;
  updatedAt: ISODateTime;
}

export interface LibrarySnapshot {
  subjects: Subject[];
  modules: Module[];
  sessions: CourseSession[];
}
