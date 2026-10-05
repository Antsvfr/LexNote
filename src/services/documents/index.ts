/**
 * Documents du professeur (PDF, PowerPoint, Word, images) — NON implémenté.
 *
 * Architecture cible : une séance réunit trois sources traitées SÉPARÉMENT
 *   MES NOTES  +  TRANSCRIPTION  +  SUPPORT DU PROFESSEUR
 * Le support sera stocké comme l'audio (base dédiée, blobs, quotas) et exposé à l'IA via `CourseContext.documents`.
 */
import type { DocumentKind, SourceDocument } from '@/domain/documents';

export interface DocumentImporter {
  readonly id: string;
  readonly kinds: DocumentKind[];
  accepts(file: File): boolean;
  /** Stocke le fichier et crée la référence ; l'extraction du texte/plan est une étape distincte. */
  import(file: File, sessionId: string): Promise<SourceDocument>;
}

/** Lecture des supports d'un CM. Vide tant que l'import n'existe pas. */
export interface DocumentSource {
  list(sessionId: string): Promise<SourceDocument[]>;
}

export const documentImporters: DocumentImporter[] = [];
export const noDocuments: DocumentSource = { list: async () => [] };
