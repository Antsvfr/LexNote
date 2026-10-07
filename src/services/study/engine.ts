/**
 * Moteur de supports d'étude — UN seul chemin pour l'interface, la palette et (plus tard) l'assistant :
 *   demande → plan du cours (outline) → générateur → validation stricte → StudyArtifact.
 *
 * Deux sources de contenu, une seule validation :
 *   1. extraction locale (toujours disponible, aucune IA) ;
 *   2. un `StudyProvider` IA (optionnel, non branché dans cette version) dont la sortie JSON est validée par le même schéma
 *      PUIS contrôlée contre le cours (`guardAiContent`) : un élément dont l'extrait n'existe pas dans le cours est écarté.
 */
import { newId } from '@/lib/ids';
import { normalize } from '@/lib/text';
import {
  validateContent, type ArtifactContent, type ArtifactScope, type ArtifactType, type DiagramContent, type DiagramType, type MapDetail,
  type MapOrientation, type MindMapContent, type MindNode, type SheetContent, type SheetMode, type StudyArtifact, type TableContent,
} from '@/domain/study';
import {
  EmptySourceError, generateComparison, generateDiagram, generateFlashcards, generateMindMap, generateQuiz, generateSheet, generateSummary,
  generateTimeline, suggestDiagramType, type GenInput, type GenResult,
} from './generators';
import { buildOutline, scopeHash, scopeSection, scopeText, type Outline } from './outline';

export interface StudyOptions {
  mode?: SheetMode;
  summary?: boolean;
  include?: { articles?: boolean; caselaw?: boolean; examples?: boolean; exam?: boolean; toverify?: boolean; definitions?: boolean; sources?: boolean };
  detail?: MapDetail;
  orientation?: MapOrientation;
  diagramType?: DiagramType;
  compareSectionIds?: string[];
}
export interface StudyRequest { type: ArtifactType; scope?: ArtifactScope; options?: StudyOptions }

export interface StudyProvider {
  readonly id: string;
  readonly label: string;
  isAvailable(): boolean;
  /** Doit renvoyer un objet JSON conforme au schéma du type demandé (jamais du texte libre à parser). */
  generate(args: { type: ArtifactType; options: StudyOptions; courseText: string; title: string }): Promise<unknown>;
}
let aiProvider: StudyProvider | null = null;
export const setStudyProvider = (p: StudyProvider | null) => { aiProvider = p; };
export const studyAiAvailable = () => !!aiProvider?.isAvailable();

export interface GeneratedDraft {
  title: string;
  content: ArtifactContent;
  sourceHash: string;
  scope: ArtifactScope | null;
  options: StudyOptions;
  omitted: number;
  /** Éléments proposés par l'IA et écartés faute de source dans le cours. */
  dropped: number;
  generatedBy: { providerId: string; label: string; at: string };
}

export function outlineFor(sessionId: string, title: string, notesDoc: unknown): Outline {
  return buildOutline(sessionId, title, notesDoc);
}

function runLocal(i: GenInput, req: StudyRequest): GenResult<ArtifactContent> {
  const o = req.options ?? {};
  switch (req.type) {
    case 'COURSE_SHEET': return o.summary ? generateSummary(i) : generateSheet(i, { mode: o.mode ?? 'standard', include: o.include });
    case 'MIND_MAP': return generateMindMap(i, { detail: o.detail ?? 'standard', orientation: o.orientation ?? 'horizontal' });
    case 'DIAGRAM': return generateDiagram(i, o.diagramType ?? suggestDiagramType(i));
    case 'COMPARISON_TABLE': return generateComparison(i, o.compareSectionIds);
    case 'TIMELINE': return generateTimeline(i);
    case 'FLASHCARDS': return generateFlashcards(i);
    case 'QUIZ': return generateQuiz(i);
  }
}

