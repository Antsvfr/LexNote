import type { SourceDocument, SourceLocation, SourceReference } from '@/domain/course';
import { formatMs } from './text';

const docKind = (name?: string) => { const e = name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''; return e === 'pdf' ? 'PDF' : e === 'pptx' || e === 'ppt' ? 'Slides' : e === 'docx' || e === 'doc' ? 'Word' : 'Document'; };

/** « Notes » · « Transcription 00:34:12 » · « PDF p. 18 » · « Slide 24 » */
export function describeLocation(l: SourceLocation): string {
  switch (l.kind) {
    case 'NOTES': return 'Notes';
    case 'TRANSCRIPT': return `Transcription ${formatMs(l.startMs ?? 0)}`;
    case 'SESSION': return 'Séance';
    case 'DOCUMENT':
      if (l.slide) return `Slide ${l.slide}`;
      if (l.page) return `${docKind(l.documentName)} p. ${l.page}`;
      return `${docKind(l.documentName)}${l.section ? ` § ${l.section}` : ''}`;
  }
}

/** Libellé court d'un ensemble de références (badge). */
export function describeRefs(refs: SourceReference[]): string {
  if (!refs.length) return 'Aucune source';
  const kinds = [...new Set(refs.map((r) => r.location.kind))];
  if (kinds.length === 1) {
    const ls = refs.map((r) => describeLocation(r.location));
    return ls.length === 1 || new Set(ls).size === 1 ? ls[0]! : kinds[0] === 'NOTES' ? 'Notes' : `${ls[0]} +${ls.length - 1}`;
  }
  if (kinds.length === 2) return kinds.map((k) => ({ NOTES: 'Notes', TRANSCRIPT: 'transcription', DOCUMENT: 'document', SESSION: 'séance' })[k]).join(' + ').replace(/^./, (c) => c.toUpperCase());
  return `Plusieurs sources (${refs.length})`;
}

/** Lien « revenir à la source » (page Cours de la séance). */
export function sourceHref(sessionId: string, r: SourceReference): string {
  const base = `/session/${sessionId}/course`;
  const l = r.location;
  if (l.kind === 'NOTES') return `${base}?tab=notes&q=${encodeURIComponent(r.quote.slice(0, 80))}`;
  if (l.kind === 'TRANSCRIPT') return `${base}?tab=transcript&t=${Math.round(l.startMs ?? 0)}`;
  if (l.kind === 'DOCUMENT') return `${base}?tab=sources&doc=${l.documentId ?? ''}&unit=${l.slide ?? l.page ?? l.section ?? 1}&q=${encodeURIComponent(r.quote.slice(0, 80))}`;
  return base;
}
export const docOf = (docs: SourceDocument[], id?: string) => docs.find((d) => d.id === id);
