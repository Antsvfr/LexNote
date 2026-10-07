/**
 * CourseContextBuilder — Sources → morceaux → index → connaissances → corroboration → conflits.
 *
 * Il ne « résume » rien : il produit un contexte STRUCTURÉ où chaque connaissance garde ses références exactes
 * (morceau + emplacement + extrait) et un niveau de confiance calculé à partir de l'accord (ou du désaccord) entre sources.
 */
import type {
  CourseKnowledgeUnit, CourseSource, SourceChunk, SourceConfidence, SourceReference,
} from '@/domain/course';
import { buildSourceSet, type CourseMaterial } from './chunking';
import { dedupeChunks } from './normalize';
import { buildChunkIndex, type ChunkIndex } from './sourceIndex';
import type { Detection, KnowledgeAnalyzer } from './analyzer';
import { foldKey, hashText, jaccard, sentences, tokens } from './text';

export interface AnalysisCache { get(hash: string): Detection[] | undefined; set(hash: string, d: Detection[]): void }
export class MemoryAnalysisCache implements AnalysisCache {
  constructor(public map = new Map<string, Detection[]>()) {}
  get(h: string) { return this.map.get(h); }
  set(h: string, d: Detection[]) { this.map.set(h, d); }
}

export interface BuiltCourseContext {
  sessionId: string;
  title: string;
  sources: CourseSource[];
  chunks: SourceChunk[];
  index: ChunkIndex;
  units: CourseKnowledgeUnit[];
  stats: { chunks: number; duplicatesMerged: number; cacheHits: number; analyzed: number; conflicts: number };
}
export interface BuildOptions { onProgress?: (done: number, total: number) => void; signal?: AbortSignal }

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
export class AbortedError extends Error { constructor() { super('Génération annulée.'); this.name = 'AbortedError'; } }

const NO_CORROBORATION = new Set(['ambiguity', 'incomplete', 'contradiction', 'theme', 'exam_point', 'method_step']);
const VALUE_TYPES = new Set(['date', 'figure', 'article', 'caselaw']);

export const refOf = (c: SourceChunk, quote: string): SourceReference => ({ sourceId: c.sourceId, chunkId: c.id, location: c.location, quote: quote.slice(0, 700) });

export class CourseContextBuilder {
  constructor(private analyzer: KnowledgeAnalyzer, private cache: AnalysisCache = new MemoryAnalysisCache()) {}

  async build(material: CourseMaterial, opts: BuildOptions = {}): Promise<BuiltCourseContext> {
    const set = buildSourceSet(material);
    const { chunks, removed } = dedupeChunks(set.chunks);
    const index = buildChunkIndex(chunks);
    const markerReasons = new Map(material.markers.map((m) => [m.id, m.reasons]));

    // --- connaissances : une analyse par morceau, mémorisée par empreinte (incrémental)
    let hits = 0, analyzed = 0;
    const units: CourseKnowledgeUnit[] = [];
    const byChunk = new Map<string, CourseKnowledgeUnit[]>();
    for (let i = 0; i < chunks.length; i++) {
      if (opts.signal?.aborted) throw new AbortedError();
      const c = chunks[i]!;
      let dets = this.cache.get(`${this.analyzer.id}:${this.analyzer.version}:${c.kind}:${c.blockKind ?? ''}:${c.hash}`);
      if (dets) hits++;
      else {
        const reasons = (c.location.markerIds ?? []).flatMap((id) => markerReasons.get(id) ?? []);
        dets = await this.analyzer.analyze(c, { markerReasons: reasons });
        this.cache.set(`${this.analyzer.id}:${this.analyzer.version}:${c.kind}:${c.blockKind ?? ''}:${c.hash}`, dets);
        analyzed++;
      }
      const mine: CourseKnowledgeUnit[] = dets.map((d) => ({
        id: `u-${hashText(`${c.id}|${d.type}|${d.quote.slice(0, 80)}|${d.label ?? ''}`)}`, type: d.type, label: d.label, text: d.quote,
        refs: [refOf(c, d.quote)], confidence: 'SUPPORTED', sectionPath: c.location.headingPath ?? [], note: d.note, values: d.values,
      }));
      units.push(...mine); byChunk.set(c.id, mine);
      if (i % 25 === 24) { opts.onProgress?.(i + 1, chunks.length); await tick(); } // la page reste réactive sur les longues séances
    }
    opts.onProgress?.(chunks.length, chunks.length);

    const conflicts = this.corroborate(units, index, byChunk, chunks, set.sources);
    return { sessionId: material.sessionId, title: material.sessionTitle, sources: set.sources, chunks, index, units: [...units, ...conflicts.units], stats: { chunks: chunks.length, duplicatesMerged: removed, cacheHits: hits, analyzed, conflicts: conflicts.units.length } };
  }