export async function generateDraft(outline: Outline, req: StudyRequest, opts: { useAi?: boolean } = {}): Promise<GeneratedDraft> {
  const scope = scopeSection(outline, req.scope?.sectionId);
  if (req.scope?.sectionId && scope === outline.root) throw new EmptySourceError('La section choisie n’existe plus dans le cours.');
  const i: GenInput = { outline, scope };
  const at = new Date().toISOString();
  const base = { sourceHash: scopeHash(scope), scope: req.scope?.sectionId ? { sectionId: scope.id, sectionTitle: scope.title } : null, options: req.options ?? {} };

  if (opts.useAi && aiProvider?.isAvailable()) {
    const raw = await aiProvider.generate({ type: req.type, options: req.options ?? {}, courseText: scopeText(scope), title: scope.title });
    const checked = validateContent(req.type, raw);
    const { content, dropped } = guardAiContent(req.type, checked, scopeText(scope));
    return { ...base, title: `${scope.title} — ${req.type}`, content, omitted: 0, dropped, generatedBy: { providerId: aiProvider.id, label: aiProvider.label, at } };
  }
  const res = runLocal(i, req);
  return { ...base, title: res.title, content: res.content, omitted: res.omitted, dropped: 0, generatedBy: { providerId: 'local-extract', label: 'Extraction du cours (sans IA)', at } };
}

export function toArtifact(draft: GeneratedDraft, p: { userId: string; sessionId: string; subjectId: string | null }): StudyArtifact {
  const now = new Date().toISOString();
  return {
    id: newId(), userId: p.userId, type: inferType(draft.content), title: draft.title, subjectId: p.subjectId, sourceSessionIds: [p.sessionId],
    scope: draft.scope, options: draft.options as Record<string, unknown>, content: draft.content, aiContent: structuredClone(draft.content),
    sourceHash: draft.sourceHash, userEdited: false, generatedBy: draft.generatedBy, createdAt: now, updatedAt: now,
  };
}
/** Le type est celui de la demande ; on le déduit du contenu pour ne jamais enregistrer un type incohérent. */
function inferType(c: ArtifactContent): ArtifactType {
  if ('sections' in c) return 'COURSE_SHEET';
  if ('root' in c) return 'MIND_MAP';
  if ('nodes' in c) return 'DIAGRAM';
  if ('rows' in c) return 'COMPARISON_TABLE';
  if ('events' in c) return 'TIMELINE';
  if ('cards' in c) return 'FLASHCARDS';
  return 'QUIZ';
}

/* ----------------------------------------------------------------------- garde anti-invention */
const has = (hay: string, quote: string) => !!quote && normalize(hay).includes(normalize(quote).slice(0, 80));

/**
 * Contrôle d'une sortie IA contre le cours : un élément sans extrait vérifiable n'est PAS affiché comme issu du cours.
 *  - fiche : l'élément est écarté ; - carte / schéma : le nœud est conservé mais marqué « incertain » ; - tableau : cellule vidée.
 */
export function guardAiContent(type: ArtifactType, content: ArtifactContent, courseText: string): { content: ArtifactContent; dropped: number } {
  let dropped = 0;
  const ok = (s: { quote: string }[]) => s.length > 0 && s.some((x) => has(courseText, x.quote));
  if (type === 'COURSE_SHEET') {
    const c = structuredClone(content) as SheetContent;
    for (const sec of c.sections) { const before = sec.items.length; sec.items = sec.items.filter((it) => ok(it.sources)); dropped += before - sec.items.length; }
    c.sections = c.sections.filter((s) => s.items.length);
    return { content: validateContent('COURSE_SHEET', c), dropped };
  }
  if (type === 'MIND_MAP') {
    const c = structuredClone(content) as MindMapContent;
    const mark = (n: MindNode, isRoot: boolean) => { if (!isRoot && !ok(n.sources)) { n.uncertain = true; dropped++; } n.children.forEach((x) => mark(x, false)); };
    mark(c.root, true);
    return { content: c, dropped };
  }
  if (type === 'DIAGRAM') {
    const c = structuredClone(content) as DiagramContent;
    for (const n of c.nodes) if (!ok(n.sources)) { n.uncertain = true; dropped++; }
    // Une flèche n'est « certaine » que si elle suit l'ordre/la structure du cours ou est dite explicitement.
    for (const e of c.edges) if (e.basis === 'inferred') { e.uncertain = true; dropped++; }
    return { content: c, dropped };
  }
  if (type === 'COMPARISON_TABLE') {
    const c = structuredClone(content) as TableContent;
    for (const r of c.rows) for (const k of Object.keys(r.cells)) { const cell = r.cells[k]!; if (cell.text !== '—' && !ok(cell.sources)) { r.cells[k] = { text: '—', sources: [] }; dropped++; } }
    return { content: c, dropped };
  }
  return { content, dropped };
}

