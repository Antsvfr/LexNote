/**
 * Générateurs de supports — EXTRACTION LOCALE, sans IA.
 *
 * Règle absolue : tout élément produit ici vient d'un passage RÉEL du cours (`sources` = extrait exact).
 * Aucune section n'est inventée pour « faire plus complet » : une section sans matière est simplement absente.
 * Aucune flèche causale n'est créée : seules les relations visibles dans le cours le sont (ordre, structure, citation, « si… alors »).
 */
import { newId } from '@/lib/ids';
import {
  validateContent, type ArtifactSource, type DiagramContent, type DiagramType, type FlashcardsContent, type MapDetail, type MapOrientation,
  type MindMapContent, type MindNode, type QuizContent, type SheetContent, type SheetMode, type SheetSectionKind, type TableContent, type TimelineContent,
  SHEET_SECTION_LABELS, kindToNodeType,
} from '@/domain/study';
import {
  allBlocks, allSections, firstSentence, sourceOfBlock, sourceOfSection, truncate,
  type BlockKind, type Outline, type OutlineBlock, type OutlineSection,
} from './outline';

export class EmptySourceError extends Error {
  constructor(message: string) { super(message); this.name = 'EmptySourceError'; }
}

const KIND_LABEL: Record<string, string> = {
  article: 'Article', caselaw: 'Jurisprudence', definition: 'Définition', important: 'Point important', example: 'Exemple', question: 'À vérifier',
  paragraph: 'Note', list: 'Liste', step: 'Étape',
};
export const kindLabel = (k: BlockKind) => KIND_LABEL[k] ?? 'Note';
const LEGAL_KINDS: BlockKind[] = ['article', 'caselaw', 'definition', 'important', 'example', 'question'];
const isLegal = (b: OutlineBlock) => LEGAL_KINDS.includes(b.kind);

export interface GenInput { outline: Outline; scope: OutlineSection }
export interface GenResult<C> { title: string; content: C; /** Éléments laissés de côté (limite de détail), pour en informer l'utilisateur. */ omitted: number }

const src = (i: GenInput, b: OutlineBlock): ArtifactSource[] => [sourceOfBlock(i.outline.sessionId, b)];
const secSrc = (i: GenInput, s: OutlineSection): ArtifactSource[] => [sourceOfSection(i.outline.sessionId, s)];
const scopeTitle = (i: GenInput) => i.scope.title || i.outline.title || 'Cours';
const hasContent = (s: OutlineSection) => allBlocks(s).length > 0;

/* =============================================================== FICHE */
export interface SheetOptions { mode: SheetMode; include?: Partial<Record<'articles' | 'caselaw' | 'examples' | 'exam' | 'toverify' | 'definitions', boolean>> }

const SHEET_MAP: { kind: SheetSectionKind; block: BlockKind; flag: keyof NonNullable<SheetOptions['include']> }[] = [
  { kind: 'definitions', block: 'definition', flag: 'definitions' },
  { kind: 'articles', block: 'article', flag: 'articles' },
  { kind: 'caselaw', block: 'caselaw', flag: 'caselaw' },
  { kind: 'examples', block: 'example', flag: 'examples' },
  { kind: 'exam', block: 'important', flag: 'exam' },
  { kind: 'toverify', block: 'question', flag: 'toverify' },
];

