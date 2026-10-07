/**
 * Générateurs d'artefacts — transformations DÉTERMINISTES d'une version du cours reconstruit.
 *
 * Règles absolues (testées) :
 *  - tout élément provient d'un bloc du cours et en porte les références (donc les sources : notes, PDF p. 14, transcription 01:12:34…) ;
 *  - aucune relation, aucun critère, aucune date, aucune réponse n'est inventé : si le cours ne permet pas de produire un artefact fiable,
 *    on le DIT (EmptySourceError) au lieu de générer du contenu médiocre ;
 *  - les informations incertaines / en conflit / sans source ne servent jamais de « bonne réponse ».
 */
import { newId } from '@/lib/ids';
import { firstSentence, hashText, truncate } from '@/services/engine/text';
import {
  SHEET_SECTION_LABELS, validateContent, type DiagramContent, type DiagramType, type Difficulty, type FlashcardsContent, type MethodContent, type MindMapContent, type MindNode,
  type MindNodeType, type QuizContent, type QuizKind, type SheetContent, type SheetMode, type SheetSectionKind, type StudySettings, type TableContent, type TimelineContent,
} from '@/domain/study';
import type { SourceConfidence, SourceReference } from '@/domain/course';
import {
  allBlocks, allNodes, bodyOf, dateOf, isArticle, isCaselaw, isOtherRef, reliable, shortTitle,
  type CBlock, type CNode, type CourseTree,
} from './courseTree';

export class EmptySourceError extends Error { constructor(message: string) { super(message); this.name = 'EmptySourceError'; } }

export interface GenInput { tree: CourseTree; scope: CNode }
export interface GenResult<C> { title: string; content: C; /** Éléments laissés de côté (limite choisie). */ omitted: number; /** Information à montrer à l'utilisateur (ex. « le cours ne permet que 7 cartes »). */ notice?: string }

const scopeTitle = (i: GenInput) => (i.scope === i.tree.root ? i.tree.title : i.scope.title) || 'Cours';
const hasContent = (n: CNode) => allBlocks(n).some((b) => b.kind !== 'verify');
const WORST: SourceConfidence[] = ['MISSING_SOURCE', 'CONFLICTING', 'UNCERTAIN', 'SUPPORTED', 'VERIFIED'];
const worst = (bs: { confidence: SourceConfidence }[]): SourceConfidence => bs.reduce<SourceConfidence>((w, b) => (WORST.indexOf(b.confidence) < WORST.indexOf(w) ? b.confidence : w), 'VERIFIED');
const mergeRefs = (...l: SourceReference[][]): SourceReference[] => { const seen = new Set<string>(); const out: SourceReference[] = []; for (const r of l.flat()) { const k = `${r.chunkId}|${r.quote.slice(0, 30)}`; if (!seen.has(k)) { seen.add(k); out.push(r); } } return out; };

/* =============================================================== FICHE DE RÉVISION */
const SHEET_LIMITS: Record<SheetMode, { chars: number; items: number }> = { express: { chars: 150, items: 6 }, standard: { chars: 380, items: 14 }, complete: { chars: 100_000, items: 10_000 } };

