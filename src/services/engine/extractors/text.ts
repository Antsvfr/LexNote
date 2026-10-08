import type { ExtractedDocument } from '@/domain/course';
import { ext, type DocumentExtractor } from './types';

/** .txt / .md : un document « section » par titre Markdown, sinon un seul bloc. */
export const TextExtractor: DocumentExtractor = {
  id: 'text-1', format: 'text',
  accepts: (f) => ['txt', 'md', 'markdown'].includes(ext(f.name)) || f.mime.startsWith('text/'),
  async extract(data): Promise<ExtractedDocument> {
    const text = new TextDecoder('utf-8').decode(data).replace(/\r\n?/g, '\n');
    const parts = text.split(/\n(?=#{1,3}\s)/);
    const units = parts.map((p, i) => ({ index: i + 1, title: p.match(/^#{1,3}\s+(.+)/)?.[1]?.trim(), text: p.replace(/^#{1,3}\s+.+\n?/, '').trim() || p.trim() })).filter((u) => u.text);
    return { unitLabel: 'section', count: units.length, units, warnings: units.length ? [] : ['Le fichier est vide.'] };
  },
};
