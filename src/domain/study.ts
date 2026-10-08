/**
 * StudyArtifacts — supports de révision DÉRIVÉS du cours reconstruit.
 *
 *   Course Sources → Course Context → Reconstructed Course (GeneratedCourse) → StudyArtifacts
 *
 * Aucun moteur parallèle : un artefact est une transformation déterministe d'une VERSION précise du cours reconstruit.
 * Chaque élément porte les `SourceReference` des blocs du cours dont il vient (notes, PDF p. 14, transcription 01:12:34…),
 * donc le même `SourceBadge` s'applique partout. On stocke la STRUCTURE (jamais une image) : édition, repli, export.
 */
import { z } from 'zod';
import { CONFIDENCE_LEVELS, sourceReferenceSchema, sourceSnapshotSchema, type SourceSnapshot } from './course';

export const ARTIFACT_TYPES = ['COURSE_SHEET', 'MIND_MAP', 'DIAGRAM', 'COMPARISON_TABLE', 'TIMELINE', 'METHOD', 'FLASHCARDS', 'QUIZ'] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export const ARTIFACT_LABELS: Record<ArtifactType, string> = {
  COURSE_SHEET: 'Fiche de révision', MIND_MAP: 'Carte mentale', DIAGRAM: 'Schéma', COMPARISON_TABLE: 'Tableau comparatif',
  TIMELINE: 'Chronologie', METHOD: 'Méthode', FLASHCARDS: 'Flashcards', QUIZ: 'Quiz',
};

const sources = z.array(sourceReferenceSchema).default([]);
const confidence = z.enum(CONFIDENCE_LEVELS).optional();
export const difficultySchema = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof difficultySchema>;
export const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: 'Facile', medium: 'Moyen', hard: 'Difficile' };

/* ------------------------------ fiche ------------------------------ */
export const SHEET_MODES = ['express', 'standard', 'complete'] as const;
export type SheetMode = (typeof SHEET_MODES)[number];
export const SHEET_SECTION_KINDS = ['plan', 'definitions', 'articles', 'caselaw', 'references', 'examples', 'exam', 'methods', 'figures', 'concepts', 'toverify'] as const;
export type SheetSectionKind = (typeof SHEET_SECTION_KINDS)[number];
export const SHEET_SECTION_LABELS: Record<SheetSectionKind, string> = {
  plan: 'Plan', definitions: 'Définitions', references: 'Autres références', articles: 'Articles', caselaw: 'Jurisprudences', examples: 'Exemples du professeur',
  exam: 'Points examen', methods: 'Méthodes', figures: 'Chiffres et dates', concepts: 'Notions', toverify: 'À vérifier',
};
const sheetItem = z.object({ id: z.string(), text: z.string().min(1), label: z.string().optional(), depth: z.number().int().min(0).max(6).optional(), sources, confidence, uncertain: z.boolean().optional() });
export const sheetSchema = z.object({
  mode: z.enum(SHEET_MODES),
  sections: z.array(z.object({ id: z.string(), kind: z.enum(SHEET_SECTION_KINDS), title: z.string().min(1), items: z.array(sheetItem) })),
});
export type SheetContent = z.infer<typeof sheetSchema>;

/* ------------------------------ carte mentale ------------------------------ */
export const MAP_ORIENTATIONS = ['horizontal', 'radial', 'vertical'] as const;
export type MapOrientation = (typeof MAP_ORIENTATIONS)[number];
export const MAP_NODE_TYPES = ['root', 'section', 'concept', 'article', 'caselaw', 'definition', 'example', 'important', 'question'] as const;
export type MindNodeType = (typeof MAP_NODE_TYPES)[number];

export interface MindNode {
  id: string; title: string; description?: string; type: MindNodeType; collapsed?: boolean; uncertain?: boolean;
  confidence?: (typeof CONFIDENCE_LEVELS)[number]; sources: z.infer<typeof sourceReferenceSchema>[]; children: MindNode[];
}
const mindNode: z.ZodType<MindNode> = z.lazy(() => z.object({
  id: z.string(), title: z.string().min(1).max(400), description: z.string().optional(), type: z.enum(MAP_NODE_TYPES),
  collapsed: z.boolean().optional(), uncertain: z.boolean().optional(), confidence, sources, children: z.array(mindNode),
}) as unknown as z.ZodType<MindNode>);
export const mindMapSchema = z.object({ depth: z.number().int().min(1).max(8), orientation: z.enum(MAP_ORIENTATIONS), root: mindNode });
export type MindMapContent = z.infer<typeof mindMapSchema>;