export function generateSheet(i: GenInput, o: { mode: SheetMode }): GenResult<SheetContent> {
  if (!hasContent(i.scope)) throw new EmptySourceError('Cette partie du cours est vide : il n’y a rien à synthétiser.');
  const lim = SHEET_LIMITS[o.mode]; const blocks = allBlocks(i.scope); let omitted = 0;
  const fit = <T,>(l: T[]) => { omitted += Math.max(0, l.length - lim.items); return l.slice(0, lim.items); };
  const item = (b: CBlock, text = b.text, label = b.label ?? (b.sectionPath.at(-1))) => ({ id: newId(), label, text: truncate(text, lim.chars), sources: b.refs, confidence: b.confidence, ...(b.confidence === 'UNCERTAIN' || b.confidence === 'CONFLICTING' || b.confidence === 'MISSING_SOURCE' ? { uncertain: true } : {}) });
  const sections: SheetContent['sections'] = [];
  type Item = SheetContent['sections'][number]['items'][number];
  const add = (kind: SheetSectionKind, items: Item[]) => { if (items.length) sections.push({ id: newId(), kind, title: SHEET_SECTION_LABELS[kind], items: fit(items) }); };

  const nodes = allNodes(i.scope).filter((n) => (o.mode === 'express' ? n.level <= i.scope.level + 1 : true));
  if (nodes.length) add('plan', nodes.map((n) => ({ id: newId(), text: n.title, depth: Math.min(6, Math.max(0, n.level - i.scope.level - 1)), sources: n.blocks[0]?.refs ?? [], confidence: undefined })));
  add('definitions', blocks.filter((b) => b.kind === 'definition').map((b) => item(b, bodyOf(b))));
  add('articles', blocks.filter(isArticle).map((b) => item(b, bodyOf(b))));
  add('caselaw', blocks.filter(isCaselaw).map((b) => item(b, bodyOf(b))));
  if (o.mode !== 'express') add('references', blocks.filter(isOtherRef).map((b) => item(b)));
  add('examples', blocks.filter((b) => b.kind === 'example').map((b) => item(b)));
  add('exam', blocks.filter((b) => b.kind === 'important').map((b) => item(b)));
  if (o.mode !== 'express') {
    add('methods', blocks.filter((b) => b.kind === 'method').map((b) => item(b, b.steps?.length ? b.steps.map((s, k) => `${k + 1}. ${s}`).join(' ') : b.text)));
    add('figures', blocks.filter((b) => b.kind === 'figure').map((b) => item(b)));
  }
  // Matières sans blocs typés (finance, éco…) : les explications du cours, section par section.
  const typed = sections.some((s) => !['plan', 'toverify'].includes(s.kind));
  if (!typed || o.mode === 'complete') {
    add('concepts', allNodes(i.scope.id === 'root' ? i.tree.root : i.scope).concat(i.scope.blocks.length ? [i.scope] : []).flatMap((n) => {
      const ex = n.blocks.filter((b) => b.kind === 'explanation' && reliable(b));
      if (!ex.length) return [];
      const text = o.mode === 'complete' ? ex.map((b) => b.text).join('\n') : firstSentence(ex[0]!.text, lim.chars);
      return [{ id: newId(), label: n.title, text, sources: mergeRefs(...ex.map((b) => b.refs)), confidence: worst(ex) }];
    }));
  }
  if (o.mode !== 'express') add('toverify', blocks.filter((b) => b.kind === 'verify' || ['CONFLICTING', 'UNCERTAIN'].includes(b.confidence)).filter((b, k, a) => a.findIndex((x) => x.id === b.id) === k).map((b) => item(b)));
  if (!sections.some((s) => s.kind !== 'plan')) throw new EmptySourceError('Aucun contenu exploitable dans cette partie du cours.');
  return { title: `Fiche — ${scopeTitle(i)}`, omitted, content: validateContent('COURSE_SHEET', { mode: o.mode, sections }) };
}

/* =============================================================== CARTE MENTALE */
const NODE_TYPE: Record<string, MindNodeType> = { definition: 'definition', example: 'example', important: 'important', verify: 'question', method: 'concept', figure: 'concept', explanation: 'concept' };
export function generateMindMap(i: GenInput, o: { depth: number; orientation: 'horizontal' | 'radial' | 'vertical' }): GenResult<MindMapContent> {
  if (!hasContent(i.scope)) throw new EmptySourceError('Cette partie du cours est vide : aucune carte à construire.');
  const depth = Math.min(8, Math.max(1, Math.round(o.depth)));
  let omitted = 0; let count = 1;
  const blockNode = (b: CBlock): MindNode | null => {
    if (b.kind === 'explanation' && !b.refs.length) return null;
    const type: MindNodeType = b.kind === 'reference' ? (isCaselaw(b) ? 'caselaw' : isArticle(b) ? 'article' : 'concept') : NODE_TYPE[b.kind] ?? 'concept';
    const title = b.kind === 'method' ? `${b.label ?? 'Méthode'} — ${b.steps?.length ?? 0} étapes` : shortTitle(b, 80);
    return { id: newId(), title, description: b.kind === 'method' ? b.steps?.map((s, k) => `${k + 1}. ${s}`).join('\n') : bodyOf(b), type, sources: b.refs, confidence: b.confidence, ...(['UNCERTAIN', 'CONFLICTING', 'MISSING_SOURCE'].includes(b.confidence) ? { uncertain: true } : {}), children: [] };
  };
  const walk = (n: CNode, d: number, isRoot: boolean): MindNode => {
    const node: MindNode = { id: newId(), title: isRoot ? scopeTitle(i) : n.title, type: isRoot ? 'root' : 'section', sources: isRoot ? [] : n.blocks[0]?.refs ?? [], children: [] };
    for (const c of n.children) {
      if (d + 1 > depth) { omitted += 1 + allNodes(c).length; continue; }
      if (!hasContent(c)) continue;
      node.children.push(walk(c, d + 1, false)); count++;
    }
    // Les éléments du cours (définitions, articles, exemples…) sont des feuilles de leur section, à un niveau de plus que celle-ci.
    if (d + 1 <= depth || (isRoot && !n.children.length)) for (const b of n.blocks) { if (b.kind === 'explanation' && n.blocks.some((x) => x.kind !== 'explanation')) continue; const bn = blockNode(b); if (bn) { node.children.push(bn); count++; } }
    else omitted += n.blocks.length;
    return node;
  };
  const root = walk(i.scope, 0, true);
  if (!root.children.length) throw new EmptySourceError('Le cours ne contient pas assez de structure pour une carte mentale (aucun titre ni élément exploitable).');
  if (count > 60) fold(root, 0);
  return { title: `Carte mentale — ${scopeTitle(i)}`, omitted, content: validateContent('MIND_MAP', { depth, orientation: o.orientation, root }) };
}
function fold(n: MindNode, d: number) { if (d >= 2 && n.children.length) n.collapsed = true; n.children.forEach((c) => fold(c, d + 1)); }
export const countNodes = (n: MindNode): number => 1 + n.children.reduce((a, c) => a + countNodes(c), 0);

