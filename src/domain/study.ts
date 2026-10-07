/**
 * Supports d'étude (StudyArtifact) — fiches, cartes mentales, schémas, tableaux comparatifs, chronologies, flashcards, quiz.
 *
 * Principes :
 *  - UN modèle pour tous les types (`type` + `content` validé par un schéma strict) ;
 *  - toujours dérivés du contenu réel d'une séance : chaque élément porte ses `sources` ;
 *  - on stocke la STRUCTURE (jamais une image) : édition, repli, réorganisation, export ;
 *  - `aiContent` = version générée ; `content` = version courante (éventuellement modifiée par l'utilisateur).
 */
import { z } from 'zod';
import type { NoteBlockKind } from './legal';

export const ARTIFACT_TYPES = ['COURSE_SHEET', 'MIND_MAP', 'DIAGRAM', 'COMPARISON_TABLE', 'TIMELINE', 'FLASHCARDS', 'QUIZ'] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ARTIFACT_LABELS: Record<ArtifactType, string> = {
  COURSE_SHEET: 'Fiche de cours', MIND_MAP: 'Carte mentale', DIAGRAM: 'Schéma', COMPARISON_TABLE: 'Tableau comparatif',
  TIMELINE: 'Chronologie', FLASHCARDS: 'Flashcards', QUIZ: 'Quiz',
};

/* ------------------------------ sources ------------------------------ */
const NOTE_KINDS = ['article', 'caselaw', 'definition', 'important', 'example', 'question', 'paragraph', 'list', 'step'] as const;
export const sourceSchema = z.object({
  sessionId: z.string(),
  /** Chemin des titres de la séance : « Formation du contrat › Consentement › Dol ». */
  headingPath: z.array(z.string()).default([]),
  /** Extrait EXACT du cours qui justifie l'élément. */
  quote: z.string().max(600).default(''),
  kind: z.enum(NOTE_KINDS).optional(),
  origin: z.enum(['USER_NOTE', 'TRANSCRIPTION', 'DOCUMENT']).default('USER_NOTE'),
  /** Position dans la transcription (ms), si l'élément vient de ce que le professeur a dit. */
  atMs: z.number().optional(),
});
export type ArtifactSource = z.infer<typeof sourceSchema>;
const sources = z.array(sourceSchema).default([]);

/* ------------------------------ fiche ------------------------------ */
export const SHEET_MODES = ['express', 'standard', 'complete'] as const;
export type SheetMode = (typeof SHEET_MODES)[number];
export const SHEET_SECTION_KINDS = ['plan', 'definitions', 'rules', 'articles', 'caselaw', 'examples', 'exam', 'pitfalls', 'toverify', 'concepts', 'summary'] as const;
export type SheetSectionKind = (typeof SHEET_SECTION_KINDS)[number];
export const SHEET_SECTION_LABELS: Record<SheetSectionKind, string> = {
  plan: 'Plan', definitions: 'Définitions', rules: 'Règles', articles: 'Articles', caselaw: 'Jurisprudences', examples: 'Exemples du professeur',
  exam: 'Points examen', pitfalls: 'Pièges', toverify: 'À vérifier', concepts: 'Notions', summary: 'Résumé',
};
const sheetItem = z.object({ id: z.string(), text: z.string().min(1), label: z.string().optional(), sources, uncertain: z.boolean().optional() });
export const sheetSchema = z.object({
  mode: z.enum(SHEET_MODES),
  variant: z.enum(['sheet', 'summary']).default('sheet'),
  objective: z.string().optional(),
  sections: z.array(z.object({ id: z.string(), kind: z.enum(SHEET_SECTION_KINDS), title: z.string().min(1), items: z.array(sheetItem) })),
});
export type SheetContent = z.infer<typeof sheetSchema>;

/* ------------------------------ carte mentale ------------------------------ */
export const MAP_DETAILS = ['simple', 'standard', 'detailed'] as const;
export type MapDetail = (typeof MAP_DETAILS)[number];
export const MAP_ORIENTATIONS = ['horizontal', 'radial', 'vertical'] as const;
export type MapOrientation = (typeof MAP_ORIENTATIONS)[number];
export const MAP_NODE_TYPES = ['root', 'section', 'concept', 'article', 'caselaw', 'definition', 'example', 'important', 'question'] as const;
export type MindNodeType = (typeof MAP_NODE_TYPES)[number];

export interface MindNode {
  id: string;
  title: string;
  description?: string;
  type: MindNodeType;
  collapsed?: boolean;
  uncertain?: boolean;
  sources: ArtifactSource[];
  children: MindNode[];
}
const mindNode: z.ZodType<MindNode> = z.lazy(() => z.object({
  id: z.string(), title: z.string().min(1).max(400), description: z.string().optional(), type: z.enum(MAP_NODE_TYPES),
  collapsed: z.boolean().optional(), uncertain: z.boolean().optional(), sources, children: z.array(mindNode),
}) as unknown as z.ZodType<MindNode>);
export const mindMapSchema = z.object({ detail: z.enum(MAP_DETAILS), orientation: z.enum(MAP_ORIENTATIONS), root: mindNode });
export type MindMapContent = z.infer<typeof mindMapSchema>;