export function generateSheet(i: GenInput, o: SheetOptions): GenResult<SheetContent> {
  if (!hasContent(i.scope)) throw new EmptySourceError('Cette partie du cours est vide : il n’y a rien à synthétiser.');
  const limits = { express: { chars: 160, items: 5 }, standard: { chars: 420, items: 14 }, complete: { chars: 100_000, items: 10_000 } }[o.mode];
  const blocks = allBlocks(i.scope);
  const sections: SheetContent['sections'] = [];
  let omitted = 0;
  const fit = <T,>(list: T[]) => { omitted += Math.max(0, list.length - limits.items); return list.slice(0, limits.items); };

  // Plan : seulement les titres réellement présents.
  const heads = allSections(i.scope).filter((s) => o.mode === 'express' ? s.level <= (i.scope.level + 1) : true);
  if (heads.length) {
    sections.push({
      id: newId(), kind: 'plan', title: SHEET_SECTION_LABELS.plan,
      items: fit(heads).map((s) => ({ id: newId(), text: s.title, depth: Math.min(6, Math.max(0, s.level - i.scope.level - 1)), sources: secSrc(i, s) })),
    });
  }

  for (const m of SHEET_MAP) {
    if (o.include?.[m.flag] === false) continue;
    const list = blocks.filter((b) => b.kind === m.block);
    if (!list.length) continue; // pas de section artificielle
    sections.push({
      id: newId(), kind: m.kind, title: SHEET_SECTION_LABELS[m.kind],
      items: fit(list).map((b) => ({ id: newId(), label: b.headingPath.at(-1), text: truncate(b.text, limits.chars), sources: src(i, b) })),
    });
  }

  // Matières sans blocs juridiques (finance, éco…) ou notes libres : notions = titres + premier contenu.
  const concepts = allSections(i.scope).filter((s) => s.blocks.length);
  if (concepts.length && (o.mode !== 'express' || !sections.some((s) => s.kind !== 'plan'))) {
    sections.push({
      id: newId(), kind: 'concepts', title: SHEET_SECTION_LABELS.concepts,
      items: fit(concepts).map((s) => {
        const text = o.mode === 'complete' ? s.blocks.map((b) => b.text).join('\n') : firstSentence(s.blocks.map((b) => b.text).join(' '), limits.chars);
        return { id: newId(), label: s.title, text, sources: secSrc(i, s) };
      }),
    });
  } else if (!allSections(i.scope).length) {
    const free = blocks.filter((b) => !isLegal(b));
    if (free.length) sections.push({ id: newId(), kind: 'concepts', title: SHEET_SECTION_LABELS.concepts, items: fit(free).map((b) => ({ id: newId(), text: truncate(b.text, limits.chars), sources: src(i, b) })) });
  }
  if (!sections.length) throw new EmptySourceError('Aucun contenu exploitable dans cette partie du cours.');
  return { title: `Fiche — ${scopeTitle(i)}`, omitted, content: validateContent('COURSE_SHEET', { mode: o.mode, variant: 'sheet', sections }) };
}

/** Résumé express : le premier élément de chaque partie, rien de plus. */
export function generateSummary(i: GenInput): GenResult<SheetContent> {
  if (!hasContent(i.scope)) throw new EmptySourceError('Cette partie du cours est vide.');
  const parts = i.scope.children.filter(hasContent);
  const items = (parts.length ? parts : [i.scope]).map((s) => {
    const first = allBlocks(s)[0]!;
    return { id: newId(), label: parts.length ? s.title : undefined, text: firstSentence(first.text, 220), sources: [sourceOfBlock(i.outline.sessionId, first)] };
  });
  return { title: `Résumé express — ${scopeTitle(i)}`, omitted: 0, content: validateContent('COURSE_SHEET', { mode: 'express', variant: 'summary', sections: [{ id: newId(), kind: 'summary', title: SHEET_SECTION_LABELS.summary, items }] }) };
}

/* =============================================================== CARTE MENTALE */
export interface MapOptions { detail: MapDetail; orientation: MapOrientation }
const CAPS: Record<MapDetail, number> = { simple: 15, standard: 30, detailed: Number.POSITIVE_INFINITY };