/* =============================================================== SCHÉMAS */
const IF_RE = /\bsi\s+([^,;.]{6,160}?),?\s+(?:alors\s+|=>\s*|→\s*)([^.;]{4,200})/i;
const methods = (i: GenInput) => allBlocks(i.scope).filter((b) => b.kind === 'method' && (b.steps?.length ?? 0) >= 2);
const conditionals = (i: GenInput) => allBlocks(i.scope).filter((b) => b.kind !== 'verify' && IF_RE.test(b.text));
export interface Dated { block: CBlock; date: string; year: number }
export function datedBlocks(i: GenInput): Dated[] {
  const out: Dated[] = [];
  for (const b of allBlocks(i.scope)) {
    if (b.kind === 'verify' || !reliable(b)) continue;
    const d = dateOf(b.label ?? '') ?? (b.kind === 'figure' || b.kind === 'example' || b.kind === 'explanation' ? dateOf(b.text) : null);
    if (d && !out.some((x) => x.block.id === b.id)) out.push({ block: b, date: d.label, year: d.year });
  }
  return out;
}
export function comparableSections(i: GenInput): CNode[] {
  let best: { kids: CNode[]; score: number; depth: number } | null = null;
  const visit = (n: CNode, depth: number) => {
    const kids = n.children.filter(hasContent);
    if (kids.length >= 2) {
      const score = kids.reduce((s, k) => { const own = k.blocks.filter((b) => ['definition', 'reference', 'example', 'important'].includes(b.kind)).length; return s + (own ? 100 + own : 0); }, 0);
      if (!best || score > best.score || (score === best.score && depth > best.depth)) best = { kids, score, depth };
    }
    n.children.forEach((c) => visit(c, depth + 1));
  };
  visit(i.scope, 0);
  return (best as { kids: CNode[] } | null)?.kids ?? [];
}
export function suggestDiagramType(i: GenInput): DiagramType {
  if (methods(i).length) return 'PROCESS';
  if (conditionals(i).length) return 'FLOWCHART';
  if (comparableSections(i).length >= 2) return 'COMPARISON';
  if (datedBlocks(i).length >= 3) return 'TIMELINE';
  return 'HIERARCHY';
}

