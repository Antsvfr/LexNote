/**
 * Découpage des sources en morceaux (SourceChunk) : une unité de lecture, de citation et de recherche.
 * Chaque morceau garde son emplacement EXACT (SourceLocation) : c'est ce qui permet de « revenir à la source ».
 * Les identifiants sont dérivés du contenu (stables d'une génération à l'autre : base du traitement incrémental).
 */
import type { NoteAnchor, TimelineMarker, TranscriptSegment } from '@/domain/capture';
import type { CourseSource, SourceChunk, SourceDocument, SourceKind, SourceLocation } from '@/domain/course';
import { allSections, type Outline, type OutlineBlock, type OutlineSection } from '@/services/study/outline';
import { approxTokens, foldKey, hashText, normalizeText } from './text';

export const NOTES_SOURCE_ID = 'notes';
export const TRANSCRIPT_SOURCE_ID = 'transcript';
const MAX_CHARS = 1100;

export interface CourseMaterial {
  sessionId: string;
  sessionTitle: string;
  outline: Outline;
  segments: TranscriptSegment[];
  markers: TimelineMarker[];
  anchors: NoteAnchor[];
  documents: SourceDocument[];
}

class IdMaker {
  private seen = new Map<string, number>();
  make(prefix: string, hash: string) { const base = `${prefix}-${hash}`; const n = (this.seen.get(base) ?? 0) + 1; this.seen.set(base, n); return n === 1 ? base : `${base}.${n}`; }
}
const chunk = (ids: IdMaker, p: Omit<SourceChunk, 'id' | 'hash' | 'tokens'> & { prefix: string }): SourceChunk => {
  const { prefix, ...rest } = p;
  const hash = hashText(foldKey(rest.text));
  return { ...rest, id: ids.make(prefix, hash), hash, tokens: approxTokens(rest.text) };
};

/* ------------------------------------------------------------------ notes */
export function chunkNotes(m: CourseMaterial, ids = new IdMaker()): SourceChunk[] {
  const out: SourceChunk[] = [];
  const secs: OutlineSection[] = [m.outline.root, ...allSections(m.outline.root)];
  let order = 0;
  for (const sec of secs) {
    let buf: OutlineBlock[] = [];
    const flush = () => {
      if (!buf.length) return;
      const kind = buf[0]!.kind;
      const text = normalizeText(kind === 'step' ? buf.map((b, i) => `${i + 1}. ${b.text}`).join('\n') : buf.map((b) => b.text).join('\n'));
      if (text) out.push(chunk(ids, {
        prefix: 'n', sessionId: m.sessionId, sourceId: NOTES_SOURCE_ID, kind: 'NOTES', text, order: order++, blockKind: kind,
        location: { kind: 'NOTES', headingPath: sec.path, noteBlockId: buf[0]!.id },
      }));
      buf = [];
    };
    for (const b of sec.blocks) {
      const mergeable = b.kind === 'paragraph' || b.kind === 'list';
      const cur = buf.length ? buf[0]!.kind : null;
      const same = cur === b.kind || (cur !== null && mergeable && (cur === 'paragraph' || cur === 'list'));
      const size = buf.reduce((n, x) => n + x.text.length, 0) + b.text.length;
      if (buf.length && (!same || !(mergeable || b.kind === 'step') || size > MAX_CHARS)) flush();
      buf.push(b);
      if (!mergeable && b.kind !== 'step') flush(); // les blocs juridiques restent isolés : une citation = un morceau
    }
    flush();
  }
  // Ancrages : un passage de notes relié aux segments de transcription entendus au même moment.
  const norm = (s: string) => foldKey(s).slice(0, 40);
  for (const a of m.anchors) {
    const key = norm(a.textSnippet);
    if (key.length < 12) continue;
    const c = out.find((x) => foldKey(x.text).includes(key));
    if (!c) continue;
    c.location = { ...c.location, anchorId: c.location.anchorId ?? a.id };
    c.linkedSegmentIds = [...new Set([...(c.linkedSegmentIds ?? []), ...a.nearbyTranscriptSegmentIds])];
    const near = m.markers.filter((k) => Math.abs(k.atMs - a.timestamp) <= 30_000).map((k) => k.id);
    if (near.length) c.location = { ...c.location, markerIds: [...new Set([...(c.location.markerIds ?? []), ...near])] };
  }
  return out;
}