export function generateMindMap(i: GenInput, o: MapOptions): GenResult<MindMapContent> {
  if (!hasContent(i.scope) && !i.scope.children.length) throw new EmptySourceError('Cette partie du cours est vide : aucune carte à construire.');
  const cap = CAPS[o.detail];
  const maxDepth = o.detail === 'simple' ? 2 : 99;
  const withBlocks = o.detail !== 'simple';

  const toNode = (s: OutlineSection, depth: number): MindNode => ({
    id: newId(), title: s.title, type: depth === 0 ? 'root' : 'section', sources: depth === 0 ? [] : secSrc(i, s), children: [],
  });
  const root = toNode(i.scope, 0);
  root.title = scopeTitle(i);
  // Construction en largeur : les niveaux hauts d'abord, plafond de nœuds (jamais de carte illisible).
  let count = 1, omitted = 0;
  const queue: { sec: OutlineSection; node: MindNode; depth: number }[] = [{ sec: i.scope, node: root, depth: 0 }];
  const blockNodes: { node: MindNode; blocks: OutlineBlock[] }[] = [];
  while (queue.length) {
    const { sec, node, depth } = queue.shift()!;
    for (const c of sec.children) {
      if (depth + 1 > maxDepth || count >= cap) { omitted += 1 + allSections(c).length; continue; }
      const n = toNode(c, depth + 1); node.children.push(n); count++;
      queue.push({ sec: c, node: n, depth: depth + 1 });
    }
    if (withBlocks) blockNodes.push({ node, blocks: sec.blocks.filter((b) => isLegal(b) || b.kind === 'step') });
  }
  // Blocs (articles, définitions…) en feuilles, tant que le plafond le permet.
  for (const { node, blocks } of blockNodes) {
    for (const b of blocks) {
      if (count >= cap) { omitted++; continue; }
      node.children.push({ id: newId(), title: truncate(firstSentence(b.text, 90), 90), description: b.text, type: kindToNodeType(b.kind), sources: src(i, b), children: [] });
      count++;
    }
  }
  // Cours sans titres : on regroupe les notes libres sous la racine plutôt que de les perdre.
  if (!root.children.length) {
    for (const b of i.scope.blocks) {
      if (count >= cap) { omitted++; continue; }
      root.children.push({ id: newId(), title: truncate(firstSentence(b.text, 90), 90), description: b.text, type: kindToNodeType(b.kind), sources: src(i, b), children: [] }); count++;
    }
  }
  // Grosses cartes : branches profondes repliées par défaut (la carte reste lisible et fluide).
  if (count > 60) foldDeep(root, 0);
  return { title: `Carte mentale — ${scopeTitle(i)}`, omitted, content: validateContent('MIND_MAP', { detail: o.detail, orientation: o.orientation, root }) };
}
function foldDeep(n: MindNode, depth: number) {
  if (depth >= 2 && n.children.length) n.collapsed = true;
  n.children.forEach((c) => foldDeep(c, depth + 1));
}
export const countNodes = (n: MindNode): number => 1 + n.children.reduce((a, c) => a + countNodes(c), 0);

/* =============================================================== SCHÉMAS */
const IF_RE = /\bsi\s+([^,;.]{6,160}?),?\s+(?:alors\s+|=>\s*|→\s*)([^.;]{4,200})/i;
const MONTHS = 'janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre';
const DATE_RE = new RegExp(`(?:\\b\\d{1,2}(?:er)?\\s+(?:${MONTHS})\\s+)?\\b(1[0-9]{3}|20[0-9]{2})\\b`, 'i');

interface DatedBlock { block: OutlineBlock; date: string; year: number }
export function detectDated(i: GenInput): DatedBlock[] {
  const out: DatedBlock[] = [];
  for (const b of allBlocks(i.scope)) {
    const m = b.text.match(DATE_RE);
    if (!m || m.index === undefined) continue;
    // « Art. 1132 », « article L. 1240-1 », « n° 1998 » : un numéro d'article n'est pas une date.
    const before = b.text.slice(Math.max(0, m.index - 12), m.index + m[0].length - m[1]!.length);
    const after = b.text.slice(m.index + m[0].length, m.index + m[0].length + 2);
    if (/(art(?:icles?)?\.?|n°|no|l\.|r\.|d\.)\s*$/i.test(before) || /^[-–]\d/.test(after) || /^\d/.test(after)) continue;
    out.push({ block: b, date: m[0].trim(), year: Number(m[1]) });
  }
  return out;
}
const conditionals = (i: GenInput) => allBlocks(i.scope).filter((b) => IF_RE.test(b.text));
const steps = (i: GenInput) => allBlocks(i.scope).filter((b) => b.kind === 'step');

/** Choisit le schéma le plus pertinent POUR CE CONTENU (l'utilisateur peut en changer). */
export function suggestDiagramType(i: GenInput): DiagramType {
  if (steps(i).length >= 3) return 'PROCESS';
  if (conditionals(i).length >= 1) return 'FLOWCHART';
  const withDefs = i.scope.children.filter((c) => allBlocks(c).some((b) => b.kind === 'definition'));
  if (withDefs.length >= 2) return 'COMPARISON';
  if (detectDated(i).length >= 3) return 'TIMELINE';
  return 'HIERARCHY';
}

