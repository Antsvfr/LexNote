/**
 * Validation du cours reconstruit — dernière barrière avant affichage, valable pour N'IMPORTE QUEL fournisseur (local ou IA).
 *  - structure : schéma strict (zod) ;
 *  - provenance : chaque référence doit pointer vers un morceau existant et citer un extrait exact ; sinon elle est retirée ;
 *  - un bloc « extrait » sans aucune référence valide est ÉCARTÉ ; un bloc « généré » sans source est marqué MISSING_SOURCE ;
 *  - juridique : aucun article, arrêt ou date ne peut apparaître dans un bloc s'il ne figure pas dans les sources citées —
 *    sinon « Information non vérifiée dans les sources ».
 */
import { CONFIDENCE_LABELS, generatedCourseContentSchema, type CourseSectionNode, type GeneratedBlock, type GeneratedCourseContent, type SourceChunk } from '@/domain/course';
import { foldKey } from './text';

const LEGAL = [
  /\bart(?:icles?)?\.?\s*(?:[LRD]\.?\s*)?\d{1,4}(?:-\d{1,3})*/gi,
  /\b(?:Cass\.?(?:\s*(?:civ\.?|com\.?|crim\.?|soc\.?))?|Cour de cassation|Conseil d['’]État|CJUE|CEDH|Cons\.?\s*const\.?)[^.;\n]{0,40}/gi,
  /\b(?:n°|pourvoi)\s*[\d./-]{4,}/gi,
  /\b\d{1,2}(?:er)?\s+(?:janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(?:1[0-9]{3}|20[0-9]{2})\b/gi,
];
export const UNVERIFIED = 'Information non vérifiée dans les sources';

export interface ValidationResult { content: GeneratedCourseContent; dropped: number; downgraded: number }

export function validateCourse(raw: unknown, chunks: Map<string, SourceChunk>): ValidationResult {
  const parsed = generatedCourseContentSchema.parse(raw);
  let dropped = 0, downgraded = 0;

  const fixBlock = (b: GeneratedBlock): GeneratedBlock | null => {
    const refs = b.refs.filter((r) => { const c = chunks.get(r.chunkId); return !!c && foldKey(c.text).includes(foldKey(r.quote).slice(0, 120)); });
    let out: GeneratedBlock = { ...b, refs, ...(b.conflict ? { conflict: { values: b.conflict.values.map((v) => ({ ...v, refs: v.refs.filter((r) => chunks.has(r.chunkId)) })) } } : {}) };
    if (!refs.length) {
      if (b.origin === 'extracted' && b.kind !== 'verify') { dropped++; return null; }
      out = { ...out, confidence: 'MISSING_SOURCE', note: [b.note, UNVERIFIED].filter(Boolean).join(' · ') };
      downgraded++;
    }
    const cited = foldKey(refs.map((r) => chunks.get(r.chunkId)?.text ?? '').join(' '));
    const claimed = LEGAL.flatMap((re) => [...(`${out.text} ${out.label ?? ''}`).matchAll(re)].map((m) => m[0]));
    const bad = claimed.filter((t) => !cited.includes(foldKey(t)));
    if (bad.length && out.confidence !== 'MISSING_SOURCE') {
      out = { ...out, confidence: 'MISSING_SOURCE', note: [out.note, `${UNVERIFIED} : ${[...new Set(bad)].slice(0, 3).join(' ; ')}`].filter(Boolean).join(' · ') };
      downgraded++;
    }
    return out;
  };
  const fixSection = (s: CourseSectionNode): CourseSectionNode => ({ ...s, blocks: s.blocks.map(fixBlock).filter((x): x is GeneratedBlock => !!x), children: s.children.map(fixSection) });
  const prune = (s: CourseSectionNode): CourseSectionNode | null => { const ch = s.children.map(prune).filter((x): x is CourseSectionNode => !!x); return s.blocks.length || ch.length ? { ...s, children: ch } : null; };

  const sections = parsed.sections.map(fixSection).map(prune).filter((x): x is CourseSectionNode => !!x);
  const intro = parsed.intro ? fixBlock(parsed.intro) ?? undefined : undefined;
  const conclusion = parsed.conclusion ? fixBlock(parsed.conclusion) ?? undefined : undefined;
  const toVerify = parsed.toVerify.map(fixBlock).filter((x): x is GeneratedBlock => !!x);

  const all: GeneratedBlock[] = []; const walk = (s: CourseSectionNode) => { all.push(...s.blocks); s.children.forEach(walk); }; sections.forEach(walk);
  const byConfidence: Record<string, number> = {}; const byOrigin: Record<string, number> = {};
  for (const b of all) { byConfidence[b.confidence] = (byConfidence[b.confidence] ?? 0) + 1; byOrigin[b.origin] = (byOrigin[b.origin] ?? 0) + 1; }
  const content: GeneratedCourseContent = {
    ...parsed, sections, intro, conclusion, toVerify,
    stats: { ...parsed.stats, blocks: all.length, byConfidence, byOrigin, dropped: parsed.stats.dropped + dropped },
  };
  return { content, dropped, downgraded };
}
export const confidenceLabel = (c: keyof typeof CONFIDENCE_LABELS) => CONFIDENCE_LABELS[c];
