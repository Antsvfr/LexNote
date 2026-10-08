import type { DocumentFormat } from '@/domain/course';
import { DocxExtractor } from './docx';
import { ImageExtractor } from './image';
import { PptxExtractor } from './pptx';
import { TextExtractor } from './text';
import { ext, type DocumentExtractor } from './types';
import { makePdfExtractor } from './pdf';

export * from './types';
export { makePdfExtractor, defaultPdfLoader } from './pdf';

export class ExtractorRegistry {
  private list: DocumentExtractor[] = [];
  constructor(extractors: DocumentExtractor[] = []) { extractors.forEach((e) => this.register(e)); }
  /** Ajouter un extracteur (prioritaire sur les précédents) — ex. un OCR pour les images. */
  register(e: DocumentExtractor) { this.list.unshift(e); }
  find(file: { name: string; mime: string }) { return this.list.find((e) => e.accepts(file)); }
}

export const defaultExtractors = () => new ExtractorRegistry([ImageExtractor, TextExtractor, DocxExtractor, PptxExtractor, makePdfExtractor()]);

export function detectFormat(file: { name: string; mime: string }): DocumentFormat {
  const e = ext(file.name);
  if (e === 'pdf' || file.mime === 'application/pdf') return 'pdf';
  if (e === 'pptx' || e === 'ppt' || file.mime.includes('presentation')) return 'pptx';
  if (e === 'docx' || e === 'doc' || file.mime.includes('word')) return 'docx';
  if (['txt', 'md', 'markdown'].includes(e) || file.mime.startsWith('text/')) return 'text';
  if (file.mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'].includes(e)) return 'image';
  return 'other';
}
export const ACCEPT_ATTR = '.pdf,.ppt,.pptx,.doc,.docx,.txt,.md,image/*';