  /** Corroboration entre sources + détection des contradictions + niveau de confiance de chaque connaissance. */
  private corroborate(units: CourseKnowledgeUnit[], index: ChunkIndex, byChunk: Map<string, CourseKnowledgeUnit[]>, chunks: SourceChunk[], sources: CourseSource[]) {
    const chunkById = new Map(chunks.map((c) => [c.id, c]));
    const label = (c: SourceChunk) => sources.find((s) => s.id === c.sourceId)?.label ?? c.kind;
    const bySegment = new Map<string, SourceChunk>();
    for (const c of chunks) if (c.kind === 'TRANSCRIPT') for (const s of c.location.segmentIds ?? []) bySegment.set(s, c);
    const conflictUnits: CourseKnowledgeUnit[] = []; const seenPairs = new Set<string>();
    const missing = new Map<string, string[]>(); const conflicted = new Set<string>();

    for (const u of units) {
      if (NO_CORROBORATION.has(u.type)) continue;
      const own = chunkById.get(u.refs[0]!.chunkId)!;
      const ut = new Set(tokens(`${u.label ?? ''} ${u.text}`.replace(/[\d.,/-]+/g, ' ')));
      if (!ut.size) continue;
      const labelToks = tokens(u.label ?? '').filter((t) => !/\d/.test(t));
      const cand = new Map<string, SourceChunk>();
      for (const h of index.search(`${u.label ?? ''} ${u.text}`, { k: 6, filter: (c) => c.kind !== own.kind })) cand.set(h.id, index.get(h.id)!);
      for (const sid of own.linkedSegmentIds ?? []) { const t = bySegment.get(sid); if (t && t.kind !== own.kind) cand.set(t.id, t); }
      for (const c of cand.values()) {
        const ct = new Set(tokens(c.text.replace(/[\d.,/-]+/g, ' ')));
        let cover = 0; for (const t of ut) if (ct.has(t)) cover++;
        cover /= ut.size;
        const labelIn = labelToks.length > 0 && labelToks.every((t) => ct.has(t));
        const linked = (own.linkedSegmentIds ?? []).some((s) => c.location.segmentIds?.includes(s));
        if (!(cover >= 0.5 || (labelIn && cover >= 0.2) || (linked && cover >= 0.15))) continue; // ne couvre pas ce sujet
        const text = foldKey(c.text);
        const vals = u.values ?? [];
        const absent = vals.filter((v) => v && !text.includes(foldKey(v)));
        if (VALUE_TYPES.has(u.type) && vals.length && absent.length) {
          // Autres valeurs du même type dans ce passage ? → désaccord (conflit) ; sinon la valeur est simplement absente.
          const others = (byChunk.get(c.id) ?? []).filter((v) => v.type === u.type && v.values?.length && jaccard(tokens(v.text.replace(/[\d.,/-]+/g, ' ')), ut) >= 0.35 && !v.values.some((x) => vals.map(foldKey).includes(foldKey(x))));
          if (others.length) {
            const v = others[0]!; const key = [u.id, v.id].sort().join('~');
            if (!seenPairs.has(key)) {
              seenPairs.add(key);
              conflicted.add(u.id); conflicted.add(v.id);
              conflictUnits.push({
                id: `u-${hashText(key)}`, type: 'contradiction', label: u.label ?? v.label, confidence: 'CONFLICTING', sectionPath: u.sectionPath,
                text: `Valeurs différentes selon les sources : « ${u.label ?? vals.join(', ')} » (${label(own)}) ≠ « ${v.label ?? v.values!.join(', ')} » (${label(c)}).`,
                refs: [...u.refs, ...v.refs], relatedUnitIds: [u.id, v.id], values: [...vals, ...v.values!],
                note: 'Aucune des deux valeurs n’est présentée comme exacte : vérifiez auprès d’une source officielle.',
              });
            }
          } else missing.set(u.id, [...(missing.get(u.id) ?? []), `« ${absent.join(', ')} » n’apparaît pas dans ${label(c)}, qui traite pourtant du même sujet.`]);
          continue;
        }
        const quote = bestSentence(c.text, ut) ?? c.text.slice(0, 300);
        if (!u.refs.some((r) => r.chunkId === c.id)) u.refs.push(refOf(c, quote));
      }
    }
    for (const u of units) {
      const own = chunkById.get(u.refs[0]!.chunkId)!;
      let conf: SourceConfidence = 'SUPPORTED';
      const kinds = new Set(u.refs.map((r) => r.location.kind));
      if (u.type === 'contradiction') conf = 'CONFLICTING';
      else if (conflicted.has(u.id)) conf = 'CONFLICTING';
      else if (u.type === 'ambiguity' || u.type === 'incomplete') conf = 'UNCERTAIN';
      else if (missing.has(u.id)) { conf = 'UNCERTAIN'; u.note = [u.note, ...missing.get(u.id)!].filter(Boolean).join(' '); }
      else if (kinds.size >= 2) conf = 'VERIFIED';
      else if ((own.quality ?? 1) < 0.6) conf = 'UNCERTAIN';
      else if (own.kind === 'TRANSCRIPT' && ['article', 'caselaw', 'date', 'figure'].includes(u.type)) { conf = 'UNCERTAIN'; u.note = [u.note, 'Entendu à l’oral : non confirmé par vos notes ni par un document.'].filter(Boolean).join(' '); }
      u.confidence = conf;
      if (conflicted.has(u.id)) u.relatedUnitIds = conflictUnits.filter((c) => c.relatedUnitIds?.includes(u.id)).map((c) => c.id);
    }
    return { units: conflictUnits };
  }
}

function bestSentence(text: string, want: Set<string>): string | undefined {
  let best: { s: string; n: number } | undefined;
  for (const s of sentences(text)) { const n = tokens(s.text).filter((t) => want.has(t)).length; if (n && (!best || n > best.n)) best = { s: s.text, n }; }
  return best?.s;
}