/* ------------------------------ schéma ------------------------------ */
export const DIAGRAM_TYPES = ['PROCESS', 'FLOWCHART', 'HIERARCHY', 'RELATIONSHIP', 'COMPARISON', 'TIMELINE'] as const;
export type DiagramType = (typeof DIAGRAM_TYPES)[number];
export const DIAGRAM_LABELS: Record<DiagramType, string> = {
  PROCESS: 'Processus / méthode', FLOWCHART: 'Raisonnement (décisions)', HIERARCHY: 'Structure / hiérarchie', RELATIONSHIP: 'Relations citées', COMPARISON: 'Comparaison', TIMELINE: 'Chronologie',
};
export const diagramSchema = z.object({
  type: z.enum(DIAGRAM_TYPES),
  direction: z.enum(['vertical', 'horizontal']).default('vertical'),
  nodes: z.array(z.object({
    id: z.string(), label: z.string().min(1).max(400), kind: z.enum(['start', 'step', 'decision', 'end', 'concept', 'note']),
    detail: z.string().optional(), x: z.number().optional(), y: z.number().optional(), sources, confidence, uncertain: z.boolean().optional(),
  })),
  edges: z.array(z.object({
    id: z.string(), from: z.string(), to: z.string(), label: z.string().optional(),
    /** Pourquoi cette flèche existe : ordre du cours, structure (titre → sous-titre), dit explicitement, ou ajoutée par vous. */
    basis: z.enum(['order', 'structure', 'stated', 'inferred']),
    uncertain: z.boolean().optional(),
  })),
}).superRefine((d, ctx) => {
  const ids = new Set(d.nodes.map((n) => n.id));
  d.edges.forEach((e, i) => { if (!ids.has(e.from) || !ids.has(e.to)) ctx.addIssue({ code: 'custom', message: 'arête vers un nœud inexistant', path: ['edges', i] }); });
});
export type DiagramContent = z.infer<typeof diagramSchema>;

/* ------------------------------ tableau ------------------------------ */
const cell = z.object({ text: z.string(), sources, confidence });
export const tableSchema = z.object({
  columns: z.array(z.object({ id: z.string(), title: z.string().min(1), sources })).min(2),
  rows: z.array(z.object({ id: z.string(), label: z.string().min(1), cells: z.record(z.string(), cell) })),
});
export type TableContent = z.infer<typeof tableSchema>;

/* ------------------------------ chronologie ------------------------------ */
export const timelineSchema = z.object({ events: z.array(z.object({ id: z.string(), date: z.string().min(1), label: z.string().min(1), text: z.string().optional(), sources, confidence })) });
export type TimelineContent = z.infer<typeof timelineSchema>;

/* ------------------------------ méthode ------------------------------ */
const methodItem = z.object({ id: z.string(), text: z.string().min(1), sources, confidence });
export const methodSchema = z.object({
  /** Ce que la méthode permet de faire — repris du titre de la partie du cours (jamais inventé). */
  objective: z.object({ text: z.string().min(1), sources }).optional(),
  steps: z.array(methodItem),
  /** Questions que le cours formule lui-même (phrases interrogatives). */
  questions: z.array(methodItem),
  /** Erreurs / pièges que le cours signale explicitement. */
  pitfalls: z.array(methodItem),
  /** Une case par étape (dérivée des étapes, rien d'ajouté). */
  checklist: z.array(z.object({ id: z.string(), text: z.string().min(1), done: z.boolean().default(false), sources })),
});
export type MethodContent = z.infer<typeof methodSchema>;

/* ------------------------------ flashcards / quiz ------------------------------ */
export const flashcardsSchema = z.object({
  cards: z.array(z.object({ id: z.string(), question: z.string().min(1), answer: z.string().min(1), difficulty: difficultySchema, concept: z.string().optional(), sources, confidence })),
});
export type FlashcardsContent = z.infer<typeof flashcardsSchema>;

export const QUIZ_KINDS = ['mcq', 'truefalse', 'short'] as const;
export type QuizKind = (typeof QUIZ_KINDS)[number];
export const QUIZ_KIND_LABELS: Record<QuizKind, string> = { mcq: 'QCM', truefalse: 'Vrai / faux', short: 'Question courte' };
export const quizSchema = z.object({
  questions: z.array(z.object({
    id: z.string(), kind: z.enum(QUIZ_KINDS), prompt: z.string().min(1),
    options: z.array(z.object({ id: z.string(), text: z.string().min(1) })).optional(),
    /** QCM : id de l'option ; vrai/faux : 'true' | 'false' ; court : la réponse attendue (texte du cours). */
    correct: z.string().min(1),
    /** Pourquoi : l'extrait du cours qui justifie la réponse. */
    explanation: z.string().min(1),
    difficulty: difficultySchema, concept: z.string().optional(), sources, confidence,
  }).superRefine((q, ctx) => {
    if (q.kind === 'mcq' && !(q.options && q.options.length >= 3 && q.options.some((o) => o.id === q.correct))) ctx.addIssue({ code: 'custom', message: 'QCM : au moins 3 options dont la bonne réponse' });
    if (q.kind === 'truefalse' && q.correct !== 'true' && q.correct !== 'false') ctx.addIssue({ code: 'custom', message: 'vrai/faux : réponse true|false' });
  })),
});
export type QuizContent = z.infer<typeof quizSchema>;

