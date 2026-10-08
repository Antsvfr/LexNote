/**
 * Fabrique d'artefacts — UNE seule voie, pour l'interface, la palette et l'assistant :
 *   version du cours reconstruit → arbre → générateur → validation (zod) → StudyArtifact.
 * Il n'y a pas de moteur IA ici : l'intelligence (extraction, corroboration, confiance, provenance) est dans le moteur de cours ;
 * un artefact n'en est qu'une transformation structurée, avec les mêmes références.
 */
import { newId } from '@/lib/ids';
import { normalize } from '@/lib/text';
import type { GeneratedCourse } from '@/domain/course';
import type { ArtifactContent, ArtifactProvenance, ArtifactScope, ArtifactType, Difficulty, QuizKind, StudyArtifact, StudySettings } from '@/domain/study';
import {
  EmptySourceError, generateComparison, generateDiagram, generateFlashcards, generateMethod, generateMindMap, generateQuiz, generateSheet, generateTimeline,
  suggestDiagramType, type GenInput,
} from './generators';
import { scopeNode, treeOf, type CourseTree } from './courseTree';

export interface StudyRequest { type: ArtifactType; scope?: ArtifactScope; settings?: StudySettings }

export interface GeneratedDraft {
  type: ArtifactType;
  title: string;
  content: ArtifactContent;
  scope: ArtifactScope | null;
  settings: StudySettings;
  omitted: number;
  notice?: string;
  course: GeneratedCourse;
}

export const DEFAULTS = { mode: 'standard', depth: 3, orientation: 'horizontal', count: 20, level: 'all', quizCount: 10 } as const;

export function generateDraft(course: GeneratedCourse, req: StudyRequest): GeneratedDraft {
  const tree = treeOf(course);
  const scope = scopeNode(tree, req.scope?.sectionId);
  if (req.scope?.sectionId && scope === tree.root) throw new EmptySourceError('La partie choisie n’existe plus dans cette version du cours.');
  const i: GenInput = { tree, scope };
  const st = req.settings ?? {};
  const base = { type: req.type, scope: req.scope?.sectionId ? { sectionId: scope.id, sectionTitle: scope.title } : null, course };
  const done = <C extends ArtifactContent>(r: { title: string; content: C; omitted: number; notice?: string }, settings: StudySettings): GeneratedDraft => ({ ...base, title: r.title, content: r.content, omitted: r.omitted, notice: r.notice, settings });
  switch (req.type) {
    case 'COURSE_SHEET': { const mode = st.mode ?? DEFAULTS.mode; return done(generateSheet(i, { mode }), { ...st, mode }); }
    case 'MIND_MAP': { const depth = st.depth ?? DEFAULTS.depth, orientation = st.orientation ?? DEFAULTS.orientation; return done(generateMindMap(i, { depth, orientation }), { ...st, depth, orientation }); }
    case 'DIAGRAM': { const diagramType = st.diagramType ?? suggestDiagramType(i); return done(generateDiagram(i, diagramType), { ...st, diagramType }); }
    case 'COMPARISON_TABLE': return done(generateComparison(i, st.conceptIds), st);
    case 'TIMELINE': return done(generateTimeline(i), st);
    case 'METHOD': return done(generateMethod(i), st);
    case 'FLASHCARDS': { const count = st.count ?? DEFAULTS.count; return done(generateFlashcards(i, { count }), { ...st, count }); }
    case 'QUIZ': { const count = st.count ?? DEFAULTS.quizCount, level = st.level ?? DEFAULTS.level, quizKinds = st.quizKinds ?? (['mcq', 'truefalse', 'short'] as QuizKind[]); return done(generateQuiz(i, { count, level: level as Difficulty | 'all', kinds: quizKinds }), { ...st, count, level, quizKinds }); }
  }
}

export const provenanceOf = (c: GeneratedCourse): ArtifactProvenance => ({
  from: 'reconstructed-course', courseId: c.id, courseVersion: c.courseVersion, generatedAt: c.generatedAt,
  sources: c.sourceSnapshot.sources.map((s) => ({ id: s.id, kind: s.kind, label: s.label })),
});

export function toArtifact(draft: GeneratedDraft, p: { userId: string; subjectId: string | null }): StudyArtifact {
  const now = new Date().toISOString(); const c = draft.course;
  return {
    id: newId(), userId: p.userId, type: draft.type, title: draft.title, subjectId: p.subjectId, sourceSessionIds: [c.sessionId], scope: draft.scope, settings: draft.settings,
    content: draft.content, generatedContent: structuredClone(draft.content), courseId: c.id, courseVersion: c.courseVersion, sourceSnapshot: c.sourceSnapshot,
    engineVersion: c.engineVersion, provenance: provenanceOf(c), generation: 1, userEdited: false, createdAt: now, updatedAt: now,
  };
}