export function generateDiagram(i: GenInput, type: DiagramType, direction: 'vertical' | 'horizontal' = 'vertical'): GenResult<DiagramContent> {
  const nodes: DiagramContent['nodes'] = []; const edges: DiagramContent['edges'] = [];
  const node = (label: string, kind: DiagramContent['nodes'][number]['kind'], b?: { refs: SourceReference[]; confidence?: SourceConfidence }, detail?: string) => {
    const n = { id: newId(), label: truncate(label, 140), kind, sources: b?.refs ?? [], ...(b?.confidence ? { confidence: b.confidence } : {}), ...(detail ? { detail } : {}) };
    nodes.push(n); return n;
  };
  const edge = (from: string, to: string, basis: DiagramContent['edges'][number]['basis'], label?: string) => edges.push({ id: newId(), from, to, basis, ...(label ? { label } : {}) });
  const chain = (items: { label: string; refs: SourceReference[]; confidence?: SourceConfidence; detail?: string }[]) => {
    let prev: string | null = null;
    items.forEach((it, idx) => { const n = node(it.label, idx === 0 ? 'start' : idx === items.length - 1 ? 'end' : 'step', it, it.detail); if (prev) edge(prev, n.id, 'order'); prev = n.id; });
  };
  if (type === 'PROCESS') {
    const m = methods(i)[0];
    const items = m ? m.steps!.map((s) => ({ label: firstSentence(s, 120), detail: s, refs: m.refs, confidence: m.confidence }))
      : i.scope.children.filter(hasContent).map((s) => ({ label: s.title, refs: s.blocks[0]?.refs ?? allBlocks(s)[0]?.refs ?? [], confidence: allBlocks(s)[0]?.confidence }));
    if (items.length < 2) throw new EmptySourceError('Aucune suite d’étapes dans cette partie du cours : une liste numérotée ou des sous-parties successives sont nécessaires.');
    chain(items);
  } else if (type === 'HIERARCHY') {
    const secs = allNodes(i.scope); if (!secs.length) throw new EmptySourceError('Aucun sous-titre dans cette partie : une structure nécessite des titres.');
    const root = node(scopeTitle(i), 'concept'); const ids = new Map<string, string>([[i.scope.id, root.id]]);
    for (const s of secs.slice(0, 40)) { const parent = secs.concat([i.scope]).find((p) => p.children.includes(s)); const n = node(s.title, 'concept', { refs: s.blocks[0]?.refs ?? [] }); ids.set(s.id, n.id); edge(ids.get(parent?.id ?? '') ?? root.id, n.id, 'structure'); }
  } else if (type === 'COMPARISON') {
    const cols = comparableSections(i).slice(0, 4);
    if (cols.length < 2) throw new EmptySourceError('Une comparaison nécessite au moins deux notions (deux sous-parties) dans cette partie du cours.');
    for (const c of cols) { const h = node(c.title, 'concept', { refs: c.blocks[0]?.refs ?? [] }); for (const b of allBlocks(c).filter((x) => ['definition', 'reference', 'example', 'important'].includes(x.kind) && reliable(x)).slice(0, 4)) { const n = node(`${shortTitle(b, 100)}`, 'note', b, b.text); edge(h.id, n.id, 'structure'); } }
  } else if (type === 'TIMELINE') {
    const d = datedBlocks(i).sort((a, b) => a.year - b.year);
    if (d.length < 2) throw new EmptySourceError('Moins de deux dates dans cette partie du cours : pas de chronologie.');
    chain(d.map((x) => ({ label: `${x.date} — ${firstSentence(bodyOf(x.block), 100)}`, detail: x.block.text, refs: x.block.refs, confidence: x.block.confidence })));
  } else if (type === 'FLOWCHART') {
    const cs = conditionals(i);
    if (!cs.length) throw new EmptySourceError('Aucune condition explicite (« si… alors… ») dans cette partie du cours. Créez un schéma vide pour le construire vous-même.');
    for (const b of cs.slice(0, 12)) { const m = IF_RE.exec(b.text)!; const q = node(`${truncate(m[1]!.trim(), 120)} ?`, 'decision', b, b.text); const yes = node(truncate(m[2]!.trim(), 140), 'step', b); edge(q.id, yes.id, 'stated', 'oui'); } // le « non » n'est pas inventé
  } else {
    const secs = allNodes(i.scope).slice(0, 25);
    if (secs.length < 2) throw new EmptySourceError('Une carte de relations nécessite au moins deux notions (titres) dans cette partie du cours.');
    const ns = new Map(secs.map((s) => [s.id, node(s.title, 'concept', { refs: s.blocks[0]?.refs ?? [] })]));
    for (const a of secs) for (const b of secs) {
      if (a.id === b.id || a.title.length < 3) continue;
      if (b.blocks.some((x) => x.text.toLowerCase().includes(a.title.toLowerCase()))) edge(ns.get(b.id)!.id, ns.get(a.id)!.id, 'stated', 'cite');
    }
    if (!edges.length) throw new EmptySourceError('Aucune relation explicite : dans le cours, les notions ne se citent pas entre elles.');
  }
  return { title: `Schéma — ${scopeTitle(i)}`, omitted: 0, content: validateContent('DIAGRAM', { type, direction, nodes, edges }) };
}
export function emptyDiagram(type: DiagramType): DiagramContent {
  return validateContent('DIAGRAM', { type, direction: 'vertical', nodes: [{ id: newId(), label: 'Début', kind: 'start', sources: [] }], edges: [] });
}