export function generateDiagram(i: GenInput, type: DiagramType, direction: 'vertical' | 'horizontal' = 'vertical'): GenResult<DiagramContent> {
  const nodes: DiagramContent['nodes'] = [];
  const edges: DiagramContent['edges'] = [];
  const node = (label: string, kind: DiagramContent['nodes'][number]['kind'], sources: ArtifactSource[], detail?: string) => {
    const n = { id: newId(), label: truncate(label, 140), kind, sources, ...(detail ? { detail } : {}) };
    nodes.push(n); return n;
  };
  const edge = (from: string, to: string, basis: DiagramContent['edges'][number]['basis'], label?: string) => edges.push({ id: newId(), from, to, basis, ...(label ? { label } : {}) });
  const chain = (items: { label: string; sources: ArtifactSource[]; detail?: string }[]) => {
    let prev: string | null = null;
    items.forEach((it, idx) => {
      const n = node(it.label, idx === 0 ? 'start' : idx === items.length - 1 ? 'end' : 'step', it.sources, it.detail);
      if (prev) edge(prev, n.id, 'order');
      prev = n.id;
    });
  };

  if (type === 'PROCESS') {
    const st = steps(i);
    const items = st.length >= 2
      ? st.map((b) => ({ label: firstSentence(b.text, 120), detail: b.text, sources: src(i, b) }))
      : i.scope.children.filter(hasContent).map((s) => ({ label: s.title, sources: secSrc(i, s) }));
    if (items.length < 2) throw new EmptySourceError('Aucune suite d’étapes détectée dans cette partie : utilisez une liste numérotée ou des sous-titres successifs.');
    chain(items);
  } else if (type === 'HIERARCHY') {
    const secs = allSections(i.scope);
    if (!secs.length) throw new EmptySourceError('Aucun sous-titre dans cette partie : une hiérarchie nécessite des titres.');
    const rootN = node(scopeTitle(i), 'concept', []);
    const ids = new Map<string, string>([[i.scope.id, rootN.id]]);
    for (const s of secs.slice(0, 40)) {
      const parentId = ids.get(parentOf(i.scope, s)?.id ?? '') ?? rootN.id;
      const n = node(s.title, 'concept', secSrc(i, s)); ids.set(s.id, n.id); edge(parentId, n.id, 'structure');
    }
  } else if (type === 'COMPARISON') {
    const cols = i.scope.children.filter(hasContent).slice(0, 4);
    if (cols.length < 2) throw new EmptySourceError('Une comparaison nécessite au moins deux notions (deux sous-titres).');
    for (const c of cols) {
      const head = node(c.title, 'concept', secSrc(i, c));
      for (const b of allBlocks(c).filter(isLegal).slice(0, 4)) { const n = node(`${kindLabel(b.kind)} : ${firstSentence(b.text, 100)}`, 'note', src(i, b), b.text); edge(head.id, n.id, 'structure'); }
    }
  } else if (type === 'TIMELINE') {
    const d = detectDated(i).sort((a, b) => a.year - b.year);
    if (d.length < 2) throw new EmptySourceError('Moins de deux dates trouvées dans cette partie : pas de chronologie.');
    chain(d.map((x) => ({ label: `${x.date} — ${firstSentence(x.block.text, 100)}`, detail: x.block.text, sources: src(i, x.block) })));
    edges.forEach((e) => { e.label = undefined; });
  } else if (type === 'FLOWCHART') {
    const cs = conditionals(i);
    if (!cs.length) throw new EmptySourceError('Aucune condition explicite (« si… alors… ») dans cette partie. Créez le schéma vide pour le construire vous-même.');
    for (const b of cs.slice(0, 12)) {
      const m = b.text.match(IF_RE)!;
      const q = node(`${truncate(m[1]!.trim(), 120)} ?`, 'decision', src(i, b), b.text);
      const yes = node(truncate(m[2]!.trim(), 140), 'step', src(i, b));
      edge(q.id, yes.id, 'stated', 'oui'); // le « non » n'est PAS inventé : le cours ne le dit pas
    }
  } else {
    // RELATIONSHIP : uniquement des citations réelles (la section B cite le titre de la section A).
    const secs = allSections(i.scope).slice(0, 25);
    if (secs.length < 2) throw new EmptySourceError('Une carte de relations nécessite au moins deux notions (titres).');
    const ns = new Map(secs.map((s) => [s.id, node(s.title, 'concept', secSrc(i, s))]));
    for (const a of secs) for (const b of secs) {
      if (a.id === b.id || a.title.length < 3) continue;
      const hit = allBlocks(b).find((x) => x.text.toLowerCase().includes(a.title.toLowerCase()));
      if (hit) edge(ns.get(b.id)!.id, ns.get(a.id)!.id, 'stated', 'cite');
    }
    if (!edges.length) throw new EmptySourceError('Aucune relation explicite trouvée : les notions ne se citent pas entre elles dans le cours.');
  }
  return { title: `Schéma — ${scopeTitle(i)}`, omitted: 0, content: validateContent('DIAGRAM', { type, direction, nodes, edges }) };
}
function parentOf(root: OutlineSection, target: OutlineSection): OutlineSection | undefined {
  for (const c of root.children) { if (c === target) return root; const p = parentOf(c, target); if (p) return p; }
  return undefined;
}

