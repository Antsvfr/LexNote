/** Supports du professeur (futur) : PDF, PowerPoint, Word, images. Leur traitement n'est pas encore implémenté. */
export type DocumentKind = 'pdf' | 'pptx' | 'docx' | 'image' | 'other';

export interface SourceDocument {
  id: string;
  sessionId: string;
  kind: DocumentKind;
  name: string;
  mimeType: string;
  size: number;
  /** Clé du fichier dans le futur stockage de blobs. */
  blobKey: string;
  status: 'pending' | 'processed' | 'failed';
  addedAt: string;
}
