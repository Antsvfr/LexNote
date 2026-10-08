import { unzipSync, strFromU8 } from 'fflate';
import type { ExtractedDocument, ExtractedUnit } from '@/domain/course';
import { ext, UnsupportedDocumentError, type DocumentExtractor } from './types';
import { blocks, textRuns } from './xml';

/** Word (.docx) : paragraphes + titres ; découpage par saut de page explicite, sinon par titre de niveau 1. (.doc binaire non pris en charge.) */
export const DocxExtractor: DocumentExtractor = {
  id: 'docx-1', format: 'docx',
  accepts: (f) => ext(f.name) === 'docx' || f.mime.includes('wordprocessingml'),
  async extract(data): Promise<ExtractedDocument> {
    let files: Record<string, Uint8Array>;
    try { files = unzipSync(new Uint8Array(data), { filter: (f) => f.name === 'word/document.xml' }); } catch { throw new UnsupportedDocumentError('Fichier Word illisible ou corrompu.'); }
    const xml = files['word/document.xml'] ? strFromU8(files['word/document.xml']) : '';
    if (!xml) throw new UnsupportedDocumentError('Ce fichier n’est pas un document Word (.docx) valide.');
    const paras = blocks(xml, 'w:p').map((p) => ({
      text: textRuns(p, 'w:t').replace(/\s+/g, ' ').trim(),
      heading: /<w:pStyle\s+w:val="(?:Heading|Titre)(\d)"/i.exec(p)?.[1] ? Number(/<w:pStyle\s+w:val="(?:Heading|Titre)(\d)"/i.exec(p)![1]) : 0,
      pageBreak: /<w:br\s+w:type="page"|<w:lastRenderedPageBreak/.test(p) || /<w:pageBreakBefore/.test(p),
    }));
    const hasBreaks = paras.some((p) => p.pageBreak);
    const units: ExtractedUnit[] = []; let cur: string[] = []; let title: string | undefined;
    const flush = () => { const t = cur.join('\n').trim(); if (t) units.push({ index: units.length + 1, title, text: t }); cur = []; title = undefined; };
    for (const p of paras) {
      if (hasBreaks ? p.pageBreak : p.heading === 1) flush();
      if (p.heading && !title) title = p.text;
      if (p.text) cur.push(p.heading ? `${'#'.repeat(Math.min(p.heading, 4))} ${p.text}` : p.text);
    }
    flush();
    return { unitLabel: hasBreaks ? 'page' : 'section', count: units.length, units, warnings: units.length ? [] : ['Aucun texte trouvé dans ce document.'] };
  },
};