/** Schéma vide (à construire à la main) : pour les raisonnements que le cours ne formule pas explicitement. */
export function emptyDiagram(type: DiagramType): DiagramContent {
  return validateContent('DIAGRAM', { type, direction: 'vertical', nodes: [{ id: newId(), label: 'Début', kind: 'start', sources: [] }], edges: [] });
}

/* =============================================================== TABLEAU */
const ROW_KINDS: { block: BlockKind; label: string }[] = [
  { block: 'definition', label: 'Définition' }, { block: 'article', label: 'Articles' }, { block: 'caselaw', label: 'Jurisprudence' },
  { block: 'example', label: 'Exemples' }, { block: 'important', label: 'Points importants' }, { block: 'question', label: 'À vérifier' },
];
/** Notions comparables : sous-titres frères portant le plus de contenu. */
export function comparableSections(i: GenInput): OutlineSection[] {
  // Parmi tous les groupes de sous-titres frères (≥ 2 avec du contenu), on retient celui dont le plus de membres portent EUX-MÊMES
  // des éléments juridiques (définition, article, arrêt…) : ce sont les notions les plus « comparables ». À égalité, le plus profond.
  let best: { kids: OutlineSection[]; score: number; depth: number } | null = null;
  const visit = (sec: OutlineSection, depth: number) => {
    const kids = sec.children.filter(hasContent);
    if (kids.length >= 2) {
      const score = kids.reduce((n, k) => { const own = k.blocks.filter(isLegal).length; return n + (own ? 100 + own : 0); }, 0);
      if (!best || score > best.score || (score === best.score && depth > best.depth)) best = { kids, score, depth };
    }
    sec.children.forEach((c) => visit(c, depth + 1));
  };
  visit(i.scope, 0);
  return (best as { kids: OutlineSection[] } | null)?.kids ?? [];
}
export function generateComparison(i: GenInput, sectionIds?: string[]): GenResult<TableContent> {
  const cols = (sectionIds?.length ? allSections(i.outline.root).filter((s) => sectionIds.includes(s.id)) : comparableSections(i)).slice(0, 5);
  if (cols.length < 2) throw new EmptySourceError('Il faut au moins deux notions (sous-titres) à comparer dans cette partie.');
  const rows: TableContent['rows'] = [];
  for (const rk of ROW_KINDS) {
    const cells: TableContent['rows'][number]['cells'] = {};
    let any = false;
    for (const c of cols) {
      const bs = allBlocks(c).filter((b) => b.kind === rk.block);
      cells[c.id] = bs.length ? { text: bs.map((b) => b.text).join('\n'), sources: bs.map((b) => sourceOfBlock(i.outline.sessionId, b)) } : { text: '—', sources: [] };
      if (bs.length) any = true;
    }
    if (any) rows.push({ id: newId(), label: rk.label, cells });
  }
  if (!rows.length) { // notes libres : un seul rang « Contenu »
    const cells: TableContent['rows'][number]['cells'] = {};
    for (const c of cols) { const bs = allBlocks(c).slice(0, 3); cells[c.id] = { text: bs.map((b) => b.text).join('\n') || '—', sources: bs.map((b) => sourceOfBlock(i.outline.sessionId, b)) }; }
    rows.push({ id: newId(), label: 'Contenu', cells });
  }
  return {
    title: `Comparaison — ${cols.map((c) => c.title).join(' / ')}`.slice(0, 200), omitted: 0,
    content: validateContent('COMPARISON_TABLE', { columns: cols.map((c) => ({ id: c.id, title: c.title, sources: secSrc(i, c) })), rows }),
  };
}