/* ------------------------------------------------------------------ transcription */
export function chunkTranscript(m: CourseMaterial, ids = new IdMaker()): SourceChunk[] {
  const segs = [...m.segments].filter((s) => s.text.trim()).sort((a, b) => a.startMs - b.startMs);
  const out: SourceChunk[] = [];
  let buf: TranscriptSegment[] = []; let order = 0;
  const flush = () => {
    if (!buf.length) return;
    const text = normalizeText(buf.map((s) => s.text.trim()).join(' '));
    const start = buf[0]!.startMs, end = buf[buf.length - 1]!.endMs;
    const confs = buf.map((s) => s.confidence).filter((x): x is number => typeof x === 'number');
    const markerIds = m.markers.filter((k) => k.atMs >= start - 5_000 && k.atMs <= end + 5_000).map((k) => k.id);
    out.push(chunk(ids, {
      prefix: 't', sessionId: m.sessionId, sourceId: TRANSCRIPT_SOURCE_ID, kind: 'TRANSCRIPT', text, order: order++,
      quality: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0.8,
      location: { kind: 'TRANSCRIPT', startMs: start, endMs: end, segmentIds: buf.map((s) => s.id), ...(markerIds.length ? { markerIds } : {}) },
    }));
    buf = [];
  };
  for (const s of segs) {
    const last = buf[buf.length - 1];
    const chars = buf.reduce((n, x) => n + x.text.length, 0);
    if (last && (s.startMs - last.endMs > 20_000 || chars + s.text.length > 900 || s.endMs - buf[0]!.startMs > 120_000)) flush();
    buf.push(s);
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------ documents */
export const documentSourceId = (d: SourceDocument) => `doc-${d.id}`;
export function chunkDocument(d: SourceDocument, ids = new IdMaker()): SourceChunk[] {
  if (d.status !== 'ready' || !d.extraction) return [];
  const out: SourceChunk[] = []; let order = 0;
  for (const u of d.extraction.units) {
    const paras = normalizeText(u.text).split(/\n+/).map((p) => p.trim()).filter(Boolean);
    const groups: string[] = []; let cur = '';
    for (const p of paras) { if (cur && cur.length + p.length > MAX_CHARS) { groups.push(cur); cur = ''; } cur = cur ? `${cur}\n${p}` : p; }
    if (cur) groups.push(cur);
    if (!groups.length && u.title) groups.push(u.title);
    groups.forEach((g, gi) => {
      const loc: SourceLocation = {
        kind: 'DOCUMENT', documentId: d.id, documentName: d.name,
        ...(d.unitLabel === 'slide' ? { slide: u.index } : d.unitLabel === 'page' ? { page: u.index } : { section: u.index }),
        ...(u.title ? { headingPath: [u.title] } : {}),
      };
      out.push(chunk(ids, { prefix: `d${d.id.slice(0, 4)}`, sessionId: d.sessionId, sourceId: documentSourceId(d), kind: 'DOCUMENT', text: gi === 0 && u.title && !g.startsWith(u.title) ? `${u.title}\n${g}` : g, order: order++, location: loc }));
    });
  }
  return out;
}

/* ------------------------------------------------------------------ vue d'ensemble */
export interface SourceSet { sources: CourseSource[]; chunks: SourceChunk[] }

export function buildSourceSet(m: CourseMaterial): SourceSet {
  const sources: CourseSource[] = []; const chunks: SourceChunk[] = [];
  const push = (id: string, kind: SourceKind, label: string, cs: SourceChunk[], documentId?: string) => {
    if (!cs.length) return;
    chunks.push(...cs);
    sources.push({ id, kind, label, documentId, chunkCount: cs.length, wordCount: cs.reduce((n, c) => n + (c.text.split(/\s+/).length), 0), hash: hashText(cs.map((c) => c.hash).join('|')) });
  };
  push(NOTES_SOURCE_ID, 'NOTES', 'Notes', chunkNotes(m));
  push(TRANSCRIPT_SOURCE_ID, 'TRANSCRIPT', 'Transcription', chunkTranscript(m));
  for (const d of m.documents) push(documentSourceId(d), 'DOCUMENT', d.name, chunkDocument(d), d.id);
  return { sources, chunks };
}