/** Une version plus récente du cours existe : l'artefact a été dérivé d'une version antérieure. */
export function isStale(a: StudyArtifact, latest: GeneratedCourse | undefined): boolean {
  return !!latest && latest.id !== a.courseId && latest.courseVersion > a.courseVersion;
}
export const latestCourse = (courses: GeneratedCourse[], sessionId: string): GeneratedCourse | undefined =>
  courses.filter((c) => c.sessionId === sessionId).sort((a, b) => b.courseVersion - a.courseVersion)[0];

/* ----------------------------------------------------------------------- commandes naturelles */
export interface StudyIntent { type: ArtifactType; settings: StudySettings; sectionQuery?: string; compare?: string[] }

/** « Fais-moi une fiche très courte sur les nullités » → demande structurée (même moteur que l'interface). */
export function interpretStudyCommand(text: string): StudyIntent | null {
  const t = normalize(text).replace(/[\s.!?]+$/, '');
  const num = t.match(/\b(\d{1,3})\s+(?:flashcards?|cartes?|questions?)/)?.[1];
  const mk = (type: ArtifactType, settings: StudySettings = {}): StudyIntent => {
    const sec = t.match(/(?:uniquement|seulement)?\s*(?:sur|de|du|des|pour|a propos de)\s+(?:les |la |le |l'|l’)?([a-z0-9' -]{3,60})$/);
    const q = sec?.[1]?.trim();
    return { type, settings, ...(q && !/ce cours|demain|l'examen|l examen|cette seance|reviser/.test(q) ? { sectionQuery: q } : {}) };
  };
  const cmp = t.match(/compar\w*\s+(.+)/);
  if (cmp) {
    const parts = cmp[1]!.split(/,|\bet\b|\bavec\b|\bvs\b/).map((x) => x.replace(/^(les |la |le |l'|ces |trois |deux )+/, '').trim()).filter((x) => x.length > 2 && !/notions?$/.test(x));
    return { type: 'COMPARISON_TABLE', settings: {}, ...(parts.length >= 2 ? { compare: parts } : {}) };
  }
  if (/carte mentale|mindmap|mind map/.test(t)) return mk('MIND_MAP', { depth: /detaill|profond|complete/.test(t) ? 5 : /simple|courte|rapide/.test(t) ? 2 : 3 });
  if (/flashcard|cartes? de revision|cartes memoire/.test(t)) return mk('FLASHCARDS', num ? { count: Number(num) } : {});
  if (/\bquiz\b|qcm|m'?interroge|questions? de revision/.test(t)) return mk('QUIZ', { ...(num ? { count: Number(num) } : {}), ...(/qcm/.test(t) ? { quizKinds: ['mcq'] as QuizKind[] } : {}) });
  if (/chronologie|frise|timeline/.test(t)) return mk('TIMELINE');
  if (/\bmethode\b|etapes? a suivre|demarche/.test(t)) return mk('METHOD');
  if (/tableau/.test(t)) return { type: 'COMPARISON_TABLE', settings: {} };
  if (/schema|diagramme|organigramme|processus/.test(t)) return mk('DIAGRAM', /etapes|procedure|processus/.test(t) ? { diagramType: 'PROCESS' } : {});
  if (/fiche|resume/.test(t)) return mk('COURSE_SHEET', { mode: /tres courte|express|rapide|demain|1 page|une page|resume/.test(t) ? 'express' : /complete|detaillee|approfondie/.test(t) ? 'complete' : 'standard' });
  return null;
}

/** Retrouve la section du cours visée par une demande (« uniquement sur les nullités »). */
export function findSection(tree: CourseTree, query: string) {
  const q = normalize(query);
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  let best: { s: CourseTree['sections'][number]; score: number } | null = null;
  for (const s of tree.sections) {
    const n = normalize(s.title);
    const score = n === q ? 100 : n.includes(q) || q.includes(n) ? 60 : words.filter((w) => n.includes(w.replace(/s$/, ''))).length * 10;
    if (score > (best?.score ?? 0)) best = { s, score };
  }
  return best && best.score >= 10 ? best.s : null;
}
export { treeOf, EmptySourceError };