/* =============================================================== CHRONOLOGIE / FLASHCARDS / QUIZ */
export function generateTimeline(i: GenInput): GenResult<TimelineContent> {
  const d = detectDated(i).sort((a, b) => a.year - b.year);
  if (d.length < 2) throw new EmptySourceError('Moins de deux dates trouvées dans cette partie : pas de chronologie.');
  return { title: `Chronologie — ${scopeTitle(i)}`, omitted: 0, content: validateContent('TIMELINE', { events: d.map((x) => ({ id: newId(), date: x.date, label: firstSentence(x.block.text, 140), text: x.block.text, sources: src(i, x.block) })) }) };
}

const splitTerm = (text: string): { term: string; rest: string } | null => {
  const m = text.match(/^([^:\n]{2,60}?)\s*:\s*(.{6,})$/s);
  return m ? { term: m[1]!.trim(), rest: m[2]!.trim() } : null;
};
function cardable(i: GenInput): { b: OutlineBlock; head: string }[] {
  const legal = allBlocks(i.scope).filter((b) => isLegal(b) && b.kind !== 'question');
  if (legal.length) return legal.map((b) => ({ b, head: b.headingPath.at(-1) ?? scopeTitle(i) }));
  return allSections(i.scope).filter((s) => s.blocks.some((b) => b.text.length >= 40)).map((s) => ({ b: s.blocks.find((b) => b.text.length >= 40)!, head: s.title }));
}
export function generateFlashcards(i: GenInput): GenResult<FlashcardsContent> {
  const items = cardable(i);
  if (!items.length) throw new EmptySourceError('Pas assez de contenu structuré (définitions, articles, arrêts, points importants) pour créer des flashcards.');
  const cards = items.map(({ b, head }) => {
    const t = b.kind === 'definition' ? splitTerm(b.text) : null;
    return t ? { id: newId(), front: `Définir : ${t.term}`, back: t.rest, sources: src(i, b) }
      : { id: newId(), front: `${kindLabel(b.kind)} — ${head}`, back: b.text, sources: src(i, b) };
  });
  return { title: `Flashcards — ${scopeTitle(i)}`, omitted: 0, content: validateContent('FLASHCARDS', { cards }) };
}
/** Auto-test de rappel : la réponse EST le passage du cours (aucune réponse ni distracteur inventé). */
export function generateQuiz(i: GenInput): GenResult<QuizContent> {
  const items = cardable(i);
  if (!items.length) throw new EmptySourceError('Pas assez de contenu structuré pour poser des questions.');
  const questions = items.map(({ b, head }) => {
    const t = b.kind === 'definition' ? splitTerm(b.text) : null;
    return t ? { id: newId(), prompt: `Définissez : ${t.term}`, answer: t.rest, sources: src(i, b) }
      : { id: newId(), prompt: `Qu’avez-vous noté sur « ${head} » (${kindLabel(b.kind).toLowerCase()}) ?`, answer: b.text, sources: src(i, b) };
  });
  return { title: `Quiz — ${scopeTitle(i)}`, omitted: 0, content: validateContent('QUIZ', { questions }) };
}

/* =============================================================== SUGGESTIONS (discrètes, jamais automatiques) */
export interface Suggestion { type: 'MIND_MAP' | 'COMPARISON_TABLE' | 'COURSE_SHEET' | 'DIAGRAM' | 'TIMELINE'; text: string }
export function suggestSupports(outline: Outline): Suggestion[] {
  const i: GenInput = { outline, scope: outline.root };
  const out: Suggestion[] = [];
  const legal = allBlocks(outline.root).filter(isLegal).length;
  if (outline.sections.length >= 3) out.push({ type: 'MIND_MAP', text: `Idéale pour visualiser les ${outline.sections.length} parties du cours.` });
  const cmp = comparableSections(i);
  if (cmp.length >= 2) out.push({ type: 'COMPARISON_TABLE', text: `${cmp.length} notions proches ont été détectées.` });
  if (legal >= 5) out.push({ type: 'COURSE_SHEET', text: `${legal} éléments importants détectés (définitions, articles, arrêts…).` });
  const d = suggestDiagramType(i);
  if (d === 'PROCESS') out.push({ type: 'DIAGRAM', text: 'Ce cours décrit une suite d’étapes : un schéma pourrait aider.' });
  if (d === 'FLOWCHART') out.push({ type: 'DIAGRAM', text: 'Des conditions « si… alors… » sont présentes : un schéma de raisonnement est possible.' });
  if (detectDated(i).length >= 3) out.push({ type: 'TIMELINE', text: 'Plusieurs dates ont été repérées.' });
  return out.slice(0, 3);
}