/* =============================================================== TABLEAU COMPARATIF */
const ROWS: { label: string; match: (b: CBlock) => boolean }[] = [
  { label: 'Définition', match: (b) => b.kind === 'definition' }, { label: 'Articles', match: isArticle }, { label: 'Jurisprudence', match: isCaselaw },
  { label: 'Exemples', match: (b) => b.kind === 'example' }, { label: 'Points importants', match: (b) => b.kind === 'important' },
  { label: 'Méthode', match: (b) => b.kind === 'method' }, { label: 'Chiffres et dates', match: (b) => b.kind === 'figure' },
];
export function generateComparison(i: GenInput, conceptIds?: string[]): GenResult<TableContent> {
  const cols = (conceptIds?.length ? i.tree.sections.filter((s) => conceptIds.includes(s.id)) : comparableSections(i)).slice(0, 5);
  if (cols.length < 2) throw new EmptySourceError('Il faut au moins deux notions comparables (sous-parties avec des définitions, articles, exemples…) : le cours n’en contient pas dans cette partie.');
  const rows: TableContent['rows'] = [];
  for (const r of ROWS) {
    const cells: TableContent['rows'][number]['cells'] = {}; let any = false;
    for (const c of cols) {
      const bs = allBlocks(c).filter((b) => r.match(b) && b.kind !== 'verify');
      cells[c.id] = bs.length ? { text: bs.map((b) => b.kind === 'method' && b.steps?.length ? b.steps.map((s, k) => `${k + 1}. ${s}`).join('\n') : bodyOf(b)).join('\n'), sources: mergeRefs(...bs.map((b) => b.refs)), confidence: worst(bs) } : { text: '—', sources: [] };
      if (bs.length) any = true;
    }
    if (any) rows.push({ id: newId(), label: r.label, cells }); // un critère n'existe que si le cours le renseigne pour au moins une notion
  }
  if (!rows.some((r) => Object.values(r.cells).filter((c) => c.sources.length > 0).length >= 2)) throw new EmptySourceError('Ces notions n’ont aucun critère commun renseigné dans le cours : un tableau serait vide ou inventé.');
  return { title: `Comparaison — ${cols.map((c) => c.title).join(' / ')}`.slice(0, 200), omitted: 0, content: validateContent('COMPARISON_TABLE', { columns: cols.map((c) => ({ id: c.id, title: c.title, sources: c.blocks[0]?.refs ?? [] })), rows }) };
}

/* =============================================================== CHRONOLOGIE */
export function generateTimeline(i: GenInput): GenResult<TimelineContent> {
  const d = datedBlocks(i).sort((a, b) => a.year - b.year);
  if (d.length < 2) throw new EmptySourceError('Le cours contient moins de deux dates fiables dans cette partie : aucune chronologie n’est générée (aucune date n’est inventée).');
  return { title: `Chronologie — ${scopeTitle(i)}`, omitted: 0, content: validateContent('TIMELINE', { events: d.map((x) => ({ id: newId(), date: x.date, label: firstSentence(bodyOf(x.block), 140), text: x.block.text, sources: x.block.refs, confidence: x.block.confidence })) }) };
}

/* =============================================================== MÉTHODE */
const PITFALL = /\b(?:piège|erreur|attention|à éviter|ne pas oublier|ne confondez|oubli|confusion)\b/i;
export function generateMethod(i: GenInput): GenResult<MethodContent> {
  const ms = allBlocks(i.scope).filter((b) => b.kind === 'method' && (b.steps?.length ?? 0) >= 1 && b.confidence !== 'MISSING_SOURCE');
  if (!ms.length) throw new EmptySourceError('Le cours ne contient aucun passage méthodologique (suite d’étapes) dans cette partie : aucune méthode n’est générée.');
  const first = ms[0]!;
  const sectionIds = new Set(ms.map((b) => b.sectionId));
  const near = allBlocks(i.scope).filter((b) => sectionIds.has(b.sectionId) || ms.length === 0);
  const sents = (b: CBlock) => b.text.split(/(?<=[.!?])\s+/).map((s) => s.trim());
  const mk = (text: string, b: CBlock) => ({ id: newId(), text, sources: b.refs, confidence: b.confidence });
  const steps = ms.flatMap((b) => b.steps!.map((s) => mk(s, b)));
  const questions = near.flatMap((b) => (b.kind === 'method' ? [] : sents(b).filter((s) => s.endsWith('?') && s.length > 10).map((s) => mk(s, b))));
  const pitfalls = near.filter((b) => b.kind !== 'method' && (b.kind === 'important' || b.kind === 'verify' || PITFALL.test(b.text)) && PITFALL.test(b.text)).map((b) => mk(firstSentence(b.text, 240), b));
  const content = validateContent('METHOD', {
    objective: { text: first.sectionPath.at(-1) ?? i.tree.title, sources: first.refs },
    steps, questions, pitfalls, checklist: steps.map((s) => ({ id: newId(), text: s.text, done: false, sources: s.sources })),
  });
  return { title: `Méthode — ${first.sectionPath.at(-1) ?? scopeTitle(i)}`, omitted: 0, content };
}

