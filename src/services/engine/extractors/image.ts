import type { ExtractedDocument } from '@/domain/course';
import { ext, UnsupportedDocumentError, type DocumentExtractor } from './types';

/**
 * Images : la reconnaissance de texte (OCR) n'est pas fournie dans cette version (elle exigerait un modèle de plusieurs Mo).
 * Cet extracteur existe pour que l'image soit acceptée, conservée, et explicitement marquée « texte non exploitable »
 * — et pour qu'un vrai OCR (local ou distant) puisse le remplacer sans toucher au reste du moteur.
 */
export const ImageExtractor: DocumentExtractor = {
  id: 'image-none', format: 'image',
  accepts: (f) => ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'].includes(ext(f.name)) || f.mime.startsWith('image/'),
  async extract(): Promise<ExtractedDocument> {
    throw new UnsupportedDocumentError('Texte d’image non exploitable : la reconnaissance de texte (OCR) n’est pas encore disponible. L’image est conservée.');
  },
};
