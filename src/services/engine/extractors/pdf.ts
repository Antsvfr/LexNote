import type { ExtractedDocument, ExtractedUnit } from '@/domain/course';
import { ext, UnsupportedDocumentError, type DocumentExtractor } from './types';

type PdfJs = typeof import('pdfjs-dist');
export type PdfLoader = () => Promise<PdfJs>;

/** Chargement différé de pdf.js (≈ 400 Ko) : uniquement quand on importe un PDF. Le worker est servi par l'application (aucun CDN). */
export const defaultPdfLoader: PdfLoader = async () => {
  const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  lib.GlobalWorkerOptions.workerSrc = (worker as unknown as { default: string }).default;
  return lib;
};

/** PDF : texte de chaque page (couche texte). Un PDF scanné sans texte est signalé : l'OCR n'est pas disponible. */
export const makePdfExtractor = (load: PdfLoader = defaultPdfLoader): DocumentExtractor => ({
  id: 'pdf-1', format: 'pdf',
  accepts: (f) => ext(f.name) === 'pdf' || f.mime === 'application/pdf',
  async extract(data, ctx): Promise<ExtractedDocument> {
    const lib = await load();
    let doc;
    try { doc = await lib.getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise; }
    catch (e) { throw new UnsupportedDocumentError(/password/i.test(String(e)) ? 'PDF protégé par mot de passe.' : 'PDF illisible ou corrompu.'); }
    const units: ExtractedUnit[] = []; const warnings: string[] = []; let empty = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      for (const it of content.items as { str?: string; hasEOL?: boolean }[]) { if (typeof it.str !== 'string') continue; text += it.str + (it.hasEOL ? '\n' : ' '); }
      text = text.replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
      if (text) units.push({ index: i, text }); else empty++;
      ctx.onProgress?.(i, doc.numPages);
    }
    if (empty) warnings.push(empty === doc.numPages ? 'Aucun texte exploitable : PDF scanné ? La reconnaissance de texte (OCR) n’est pas disponible.' : `${empty} page(s) sans texte (images) ignorée(s).`);
    return { unitLabel: 'page', count: doc.numPages, units, warnings };
  },
});
