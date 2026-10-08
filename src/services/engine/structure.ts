/**
 * StructureAnalyzer — le PLAN du cours vient des sources, jamais d'un modèle fixe :
 *   1. les titres des notes ;  2. les titres de slides / sections des documents (rattachés au plan des notes s'ils se ressemblent) ;
 *   3. à défaut, un découpage thématique de la transcription (titres signalés comme « déduits »).
 * Les morceaux sans place évidente sont rattachés par similarité (index BM25) ou, sinon, laissés « non rattachés » — jamais forcés.
 */
import type { CourseKnowledgeUnit, SourceChunk } from '@/domain/course';
import { allSections, type OutlineSection } from '@/services/study/outline';
import type { CourseMaterial } from './chunking';
import type { BuiltCourseContext } from './context';
import { SourceIndex } from './sourceIndex';
import { formatMs, hashText, jaccard, tokens } from './text';

export interface PlanNode {
  id: string;
  title: string;
  level: number;
  titleOrigin: 'notes' | 'document' | 'transcript' | 'engine';
  path: string[];
  chunkIds: string[];
  children: PlanNode[];
}
export interface Plan {
  roots: PlanNode[];
  /** Morceaux sans titre de rattachement dans les notes (introduction éventuelle). */
  introChunkIds: string[];
  chunkNode: Map<string, string>;
  unitNode: Map<string, string>;
  unassignedChunkIds: string[];
}

const nodeId = (path: string[], origin: string) => `p-${hashText(`${origin}|${path.join('>')}`)}`;
const sim = (a: string, b: string) => { const A = tokens(a), B = tokens(b); const j = jaccard(A, B); const inter = A.filter((x) => B.includes(x)).length; return Math.max(j, A.length && B.length ? inter / Math.min(A.length, B.length) : 0); };

export function analyzeStructure(ctx: BuiltCourseContext, m: CourseMaterial): Plan {
  const chunkNode = new Map<string, string>();
  const byId = new Map<string, PlanNode>();
  const notesChunks = ctx.chunks.filter((c) => c.kind === 'NOTES');
  const intro: string[] = [];

  /* 1) plan des notes */
  const fromSection = (s: OutlineSection, depth: number): PlanNode => {
    const n: PlanNode = { id: nodeId(s.path, 'notes'), title: s.title, level: Math.min(depth, 6), titleOrigin: 'notes', path: s.path, chunkIds: [], children: [] };
    byId.set(n.id, n);
    n.children = s.children.map((c) => fromSection(c, depth + 1));
    return n;
  };
  const roots: PlanNode[] = m.outline.root.children.map((s) => fromSection(s, 1));
  const byPath = new Map([...byId.values()].map((n) => [n.path.join('>'), n]));
  for (const c of notesChunks) {
    const p = c.location.headingPath ?? [];
    const n = p.length ? byPath.get(p.join('>')) : undefined;
    if (n) { n.chunkIds.push(c.id); chunkNode.set(c.id, n.id); } else intro.push(c.id);
  }

  /* 2) plan des documents */
  const flat = () => [...byId.values()];
  for (const d of m.documents.filter((x) => x.status === 'ready')) {
    const dchunks = ctx.chunks.filter((c) => c.kind === 'DOCUMENT' && c.location.documentId === d.id);
    let current: PlanNode | undefined;
    for (const c of dchunks) {
      const title = c.location.headingPath?.[0];
      if (title && (!current || current.title !== title)) {
        const match = flat().filter((n) => n.titleOrigin === 'notes').map((n) => ({ n, s: sim(n.title, title) })).sort((a, b) => b.s - a.s)[0];
        if (match && match.s >= 0.6) current = match.n;
        else {
          const existing = flat().find((n) => n.titleOrigin === 'document' && n.title === title);
          current = existing ?? (() => { const n: PlanNode = { id: nodeId([d.name, title], 'document'), title, level: 1, titleOrigin: 'document', path: [title], chunkIds: [], children: [] }; byId.set(n.id, n); roots.push(n); return n; })();
        }
      }
      if (current) { current.chunkIds.push(c.id); chunkNode.set(c.id, current.id); }
    }
  }

  /* 3) découpage thématique de la transcription quand aucun autre plan n'existe */
  if (!flat().length) {
    const tr = ctx.chunks.filter((c) => c.kind === 'TRANSCRIPT');
    let group: SourceChunk[] = []; let prev: Set<string> | null = null;
    const closeGroup = () => {
      if (!group.length) return;
      const freq = new Map<string, number>(); group.flatMap((c) => tokens(c.text)).filter((t) => t.length > 4).forEach((t) => freq.set(t, (freq.get(t) ?? 0) + 1));
      const top = [...freq].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
      const a = group[0]!.location.startMs ?? 0, b = group[group.length - 1]!.location.endMs ?? 0;
      const title = `Passage ${formatMs(a).slice(0, 5)}–${formatMs(b).slice(0, 5)}${top.length ? ` · ${top.join(', ')}` : ''}`;
      const n: PlanNode = { id: nodeId([title], 'transcript'), title, level: 1, titleOrigin: 'transcript', path: [title], chunkIds: group.map((c) => c.id), children: [] };
      group.forEach((c) => chunkNode.set(c.id, n.id)); byId.set(n.id, n); roots.push(n); group = [];
    };
    for (const c of tr) {
      const cur = new Set(tokens(c.text));
      if (group.length >= 3 && prev && (jaccard(prev, cur) < 0.08 || (c.location.startMs ?? 0) - (group[0]!.location.startMs ?? 0) > 600_000)) closeGroup();
      group.push(c); prev = cur;
    }
    closeGroup();
  }

  /* 4) rattachement des morceaux restants par similarité ; anchors d'abord */
  const nodes = flat();
  const prof = new SourceIndex(nodes.map((n) => ({ id: n.id, text: `${n.title} ${n.title} ${n.chunkIds.map((id) => ctx.index.get(id)?.text ?? '').join(' ')}` })));
  const linkedNotes = new Map<string, string>(); // segmentId → node
  for (const c of notesChunks) { const nid = chunkNode.get(c.id); if (nid) for (const s of c.linkedSegmentIds ?? []) linkedNotes.set(s, nid); }
  const unassigned: string[] = [];
  for (const c of ctx.chunks) {
    if (chunkNode.has(c.id) || intro.includes(c.id)) continue;
    let nid = (c.location.segmentIds ?? []).map((s) => linkedNotes.get(s)).find(Boolean);
    if (!nid && nodes.length) {
      const hit = prof.search(c.text, { k: 1 })[0];
      const common = hit ? tokens(c.text).filter((t) => prof.termsOf(hit.id).includes(t)) : [];
      if (hit && new Set(common).size >= 2 && hit.score >= 2) nid = hit.id;
    }
    if (nid) { chunkNode.set(c.id, nid); byId.get(nid)!.chunkIds.push(c.id); } else unassigned.push(c.id);
  }
  void allSections;

  const unitNode = new Map<string, string>();
  for (const u of ctx.units) { const n = chunkNode.get(u.refs[0]!.chunkId); if (n) unitNode.set(u.id, n); }
  return { roots, introChunkIds: intro, chunkNode, unitNode, unassignedChunkIds: unassigned };
}
export type { CourseKnowledgeUnit };