/* =============================================================== FLASHCARDS & QUIZ */
interface Cand { key: string; kind: string; question: string; answer: string; difficulty: Difficulty; concept?: string; refs: SourceReference[]; confidence: SourceConfidence; explanation: string; prio: number; block: CBlock }
const RANKCONF: Record<SourceConfidence, number> = { VERIFIED: 0, SUPPORTED: 1, UNCERTAIN: 2, CONFLICTING: 3, MISSING_SOURCE: 4 };

function candidates(i: GenInput): { cands: Cand[]; skipped: number } {
  const all = allBlocks(i.scope).filter((b) => b.kind !== 'verify');
  const ok = all.filter(reliable);
  const cands: Cand[] = [];
  const path = (b: CBlock) => b.sectionPath.join(' › ') || i.tree.title;
  const why = (b: CBlock) => `Dans le cours : ${path(b)}.`;
  for (const b of ok) {
    const sec = b.sectionPath.at(-1) ?? i.tree.title;
    const body = bodyOf(b);
    const c = (kind: string, question: string, answer: string, difficulty: Difficulty, concept: string | undefined, prio: number): Cand => ({ key: `${kind}|${hashText(question)}`, kind, question, answer, difficulty, concept, refs: b.refs, confidence: b.confidence, explanation: why(b), prio, block: b });
    if (b.kind === 'definition') cands.push(c('definition', b.label ? `Définir : ${b.label}` : `Quelle est la définition notée dans « ${sec} » ?`, body, 'easy', b.label ?? sec, 1));
    else if (isArticle(b)) cands.push(c('article', `Que prévoit ${b.label ?? 'cet article'} ?`, body, 'medium', b.label, 2));
    else if (isCaselaw(b)) cands.push(c('caselaw', `Que retenir de ${b.label ?? 'cette décision'} ?`, body, 'hard', b.label, 3));
    else if (b.kind === 'important') cands.push(c('important', `Point d’examen — « ${sec} » : que faut-il retenir ?`, body, 'medium', sec, 0));
    else if (b.kind === 'example') cands.push(c('example', `Quel exemple le cours donne-t-il pour « ${sec} » ?`, body, 'medium', sec, 4));
    else if (b.kind === 'method' && b.steps?.length) cands.push(c('method', `Quelles sont les étapes : « ${b.label ?? sec} » ?`, b.steps.map((s, k) => `${k + 1}. ${s}`).join('\n'), 'hard', b.label ?? sec, 2));
    else if (b.kind === 'figure') { const d = dateOf(b.label ?? b.text); cands.push(c('figure', d ? `Que retenir de « ${d.label} » ?` : `Que retenir de « ${b.label ?? sec} » ?`, body, 'medium', b.label ?? sec, 5)); }
  }
  // Complément : explications, seulement si les éléments typés sont rares.
  if (cands.length < 6) for (const b of ok.filter((x) => x.kind === 'explanation' && x.text.length >= 40)) cands.push({ key: `explanation|${hashText(b.text)}`, kind: 'explanation', question: `Expliquez : ${b.sectionPath.at(-1) ?? i.tree.title}`, answer: b.text, difficulty: 'hard', concept: b.sectionPath.at(-1), refs: b.refs, confidence: b.confidence, explanation: why(b), prio: 6, block: b });
  const seen = new Set<string>();
  const uniq = cands.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
  return { cands: uniq, skipped: all.length - ok.length };
}
/** Répartition équilibrée entre types, les plus fiables d'abord. */
function pick(cands: Cand[], n: number): Cand[] {
  const groups = new Map<string, Cand[]>();
  for (const c of [...cands].sort((a, b) => a.prio - b.prio || RANKCONF[a.confidence] - RANKCONF[b.confidence])) (groups.get(c.kind) ?? groups.set(c.kind, []).get(c.kind)!).push(c);
  const order = [...groups.values()].sort((a, b) => a[0]!.prio - b[0]!.prio);
  const out: Cand[] = [];
  for (let r = 0; out.length < n && order.some((g) => g[r]); r++) for (const g of order) if (g[r] && out.length < n) out.push(g[r]!);
  return out;
}
export const FLASHCARD_COUNTS = [10, 20, 30];

