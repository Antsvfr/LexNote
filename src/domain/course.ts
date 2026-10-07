/**
 * Modèle de l'« Intelligent Course Engine ».
 *
 *   Sources → Extraction → Normalisation → Context Builder → Structure Analyzer → Course Generator → Validation → GeneratedCourse
 *
 * Principes :
 *  - une SOURCE est immuable (notes, transcription, document) : le moteur ne l'écrit jamais ;
 *  - tout morceau de connaissance (CourseKnowledgeUnit) et tout bloc généré pointe vers ses sources (SourceReference → SourceChunk → SourceLocation) ;
 *  - le cours reconstruit (GeneratedCourse) est un artefact SÉPARÉ, versionné, avec l'instantané des sources utilisées.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ sources */
export const SOURCE_KINDS = ['NOTES', 'TRANSCRIPT', 'DOCUMENT', 'SESSION'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = { NOTES: 'Notes', TRANSCRIPT: 'Transcription', DOCUMENT: 'Document', SESSION: 'Séance' };

/** Où, précisément, se trouve un passage dans sa source. Seuls les champs pertinents pour le type sont renseignés. */
export const sourceLocationSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  documentId: z.string().optional(),
  documentName: z.string().optional(),
  page: z.number().int().positive().optional(),
  slide: z.number().int().positive().optional(),
  /** Section d'un document sans pagination (Word sans saut de page, texte). */
  section: z.number().int().positive().optional(),
  /** Plage temporelle de la transcription (ms depuis le début de la séance). */
  startMs: z.number().min(0).optional(),
  endMs: z.number().min(0).optional(),
  segmentIds: z.array(z.string()).optional(),
  /** Passage de notes : chemin des titres + extrait de repérage. */
  headingPath: z.array(z.string()).optional(),
  noteBlockId: z.string().optional(),
  anchorId: z.string().optional(),
  markerIds: z.array(z.string()).optional(),
});
export type SourceLocation = z.infer<typeof sourceLocationSchema>;

export interface SourceChunk {
  id: string;
  sessionId: string;
  /** Identifiant de la CourseSource d'où il vient (« notes », « transcript », ou l'id du document). */
  sourceId: string;
  kind: SourceKind;
  text: string;
  location: SourceLocation;
  /** Empreinte du texte normalisé : sert à la déduplication et au traitement incrémental. */
  hash: string;
  /** Ordre de lecture dans la source. */
  order: number;
  /** Estimation de la taille (≈ 1 token / 4 caractères). */
  tokens: number;
  /** Fiabilité intrinsèque de la source de ce passage (ex. confiance de la reconnaissance vocale). */
  quality?: number;
  /** Nature du passage de notes (article, définition, étape, paragraphe…). */
  blockKind?: string;
  /** Autres emplacements où ce MÊME texte apparaît (doublon fusionné). */
  alsoIn?: SourceLocation[];
  /** Segments de transcription reliés par un NoteAnchor (passage de notes ↔ ce qui se disait à ce moment). */
  linkedSegmentIds?: string[];
}

export interface CourseSource {
  id: string;
  kind: SourceKind;
  label: string;
  documentId?: string;
  chunkCount: number;
  wordCount: number;
  /** Empreinte de tout le contenu de la source : détecte « la source a changé ». */
  hash: string;
}