export type ArtifactContent = SheetContent | MindMapContent | DiagramContent | TableContent | TimelineContent | MethodContent | FlashcardsContent | QuizContent;

const SCHEMAS = {
  COURSE_SHEET: sheetSchema, MIND_MAP: mindMapSchema, DIAGRAM: diagramSchema, COMPARISON_TABLE: tableSchema,
  TIMELINE: timelineSchema, METHOD: methodSchema, FLASHCARDS: flashcardsSchema, QUIZ: quizSchema,
} as const;
export type ContentFor<T extends ArtifactType> =
  T extends 'COURSE_SHEET' ? SheetContent : T extends 'MIND_MAP' ? MindMapContent : T extends 'DIAGRAM' ? DiagramContent
  : T extends 'COMPARISON_TABLE' ? TableContent : T extends 'TIMELINE' ? TimelineContent : T extends 'METHOD' ? MethodContent
  : T extends 'FLASHCARDS' ? FlashcardsContent : QuizContent;

export class ArtifactValidationError extends Error {
  constructor(readonly type: ArtifactType, readonly issues: string[]) { super(`Contenu invalide pour ${ARTIFACT_LABELS[type]} : ${issues.slice(0, 3).join(' ; ')}`); this.name = 'ArtifactValidationError'; }
}
/** Rien n'est affiché ni enregistré sans être passé par ici. */
export function validateContent<T extends ArtifactType>(type: T, raw: unknown): ContentFor<T> {
  const res = SCHEMAS[type].safeParse(raw);
  if (!res.success) throw new ArtifactValidationError(type, res.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`));
  return res.data as ContentFor<T>;
}

/* ------------------------------ réglages ------------------------------ */
export interface ArtifactScope { sectionId?: string; sectionTitle?: string }

export interface StudySettings {
  mode?: SheetMode;
  /** Carte mentale : nombre de niveaux de titres affichés (1–8). */
  depth?: number;
  orientation?: MapOrientation;
  diagramType?: DiagramType;
  /** Tableau : identifiants des sections du cours à comparer. */
  conceptIds?: string[];
  /** Flashcards / quiz : nombre voulu (10 / 20 / 30 / personnalisé). */
  count?: number;
  /** Quiz : niveau et types de questions. */
  level?: Difficulty | 'all';
  quizKinds?: QuizKind[];
  /** Affichage des sources (préférence d'affichage, pas de contenu). */
  showSources?: boolean;
}

export const artifactProvenanceSchema = z.object({
  /** Toujours « cours reconstruit » : un artefact n'a pas d'autre origine. */
  from: z.literal('reconstructed-course'),
  courseId: z.string(), courseVersion: z.number(), generatedAt: z.string(),
  sources: z.array(z.object({ id: z.string(), kind: z.string(), label: z.string() })),
});
export type ArtifactProvenance = z.infer<typeof artifactProvenanceSchema>;

export interface StudyArtifact {
  id: string;
  userId: string;
  type: ArtifactType;
  title: string;
  subjectId: string | null;
  /** Séance du cours (`courseSessionId`). */
  sourceSessionIds: string[];
  scope: ArtifactScope | null;
  settings: StudySettings;
  /** Version courante (éventuellement modifiée par l'utilisateur). */
  content: ArtifactContent;
  /** Version générée, jamais modifiée : « revenir à la version générée ». */
  generatedContent: ArtifactContent | null;
  /** Cours reconstruit dont l'artefact est dérivé. */
  courseId: string;
  courseVersion: number;
  /** Instantané des sources du cours au moment de la génération. */
  sourceSnapshot: SourceSnapshot;
  engineVersion: string;
  provenance: ArtifactProvenance;
  /** Numéro de génération (1, 2…) : incrémenté à chaque régénération acceptée. */
  generation: number;
  userEdited: boolean;
  createdAt: string;
  updatedAt: string;
  version?: number;
  dirty?: boolean;
}
export { sourceSnapshotSchema };
