/**
 * CourseGenerator (local, déterministe) — assemble le cours à partir du plan et des connaissances.
 * Il n'écrit AUCUNE prose : chaque bloc reprend le texte d'une source (`origin: 'extracted'`) avec toutes ses références.
 * Introduction / conclusion n'existent que si le cours en contient une. Les sections vides n'existent pas.
 */
import type {
  CourseKnowledgeUnit, CourseSectionNode, GeneratedBlock, GeneratedCourseContent, SourceChunk, SourceConfidence, SourceReference,
} from '@/domain/course';
import type { CourseMaterial } from './chunking';
import type { BuiltCourseContext } from './context';
import { refOf } from './context';
import type { Plan, PlanNode } from './structure';
import { foldKey, hashText, jaccard, sentences, tokens } from './text';

type BlockKind = GeneratedBlock['kind'];
const KIND_OF: Partial<Record<CourseKnowledgeUnit['type'], BlockKind>> = {
  definition: 'definition', example: 'example', exam_point: 'important', method_step: 'method', article: 'reference', caselaw: 'reference', author: 'reference',
  reference: 'reference', date: 'figure', figure: 'figure', formula: 'figure', reasoning: 'explanation',
};
const VERIFY = new Set(['ambiguity', 'incomplete', 'contradiction']);
const RANK: Record<SourceConfidence, number> = { MISSING_SOURCE: 0, CONFLICTING: 1, UNCERTAIN: 2, SUPPORTED: 3, VERIFIED: 4 };

