import { unzipSync, strFromU8 } from 'fflate';
import type { ExtractedDocument } from '@/domain/course';
import { ext, UnsupportedDocumentError, type DocumentExtractor } from './types';
import { blocks, textRuns } from './xml';

/** PowerPoint (.pptx) : une unité par slide (titre + texte + notes du présentateur). (.ppt binaire non pris en charge.) */
export const PptxExtractor: DocumentExtractor = {
  id: 'pptx-1', format: 'pptx',
  accepts: (f) => ext(f.name) === 'pptx' || f.mime.includes('presentationml'),
  async extract(data, ctx): Promise<ExtractedDocument> {
    let files: Record<string, Uint8Array>;
    try { files = unzipSync(new Uint8Array(data), { filter: (f) => /^ppt\/(slides|notesSlides)\/(_rels\/)?[^/]+\.(xml|rels)$/.test(f.name) }); } catch { throw new UnsupportedDocumentError('Fichier PowerPoint illisible ou corrompu.'); }
    const num = (n: string) => Number(/(\d+)\.xml$/.exec(n)?.[1] ?? 0);
    const slideNames = Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
    if (!slideNames.length) throw new UnsupportedDocumentError('Ce fichier n’est pas une présentation PowerPoint (.pptx) valide.');
    // notes : notesSlideN → slideM via les relations
    const notesFor = new Map<string, string>();
    for (const n of Object.keys(files).filter((x) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(x))) {
      const rels = files[n.replace('notesSlides/', 'notesSlides/_rels/') + '.rels'];
      const target = rels ? /Target="\.\.\/slides\/(slide\d+\.xml)"/.exec(strFromU8(rels))?.[1] : undefined;
      if (target) notesFor.set(`ppt/slides/${target}`, textRuns(strFromU8(files[n]!), 'a:t').replace(/\s+/g, ' ').trim());
    }
    const units = slideNames.map((n, i) => {
      const xml = strFromU8(files[n]!);
      let title: string | undefined;
      const body: string[] = [];
      for (const sp of blocks(xml, 'p:sp')) {
        const isTitle = /<p:ph[^>]*type="(?:title|ctrTitle)"/.test(sp);
        const paras = blocks(sp, 'a:p').map((p) => textRuns(p, 'a:t').replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (!paras.length) continue;
        if (isTitle && !title) title = paras.join(' '); else body.push(...paras);
      }
      const notes = notesFor.get(n);
      // Les notes du présentateur sont gardées, mais signalées comme telles.
      const text = [...body, ...(notes ? [`[Notes du présentateur] ${notes}`] : [])].join('\n');
      ctx.onProgress?.(i + 1, slideNames.length);
      return { index: num(n), title, text: text || (title ?? '') };
    }).filter((u) => u.text || u.title);
    const warnings = units.length < slideNames.length ? [`${slideNames.length - units.length} slide(s) sans texte (images seules) ignorée(s).`] : [];
    return { unitLabel: 'slide', count: slideNames.length, units, warnings };
  },
};