export function generateFlashcards(i: GenInput, o: { count: number }): GenResult<FlashcardsContent> {
  const { cands, skipped } = candidates(i);
  if (!cands.length) throw new EmptySourceError('Le cours ne contient pas assez d’éléments fiables (définitions, articles, arrêts, points d’examen, étapes…) pour créer des flashcards sans rien inventer.');
  const n = Math.max(1, Math.min(200, Math.round(o.count)));
  const chosen = pick(cands, n);
  const notice = chosen.length < n ? `Le cours ne permet de créer que ${chosen.length} carte${chosen.length > 1 ? 's' : ''} fiable${chosen.length > 1 ? 's' : ''} (au lieu de ${n}) : rien n’a été inventé pour compléter.` : skipped ? `${skipped} élément${skipped > 1 ? 's' : ''} incertain${skipped > 1 ? 's' : ''} ou sans source ${skipped > 1 ? 'ont' : 'a'} été écarté${skipped > 1 ? 's' : ''} (listé${skipped > 1 ? 's' : ''} dans « À vérifier » du cours).` : undefined;
  return { title: `Flashcards — ${scopeTitle(i)}`, omitted: Math.max(0, cands.length - chosen.length), notice, content: validateContent('FLASHCARDS', { cards: chosen.map((c) => ({ id: newId(), question: c.question, answer: c.answer, difficulty: c.difficulty, concept: c.concept, sources: c.refs, confidence: c.confidence })) }) };
}

/** Mélange déterministe (même cours → même quiz). */
const shuffled = <T,>(l: T[], seed: string): T[] => l.map((x, k) => ({ x, r: hashText(`${seed}|${k}`) })).sort((a, b) => (a.r < b.r ? -1 : 1)).map((e) => e.x);