function mergeRefs(...lists: SourceReference[][]): SourceReference[] {
  const seen = new Set<string>(); const out: SourceReference[] = [];
  for (const r of lists.flat()) { const k = `${r.chunkId}|${r.quote.slice(0, 40)}`; if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return out;
}
function mergeConfidence(us: CourseKnowledgeUnit[], refs: SourceReference[]): SourceConfidence {
  if (us.some((u) => u.confidence === 'CONFLICTING')) return 'CONFLICTING';
  if (us.some((u) => u.confidence === 'VERIFIED') || new Set(refs.map((r) => r.location.kind)).size >= 2) return 'VERIFIED';
  return us.reduce<SourceConfidence>((w, u) => (RANK[u.confidence] < RANK[w] ? u.confidence : w), 'VERIFIED');
}

export function generateCourse(ctx: BuiltCourseContext, plan: Plan, m: CourseMaterial): GeneratedCourseContent {
  const chunkById = new Map(ctx.chunks.map((c) => [c.id, c]));
  const unitsByNode = new Map<string, CourseKnowledgeUnit[]>();
  const orphans: CourseKnowledgeUnit[] = [];
  for (const u of ctx.units) { const n = plan.unitNode.get(u.id); if (n) (unitsByNode.get(n) ?? unitsByNode.set(n, []).get(n)!).push(u); else orphans.push(u); }
  const toVerify: GeneratedBlock[] = [];
  const used = new Set<string>(); // un même texte n'apparaît pas deux fois dans le cours

  const block = (kind: BlockKind, p: { label?: string; text: string; refs: SourceReference[]; confidence: SourceConfidence; units: CourseKnowledgeUnit[]; note?: string; steps?: string[]; conflict?: GeneratedBlock['conflict'] }): GeneratedBlock => ({
    id: `b-${hashText(`${kind}|${p.label ?? ''}|${foldKey(p.text).slice(0, 120)}`)}`, kind, label: p.label, text: p.text, origin: 'extracted',
    refs: p.refs, confidence: p.confidence, unitIds: p.units.map((u) => u.id), ...(p.note ? { note: p.note } : {}), ...(p.steps ? { steps: p.steps } : {}), ...(p.conflict ? { conflict: p.conflict } : {}),
  });

  /** Blocs d'un ensemble de connaissances : dédupliqués (même étiquette / même texte) et fusionnés avec toutes leurs sources. */
  const unitBlocks = (units: CourseKnowledgeUnit[]): GeneratedBlock[] => {
    const groups = new Map<string, CourseKnowledgeUnit[]>();
    for (const u of units) {
      const kind = VERIFY.has(u.type) ? 'verify' : KIND_OF[u.type];
      if (!kind) continue;
      const key = `${kind}|${u.type === 'contradiction' ? u.id : foldKey(u.label && ['definition', 'article', 'caselaw'].includes(u.type) ? `${u.type}:${u.label}` : u.text).slice(0, 100)}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(u);
    }
    const out: GeneratedBlock[] = [];
    for (const [key, us] of groups) {
      const kind = key.split('|')[0] as BlockKind; const first = us[0]!;
      const refs = mergeRefs(...us.map((u) => u.refs));
      const confidence = mergeConfidence(us, refs);
      const note = [...new Set(us.map((u) => u.note).filter(Boolean))].join(' ');
      const steps = first.type === 'method_step' ? (first.values?.length ? first.values : first.text.split('\n').map((l) => l.replace(/^\d+\.\s*/, '')).filter(Boolean)) : undefined;
      const conflict = first.type === 'contradiction' ? { values: us[0]!.relatedUnitIds?.length ? ctx.units.filter((x) => first.relatedUnitIds!.includes(x.id)).map((x) => ({ value: x.label ?? x.text.slice(0, 80), refs: x.refs.slice(0, 1) })) : [] } : undefined;
      const b = block(kind, { label: first.label, text: first.text, refs: first.type === 'contradiction' ? first.refs : refs, confidence, units: us, note: note || undefined, steps, conflict });
      if (used.has(b.id)) continue; used.add(b.id);
      out.push(b);
      if (kind === 'verify') toVerify.push(b);
    }
    return out;
  };

  const notesChunks = ctx.chunks.filter((c) => c.kind === 'NOTES');
  const notesTok = notesChunks.map((c) => tokens(c.text));
  /** Sans notes ni documents, la transcription EST la matière du cours : on la reprend (par passages), pas seulement ses temps forts. */
  const transcriptOnly = notesChunks.length === 0 && !ctx.chunks.some((c) => c.kind === 'DOCUMENT');
  const coveredByNotes = (c: SourceChunk) => { const t = tokens(c.text); return notesTok.some((n) => jaccard(n, t) >= 0.5); };

  const sectionBlocks = (node: PlanNode): GeneratedBlock[] => {
    const out: GeneratedBlock[] = [];
    const units = unitsByNode.get(node.id) ?? [];
    const chunkUnits = new Map<string, CourseKnowledgeUnit[]>();
    for (const u of units) { const k = u.refs[0]!.chunkId; (chunkUnits.get(k) ?? chunkUnits.set(k, []).get(k)!).push(u); }
    // 1) explications reprises des sources (notes, puis documents, puis compléments oraux)
    for (const cid of node.chunkIds) {
      const c = chunkById.get(cid); if (!c) continue;
      const own = chunkUnits.get(cid) ?? [];
      const prose = c.kind === 'NOTES' ? (c.blockKind === 'paragraph' || c.blockKind === 'list') : c.kind === 'DOCUMENT' ? !own.some((u) => u.type === 'definition') : false;
      const spoken = c.kind === 'TRANSCRIPT' && (transcriptOnly || (own.some((u) => ['definition', 'reasoning', 'example', 'exam_point'].includes(u.type)) && !coveredByNotes(c)));
      if (!prose && !spoken) continue;
      if (c.kind === 'DOCUMENT' && coveredByNotes(c) && notesChunks.length) continue; // déjà dit dans les notes : la source document reste citée via la connaissance
      const text = c.text;
      const similar = ctx.index.search(c.text, { k: 4, filter: (x) => x.kind !== c.kind && x.id !== c.id }).map((h) => ctx.index.get(h.id)!).filter((x) => jaccard(tokens(x.text), tokens(c.text)) >= 0.35);
      const refs = [refOf(c, text), ...similar.slice(0, 2).map((x) => refOf(x, x.text.slice(0, 300)))];
      const kinds = new Set(refs.map((r) => r.location.kind));
      const b = block('explanation', { text, refs, confidence: kinds.size >= 2 ? 'VERIFIED' : (c.quality ?? 1) < 0.6 ? 'UNCERTAIN' : 'SUPPORTED', units: own });
      if (!used.has(b.id)) { used.add(b.id); out.push(b); }
    }
    // 2) connaissances typées : définitions, exemples, points importants, méthodes, références, chiffres
    const order: BlockKind[] = ['definition', 'explanation', 'example', 'important', 'method', 'reference', 'figure', 'verify'];
    const ub = unitBlocks(units);
    ub.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    return [...out.filter((b) => b.kind === 'explanation'), ...ub.filter((b) => b.kind !== 'explanation')];
  };

  const toSection = (n: PlanNode): CourseSectionNode => ({
    id: n.id, title: n.title, level: n.level, titleOrigin: n.titleOrigin, blocks: sectionBlocks(n), children: n.children.map(toSection),
  });
  const sections = plan.roots.map(toSection);

  // Éléments sans place dans le plan : section dédiée, jamais forcés dans une partie sans rapport.
  const orphanBlocks = unitBlocks(orphans);
  const strayChunks = plan.unassignedChunkIds.map((id) => chunkById.get(id)!).filter((c) => c && c.kind !== 'TRANSCRIPT');
  for (const c of strayChunks) { const b = block('explanation', { text: c.text, refs: [refOf(c, c.text)], confidence: 'SUPPORTED', units: [] }); if (!used.has(b.id)) { used.add(b.id); orphanBlocks.unshift(b); } }
  if (orphanBlocks.length) sections.push({ id: 'p-autres', title: 'Autres éléments du cours', level: 1, titleOrigin: 'engine', blocks: orphanBlocks, children: [] });

  // Introduction : uniquement si les notes commencent par du texte avant le premier titre.
  const introChunks = plan.introChunkIds.map((id) => chunkById.get(id)!).filter(Boolean).filter((c) => c.blockKind === 'paragraph');
  const intro = introChunks[0] ? block('explanation', { text: introChunks[0].text, refs: [refOf(introChunks[0], introChunks[0].text)], confidence: 'SUPPORTED', units: [] }) : undefined;
  // Conclusion : uniquement si une source en formule une.
  let conclusion: GeneratedBlock | undefined;
  for (const c of ctx.chunks) {
    const s = sentences(c.text).find((x) => /^(?:en conclusion|pour conclure|en définitive|en résumé|pour résumer)\b/i.test(x.text));
    if (s) { conclusion = block('explanation', { text: s.text, refs: [refOf(c, s.text)], confidence: 'SUPPORTED', units: [] }); break; }
  }

  // Tout ce qui n'est pas pleinement établi est listé à vérifier (sans doublon).
  const flat: GeneratedBlock[] = []; const walk = (s: CourseSectionNode) => { flat.push(...s.blocks); s.children.forEach(walk); }; sections.forEach(walk);
  for (const b of flat) if (b.kind !== 'verify' && ['UNCERTAIN', 'CONFLICTING', 'MISSING_SOURCE'].includes(b.confidence) && !toVerify.some((v) => v.id === b.id)) toVerify.push({ ...b, id: `v-${b.id}` });

  return {
    title: m.sessionTitle || 'Cours', intro, sections, conclusion, toVerify,
    stats: { chunks: ctx.chunks.length, units: ctx.units.length, blocks: flat.length, byConfidence: {}, byOrigin: {}, dropped: 0 },
  };
}