/* ------------------------------------------------------------------ documents importés */
export const DOCUMENT_STATUSES = ['pending', 'processing', 'ready', 'error', 'unsupported'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export type DocumentFormat = 'pdf' | 'pptx' | 'docx' | 'text' | 'image' | 'other';

export interface ExtractedUnit {
  /** 1-based : n° de page (PDF/Word) ou de slide (PowerPoint). */
  index: number;
  /** Titre détecté (titre de slide, titre de section…). */
  title?: string;
  text: string;
}
export interface ExtractedDocument {
  unitLabel: 'page' | 'slide' | 'section';
  /** Nombre total de pages / slides si connu. */
  count?: number;
  units: ExtractedUnit[];
  /** Avertissements non bloquants (page sans texte, image sans OCR…). */
  warnings: string[];
}

/** Métadonnées d'un document importé + son contenu ANALYSÉ. Le fichier original est stocké à part (jamais synchronisé). */
export interface SourceDocument {
  id: string;
  userId: string;
  sessionId: string;
  name: string;
  mime: string;
  format: DocumentFormat;
  size: number;
  status: DocumentStatus;
  error?: string;
  unitLabel: 'page' | 'slide' | 'section';
  /** Pages / slides détectées. */
  count?: number;
  wordCount: number;
  extractorId?: string;
  extraction: ExtractedDocument | null;
  /** Empreinte du fichier original (détecte un doublon / une réanalyse inutile). */
  fileHash: string;
  addedAt: string;
  analyzedAt?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
  dirty?: boolean;
}

/* ------------------------------------------------------------------ références et confiance */
export const CONFIDENCE_LEVELS = ['VERIFIED', 'SUPPORTED', 'UNCERTAIN', 'CONFLICTING', 'MISSING_SOURCE'] as const;
export type SourceConfidence = (typeof CONFIDENCE_LEVELS)[number];
export const CONFIDENCE_LABELS: Record<SourceConfidence, string> = {
  VERIFIED: 'Corroboré', SUPPORTED: 'Appuyé par une source', UNCERTAIN: 'Incertain', CONFLICTING: 'Sources en conflit', MISSING_SOURCE: 'Information non vérifiée dans les sources',
};
export const CONFIDENCE_HELP: Record<SourceConfidence, string> = {
  VERIFIED: 'Confirmé par au moins deux sources indépendantes (ex. notes + document, ou notes + transcription).',
  SUPPORTED: 'Présent dans une source, sans être contredit.',
  UNCERTAIN: 'Une seule source fragile, ou une information (date, chiffre…) qui n’apparaît pas dans les autres sources qui traitent du même sujet.',
  CONFLICTING: 'Deux sources donnent des valeurs différentes : aucune n’est présentée comme exacte.',
  MISSING_SOURCE: 'Aucune source ne permet de confirmer cette information.',
};

export const sourceReferenceSchema = z.object({
  sourceId: z.string(),
  chunkId: z.string(),
  location: sourceLocationSchema,
  /** Extrait EXACT du passage source. */
  quote: z.string().max(700),
});
export type SourceReference = z.infer<typeof sourceReferenceSchema>;

/* ------------------------------------------------------------------ connaissance extraite */
export const KNOWLEDGE_TYPES = [
  'theme', 'definition', 'concept', 'reasoning', 'example', 'figure', 'formula', 'date', 'author', 'reference', 'article', 'caselaw',
  'method_step', 'exam_point', 'ambiguity', 'contradiction', 'incomplete',
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
export const KNOWLEDGE_LABELS: Record<KnowledgeType, string> = {
  theme: 'Thème', definition: 'Définition', concept: 'Concept', reasoning: 'Raisonnement', example: 'Exemple', figure: 'Chiffre', formula: 'Formule', date: 'Date',
  author: 'Auteur', reference: 'Référence', article: 'Article', caselaw: 'Jurisprudence', method_step: 'Étape de méthode', exam_point: 'Point d’examen',
  ambiguity: 'Zone ambiguë', contradiction: 'Contradiction', incomplete: 'Passage incomplet',
};

export interface CourseKnowledgeUnit {
  id: string;
  type: KnowledgeType;
  /** Terme défini, numéro d'article, etc. — repris tel quel de la source. */
  label?: string;
  /** Texte tel qu'il figure dans la source (aucune reformulation). */
  text: string;
  refs: SourceReference[];
  confidence: SourceConfidence;
  /** Position dans le plan de la source (titres). */
  sectionPath: string[];
  /** Pour une contradiction / un doute : l'explication, et les unités concernées. */
  note?: string;
  relatedUnitIds?: string[];
  /** Valeurs (dates, chiffres) trouvées dans `text` : sert à la détection de conflits. */
  values?: string[];
}

/* ------------------------------------------------------------------ cours reconstruit */
export const BLOCK_KINDS = ['definition', 'explanation', 'example', 'important', 'method', 'reference', 'figure', 'verify'] as const;
export type CourseBlockKind = (typeof BLOCK_KINDS)[number];
export const BLOCK_LABELS: Record<CourseBlockKind, string> = {
  definition: 'Définition', explanation: 'Explication', example: 'Exemple', important: 'Point important', method: 'Méthode', reference: 'Références', figure: 'Chiffres et dates', verify: 'À vérifier',
};

export const generatedBlockSchema = z.object({
  id: z.string(),
  kind: z.enum(BLOCK_KINDS),
  label: z.string().optional(),
  text: z.string().min(1),
  /** 'extracted' : texte repris d'une source. 'generated' : produit par le moteur (ex. phrase de liaison) — doit être signalé comme tel. */
  origin: z.enum(['extracted', 'generated']),
  refs: z.array(sourceReferenceSchema),
  confidence: z.enum(CONFIDENCE_LEVELS),
  unitIds: z.array(z.string()),
  note: z.string().optional(),
  /** Pour une méthode : étapes ordonnées. */
  steps: z.array(z.string()).optional(),
  conflict: z.object({ values: z.array(z.object({ value: z.string(), refs: z.array(sourceReferenceSchema) })) }).optional(),
});
export type GeneratedBlock = z.infer<typeof generatedBlockSchema>;

export interface CourseSectionNode {
  id: string;
  title: string;
  level: number;
  /** D'où vient ce titre (notes, plan d'un document, découpage temporel…). */
  titleOrigin: 'notes' | 'document' | 'transcript' | 'engine';
  blocks: GeneratedBlock[];
  children: CourseSectionNode[];
}
const sectionSchema: z.ZodType<CourseSectionNode> = z.lazy(() => z.object({
  id: z.string(), title: z.string().min(1), level: z.number().int().min(1).max(6), titleOrigin: z.enum(['notes', 'document', 'transcript', 'engine']),
  blocks: z.array(generatedBlockSchema), children: z.array(sectionSchema),
}) as unknown as z.ZodType<CourseSectionNode>);

export const sourceSnapshotSchema = z.object({
  sources: z.array(z.object({ id: z.string(), kind: z.enum(SOURCE_KINDS), label: z.string(), hash: z.string(), chunkCount: z.number() })),
  hash: z.string(),
});
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;

export const generatedCourseContentSchema = z.object({
  title: z.string().min(1),
  intro: generatedBlockSchema.optional(),
  sections: z.array(sectionSchema),
  conclusion: generatedBlockSchema.optional(),
  /** Informations à contrôler : zones ambiguës, contradictions, passages incomplets, éléments sans source. */
  toVerify: z.array(generatedBlockSchema),
  stats: z.object({
    chunks: z.number(), units: z.number(), blocks: z.number(),
    byConfidence: z.record(z.string(), z.number()),
    byOrigin: z.record(z.string(), z.number()),
    dropped: z.number(),
  }),
});
export type GeneratedCourseContent = z.infer<typeof generatedCourseContentSchema>;

export interface GeneratedCourse {
  id: string;
  userId: string;
  sessionId: string;
  /** 1, 2, 3… : chaque régénération crée une NOUVELLE version, les anciennes sont conservées. */
  courseVersion: number;
  generatedAt: string;
  engineVersion: string;
  providerId: string;
  providerLabel: string;
  sourceSnapshot: SourceSnapshot;
  content: GeneratedCourseContent;
  createdAt: string;
  updatedAt: string;
  /** Version de synchronisation serveur (≠ `courseVersion`). */
  version?: number;
  dirty?: boolean;
}