export function generateQuiz(i: GenInput, o: { count: number; level: Difficulty | 'all'; kinds: QuizKind[] }): GenResult<QuizContent> {
  const { cands } = candidates(i);
  const defs = cands.filter((c) => c.kind === 'definition' && c.concept);
  const pool: (Cand & { qkind: QuizKind; q: QuizContent['questions'][number] })[] = [];
  const mk = (c: Cand, qkind: QuizKind, q: Omit<QuizContent['questions'][number], 'id' | 'sources' | 'confidence' | 'concept'>) => pool.push({ ...c, qkind, q: { id: newId(), ...q, concept: c.concept, sources: c.refs, confidence: c.confidence } });

  // Questions courtes : la réponse attendue EST le passage du cours.
  for (const c of cands) mk(c, 'short', { kind: 'short', prompt: c.question, correct: c.answer, explanation: c.explanation, difficulty: c.difficulty });
  // QCM : les mauvaises réponses sont de VRAIES définitions d'autres notions du même cours (jamais des réponses fabriquées).
  if (defs.length >= 3) for (const c of defs) {
    const others = shuffled(defs.filter((d) => d.concept !== c.concept), c.key).slice(0, 3);
    const opts = shuffled([{ id: 'ok', text: c.answer }, ...others.map((d, k) => ({ id: `d${k}`, text: d.answer }))], `o${c.key}`);
    mk(c, 'mcq', { kind: 'mcq', prompt: `Quelle définition correspond à « ${c.concept} » ?`, options: opts, correct: 'ok', explanation: `${c.concept} : ${c.answer} — ${c.explanation}`, difficulty: 'medium' });
    const names = shuffled([c, ...others], `n${c.key}`).map((d, k) => ({ id: d === c ? 'ok' : `n${k}`, text: d.concept! }));
    mk(c, 'mcq', { kind: 'mcq', prompt: `À quelle notion correspond cette définition : « ${truncate(c.answer, 220)} » ?`, options: names, correct: 'ok', explanation: `Il s’agit de « ${c.concept} » — ${c.explanation}`, difficulty: 'easy' });
  }
  // Vrai / faux : vrai = énoncé du cours ; faux = définition d'UNE AUTRE notion du cours (vérifiable, jamais inventée).
  for (const c of defs) mk(c, 'truefalse', { kind: 'truefalse', prompt: `« ${c.concept} » : ${truncate(c.answer, 240)}`, correct: 'true', explanation: `Vrai : c’est la définition notée dans le cours. ${c.explanation}`, difficulty: 'easy' });
  if (defs.length >= 2) for (const c of defs) {
    const other = shuffled(defs.filter((d) => d.concept !== c.concept), `f${c.key}`)[0]!;
    mk(c, 'truefalse', { kind: 'truefalse', prompt: `« ${c.concept} » : ${truncate(other.answer, 240)}`, correct: 'false', explanation: `Faux : ce texte définit « ${other.concept} ». « ${c.concept} » : ${c.answer}`, difficulty: 'medium' });
  }
  const want = new Set(o.kinds.length ? o.kinds : (['mcq', 'truefalse', 'short'] as QuizKind[]));
  const filtered = pool.filter((p) => want.has(p.qkind) && (o.level === 'all' || p.q.difficulty === o.level));
  if (!filtered.length) throw new EmptySourceError(pool.length ? 'Aucune question ne correspond à ce niveau / ces types : le cours ne contient pas assez de matière fiable pour eux. Essayez « tous niveaux » ou d’autres types.' : 'Le cours ne contient pas assez de définitions, références ou étapes fiables pour poser des questions dont la bonne réponse est certaine.');
  const n = Math.max(1, Math.min(100, Math.round(o.count)));
  // Équilibre entre types, une question par (type, passage) en priorité.
  const byKind = new Map<QuizKind, typeof filtered>();
  for (const p of filtered) (byKind.get(p.qkind) ?? byKind.set(p.qkind, []).get(p.qkind)!).push(p);
  const lists = [...byKind.values()].map((l) => shuffled(l, 'pick').sort((a, b) => a.prio - b.prio));
  const chosen: typeof filtered = []; const used = new Set<string>();
  for (let r = 0; chosen.length < n && lists.some((l) => l[r]); r++) for (const l of lists) { const p = l[r]; if (p && chosen.length < n && !used.has(`${p.qkind}|${p.q.prompt}`)) { used.add(`${p.qkind}|${p.q.prompt}`); chosen.push(p); } }
  const notice = chosen.length < n ? `Le cours ne permet de poser que ${chosen.length} question${chosen.length > 1 ? 's' : ''} fiable${chosen.length > 1 ? 's' : ''} (au lieu de ${n}).` : undefined;
  return { title: `Quiz — ${scopeTitle(i)}`, omitted: 0, notice, content: validateContent('QUIZ', { questions: chosen.map((p) => p.q) }) };
}

/* =============================================================== SUGGESTIONS (discrètes, jamais automatiques) */
export interface Suggestion { type: 'MIND_MAP' | 'COMPARISON_TABLE' | 'COURSE_SHEET' | 'DIAGRAM' | 'TIMELINE' | 'METHOD' | 'FLASHCARDS' | 'QUIZ'; text: string }
export function suggestSupports(tree: CourseTree): Suggestion[] {
  const i: GenInput = { tree, scope: tree.root };
  const out: Suggestion[] = []; const bs = allBlocks(tree.root);
  const defs = bs.filter((b) => b.kind === 'definition').length; const typed = bs.filter((b) => ['definition', 'reference', 'important', 'example'].includes(b.kind)).length;
  if (tree.sections.length >= 3) out.push({ type: 'MIND_MAP', text: `Visualisez les ${tree.sections.length} parties du cours.` });
  const cmp = comparableSections(i); if (cmp.length >= 2) out.push({ type: 'COMPARISON_TABLE', text: `${cmp.length} notions comparables : ${cmp.map((c) => c.title).slice(0, 3).join(', ')}.` });
  if (methods(i).length) out.push({ type: 'METHOD', text: 'Le cours décrit une méthode en plusieurs étapes.' });
  if (datedBlocks(i).length >= 3) out.push({ type: 'TIMELINE', text: 'Plusieurs dates fiables ont été relevées.' });
  if (typed >= 5) out.push({ type: 'COURSE_SHEET', text: `${typed} éléments à retenir (définitions, références, points d’examen…).` });
  if (defs >= 3) out.push({ type: 'QUIZ', text: `${defs} définitions : de quoi s’entraîner par QCM.` });
  return out.slice(0, 4);
}
export type { StudySettings };
