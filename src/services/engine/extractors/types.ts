import type { DocumentFormat, ExtractedDocument } from '@/domain/course';

/**
 * Extraction du texte d'un document importé. Une implémentation par format ; le moteur ne connaît QUE cette interface :
 * on peut remplacer une librairie (ou ajouter l'OCR d'images, un extracteur Keynote, une API distante…) sans toucher au reste.
 */
export interface DocumentExtractor {
  readonly id: string;
  readonly format: DocumentFormat;
  /** Ce fichier est-il pris en charge par cet extracteur ? */
  accepts(file: { name: string; mime: string }): boolean;
  extract(data: ArrayBuffer, ctx: { name: string; onProgress?: (done: number, total: number) => void }): Promise<ExtractedDocument>;
}

export class UnsupportedDocumentError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsupportedDocumentError'; }
}

export const ext = (name: string) => (name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '');