/* ------------------------------ schéma ------------------------------ */
export const DIAGRAM_TYPES = ['PROCESS', 'FLOWCHART', 'HIERARCHY', 'RELATIONSHIP', 'COMPARISON', 'TIMELINE'] as const;
export type DiagramType = (typeof DIAGRAM_TYPES)[number];
export const DIAGRAM_LABELS: Record<DiagramType, string> = {
  PROCESS: 'Processus', FLOWCHART: 'Raisonnement (décisions)', HIERARCHY: 'Hiérarchie', RELATIONSHIP: 'Relations', COMPARISON: 'Comparaison', TIMELINE: 'Chronologie',
};
export const diagramSchema = z.object({
  type: z.enum(DIAGRAM_TYPES),
  direction: z.enum(['vertical', 'horizontal']).default('vertical'),
  nodes: z.array(z.object({
    id: z.string(), label: z.string().min(1).max(400), kind: z.enum(['start', 'step', 'decision', 'end', 'concept', 'note']),
    detail: z.string().optional(), x: z.number().optional(), y: z.number().optional(), sources, uncertain: z.boolean().optional(),
  })),
  edges: z.array(z.object({
    id: z.string(), from: z.string(), to: z.string(), label: z.string().optional(),
    /** Pourquoi cette flèche existe : ordre du cours, structure (titre → sous-titre), dit explicitement, ou déduite (incertain). */
    basis: z.enum(['order', 'structure', 'stated', 'inferred']),
    uncertain: z.boolean().optional(),
  })),
}).superRefine((d, ctx) => {
  const ids = new Set(d.nodes.map((n) => n.id));
  d.edges.forEach((e, i) => { if (!ids.has(e.from) || !ids.has(e.to)) ctx.addIssue({ code: 'custom', message: 'arête vers un nœud inexistant', path: ['edges', i] }); });
});
export type DiagramContent = z.infer<typeof diagramSchema>;

/* ------------------------------ tableau ------------------------------ */
const cell = z.object({ text: z.string(), sources });
export const tableSchema = z.object({
  columns: z.array(z.object({ id: z.string(), title: z.string().min(1), sources })).min(2),
  rows: z.array(z.object({ id: z.string(), label: z.string().min(1), cells: z.record(z.string(), cell) })),
});
export type TableContent = z.infer<typeof tableSchema>;

/* ------------------------------ chronologie / flashcards / quiz ------------------------------ */
export const timelineSchema = z.object({ events: z.array(z.object({ id: z.string(), date: z.string(), label: z.string().min(1), text: z.string().optional(), sources })) });
export type TimelineContent = z.infer<typeof timelineSchema>;
export const flashcardsSchema = z.object({ cards: z.array(z.object({ id: z.string(), front: z.string().min(1), back: z.string().min(1), sources })) });
export type FlashcardsContent = z.infer<typeof flashcardsSchema>;
export const quizSchema = z.object({ questions: z.array(z.object({ id: z.string(), prompt: z.string().min(1), answer: z.string().min(1), sources })) });
export type QuizContent = z.infer<typeof quizSchema>;

export type ArtifactContent = SheetContent | MindMapContent | DiagramContent | TableContent | TimelineContent | FlashcardsContent | QuizContent;

const SCHEMAS = {
  COURSE_SHEET: sheetSchema, MIND_MAP: mindMapSchema, DIAGRAM: diagramSchema, COMPARISON_TABLE: tableSchema,
  TIMELINE: timelineSchema, FLASHCARDS: flashcardsSchema, QUIZ: quizSchema,
} as const;

export type ContentFor<T extends ArtifactType> =
  T extends 'COURSE_SHEET' ? SheetContent : T extends 'MIND_MAP' ? MindMapContent : T extends 'DIAGRAM' ? DiagramContent
  : T extends 'COMPARISON_TABLE' ? TableContent : T extends 'TIMELINE' ? TimelineContent : T extends 'FLASHCARDS' ? FlashcardsContent : QuizContent;

export class ArtifactValidationError extends Error {
  constructor(readonly type: ArtifactType, readonly issues: string[]) { super(`Contenu invalide pour ${ARTIFACT_LABELS[type]} : ${issues.slice(0, 3).join(' ; ')}`); this.name = 'ArtifactValidationError'; }
}

/** Valide (et normalise) un contenu — rien n'est affiché ni enregistré sans être passé par ici. */
export function validateContent<T extends ArtifactType>(type: T, raw: unknown): ContentFor<T> {
  const res = SCHEMAS[type].safeParse(raw);
  if (!res.success) throw new ArtifactValidationError(type, res.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`));
  return res.data as ContentFor<T>;
}

/* ------------------------------ entité ------------------------------ */
export interface ArtifactScope {
  /** Identifiant de la section du cours choisie (absent = cours entier). */
  sectionId?: string;
  sectionTitle?: string;
}

export interface StudyArtifact {
  id: string;
  userId: string;
  type: ArtifactType;
  title: string;
  subjectId: string | null;
  /** Une ou plusieurs séances sources (multi-séances prévu ; la génération n'en exploite qu'une pour l'instant). */
  sourceSessionIds: string[];
  scope: ArtifactScope | null;
  options: Record<string, unknown>;
  /** Version courante (modifiable). */
  content: ArtifactContent;
  /** Version générée, jamais modifiée : permet « revenir à la version générée ». */
  aiContent: ArtifactContent | null;
  /** Empreinte du texte source au moment de la génération : détecte « le cours a été mis à jour ». */
  sourceHash: string;
  userEdited: boolean;
  generatedBy: { providerId: string; label: string; at: string } | null;
  createdAt: string;
  updatedAt: string;
  version?: number;
  dirty?: boolean;
}

export const kindToNodeType = (k: NoteBlockKind | string): MindNodeType =>
  (['article', 'caselaw', 'definition', 'example', 'important', 'question'] as const).includes(k as never) ? (k as MindNodeType) : 'concept';
