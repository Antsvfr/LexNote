/**
 * Documents (import PDF / PowerPoint, extraction du plan du professeur) — NON implémenté en V1.
 * Les fichiers seront stockés localement (futur store `blobs`) et référencés par `DocumentRef`.
 */
import type { DocumentRef } from '@/domain/types';

export interface DocumentImporter {
  readonly id: string;
  accepts(file: File): boolean;
  import(file: File, sessionId: string): Promise<DocumentRef>;
}

export const documentImporters: DocumentImporter[] = [];
