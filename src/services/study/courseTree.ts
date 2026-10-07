/**
 * Vue en arbre d'une VERSION du cours reconstruit — l'unique entrée des générateurs d'artefacts.
 * Chaque bloc garde ses `SourceReference` : tout ce qu'un artefact affiche vient donc d'un bloc du cours (donc de ses sources).
 */
import type { CourseSectionNode, GeneratedBlock, GeneratedCourse, SourceConfidence } from '@/domain/course';
import { firstSentence, foldKey, truncate } from '@/services/engine/text';

export interface CBlock extends GeneratedBlock { sectionId: string; sectionPath: string[] }
export interface CNode { id: string; title: string; level: number; path: string[]; titleOrigin: CourseSectionNode['titleOrigin'] | 'course'; blocks: CBlock[]; children: CNode[] }
export interface CourseTree { courseId: string; courseVersion: number; sessionId: string; title: string; root: CNode; sections: CNode[] }

export function treeOf(course: GeneratedCourse): CourseTree {
  const sections: CNode[] = [];
  const conv = (s: CourseSectionNode, parentPath: string[], level: number): CNode => {
    const path = [...parentPath, s.title];
    const n: CNode = { id: s.id, title: s.title, level, path, titleOrigin: s.titleOrigin, blocks: s.blocks.map((b) => ({ ...b, sectionId: s.id, sectionPath: path })), children: [] };
    sections.push(n);
    n.children = s.children.map((c) => conv(c, path, level + 1));
    return n;
  };
  const c = course.content;
  const root: CNode = { id: 'root', title: c.title, level: 0, path: [], titleOrigin: 'course', blocks: [], children: [] };
  root.blocks = [...(c.intro ? [c.intro] : []), ...(c.conclusion ? [c.conclusion] : [])].map((b) => ({ ...b, sectionId: 'root', sectionPath: [] }));
  root.children = c.sections.map((s) => conv(s, [], 1));
  return { courseId: course.id, courseVersion: course.courseVersion, sessionId: course.sessionId, title: c.title, root, sections };
}

export const allBlocks = (n: CNode): CBlock[] => [...n.blocks, ...n.children.flatMap(allBlocks)];
export const allNodes = (n: CNode): CNode[] => n.children.flatMap((c) => [c, ...allNodes(c)]);
export const scopeNode = (t: CourseTree, sectionId?: string): CNode => (sectionId ? t.sections.find((s) => s.id === sectionId) ?? t.root : t.root);

/* ---- classification (déduite du bloc, jamais d'un modèle) */
const CASE_RE = /^(?:Cass\.?|Cour de cassation|Conseil d['’]État|CE\b|CJUE|CEDH|Cons\.?\s*const|Conseil constitutionnel|CA\s|T\.?\s*com)/i;
export const isArticle = (b: GeneratedBlock) => b.kind === 'reference' && /^art(?:icle)?s?\b/i.test(b.label ?? b.text);
export const isCaselaw = (b: GeneratedBlock) => b.kind === 'reference' && CASE_RE.test((b.label ?? b.text).trim());
export const isOtherRef = (b: GeneratedBlock) => b.kind === 'reference' && !isArticle(b) && !isCaselaw(b);
/** Fiabilité suffisante pour servir de BONNE RÉPONSE (flashcard, quiz) : ni incertain, ni en conflit, ni sans source. */
export const reliable = (b: { confidence: SourceConfidence; refs: unknown[] }) => (b.confidence === 'VERIFIED' || b.confidence === 'SUPPORTED') && b.refs.length > 0;

const MONTHS = 'janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre';
const DATE_RE = new RegExp(`(?:\\b\\d{1,2}(?:er)?\\s+(?:${MONTHS})\\s+)?\\b(1[0-9]{3}|20[0-9]{2})\\b`, 'i');
/** Première date réelle du texte (un numéro d'article n'est pas une date). */
export function dateOf(text: string): { label: string; year: number } | null {
  const m = DATE_RE.exec(text);
  if (!m || m.index === undefined) return null;
  const before = text.slice(Math.max(0, m.index - 12), m.index + m[0].length - m[1]!.length);
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 2);
  if (/(art(?:icles?)?\.?|n°|no|l\.|r\.|d\.)\s*$/i.test(before) || /^[-–]?\d/.test(after)) return null;
  return { label: m[0].trim(), year: Number(m[1]) };
}

/** Texte sans l'étiquette répétée en tête (« Dol : manœuvres… » → « manœuvres… »). */
export function bodyOf(b: GeneratedBlock): string {
  const l = b.label?.trim();
  const t = b.text.trim();
  if (l) { const m = new RegExp(`^${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i').exec(t); if (m) return t.slice(m[0].length).trim() || t; }
  return t;
}
export const shortTitle = (b: GeneratedBlock, n = 90) => truncate(b.label ?? firstSentence(b.text, n), n);
export const key = (s: string) => foldKey(s);