/* ----------------------------------------------------------------------- mise à jour du cours */
export function isStale(a: StudyArtifact, outline: Outline): boolean {
  const scope = scopeSection(outline, a.scope?.sectionId);
  if (a.scope?.sectionId && scope === outline.root) return true;
  return scopeHash(scope) !== a.sourceHash;
}

/* ----------------------------------------------------------------------- commandes naturelles */
export interface StudyIntent { type: ArtifactType; options: StudyOptions; sectionQuery?: string; compare?: string[] }

/** « Fais-moi une fiche très courte sur les nullités » → demande structurée (même moteur que l'interface). */
export function interpretStudyCommand(text: string): StudyIntent | null {
  const t = normalize(text).replace(/[\s.!?]+$/, '');
  const mk = (type: ArtifactType, options: StudyOptions = {}): StudyIntent => {
    const sec = t.match(/(?:uniquement|seulement)?\s*(?:sur|de|du|des|pour|a propos de)\s+(?:les |la |le |l'|l’)?([a-z0-9' -]{3,60})$/);
    const q = sec?.[1]?.trim();
    return { type, options, ...(q && !/ce cours|demain|l'examen|l examen|cette seance/.test(q) ? { sectionQuery: q } : {}) };
  };
  const cmp = t.match(/compar\w*\s+(.+)/);
  if (cmp) {
    const parts = cmp[1]!.split(/,|\bet\b|\bavec\b|\bvs\b/).map((x) => x.replace(/^(les |la |le |l'|ces |trois |deux )+/, '').trim()).filter((x) => x.length > 2 && !/notions?$/.test(x));
    if (parts.length >= 2) return { type: 'COMPARISON_TABLE', options: {}, compare: parts };
    return { type: 'COMPARISON_TABLE', options: {} };
  }
  if (/carte mentale|mindmap|mind map/.test(t)) return mk('MIND_MAP', { detail: /detaill|complete|profond/.test(t) ? 'detailed' : /simple|courte|rapide/.test(t) ? 'simple' : 'standard' });
  if (/flashcard|cartes? de revision|cartes memoire/.test(t)) return mk('FLASHCARDS');
  if (/\bquiz\b|qcm|questions? de revision|m'?interroge/.test(t)) return mk('QUIZ');
  if (/chronologie|frise|timeline/.test(t)) return mk('TIMELINE');
  if (/tableau/.test(t)) return { type: 'COMPARISON_TABLE', options: {} };
  if (/schema|diagramme|etapes|organigramme/.test(t)) return mk('DIAGRAM', /etapes|procedure|processus/.test(t) ? { diagramType: 'PROCESS' } : {});
  if (/resume/.test(t)) return mk('COURSE_SHEET', { summary: true });
  if (/fiche/.test(t)) return mk('COURSE_SHEET', { mode: /tres courte|express|rapide|demain|1 page|une page/.test(t) ? 'express' : /complete|detaillee|approfondie/.test(t) ? 'complete' : 'standard' });
  return null;
}

/** Retrouve la section du cours visée par une demande (« uniquement sur les nullités »). */
export function findSection(outline: Outline, query: string) {
  const q = normalize(query);
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  let best: { s: Outline['sections'][number]; score: number } | null = null;
  for (const s of outline.sections) {
    const n = normalize(s.title);
    const score = n === q ? 100 : n.includes(q) || q.includes(n) ? 60 : words.filter((w) => n.includes(w.replace(/s$/, ''))).length * 10;
    if (score > (best?.score ?? 0)) best = { s, score };
  }
  return best && best.score >= 10 ? best.s : null;
}
