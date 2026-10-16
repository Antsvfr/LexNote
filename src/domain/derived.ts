/**
 * Contenus DÉRIVÉS d'une transcription (résumé, traduction, transcription nettoyée, cours structuré, points clés…).
 *
 *   Transcription originale (jamais modifiée)
 *     → version nettoyée → résumé → traduction → autres supports
 *
 * Ce ne sont pas un second système : ce sont des StudyArtifacts (même table, même synchronisation, même RLS) dont le contenu est
 * un DOCUMENT structuré (blocs) et dont la provenance pointe vers la transcription — et non vers le cours reconstruit.
 * On stocke la structure (titres, paragraphes, définitions, encadrés, tableaux), jamais du HTML : édition, export, impression.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ langues */
/** Langues prioritaires. Ajouter une langue = ajouter une ligne (code BCP 47 court, nom affiché, nom anglais pour le modèle). */
export const LANGUAGES = [
  { code: 'fr', label: 'Français', english: 'French' },
  { code: 'en', label: 'Anglais', english: 'English' },
  { code: 'es', label: 'Espagnol', english: 'Spanish' },
  { code: 'de', label: 'Allemand', english: 'German' },
  { code: 'it', label: 'Italien', english: 'Italian' },
] as const;
export type LanguageCode = string;
export const languageLabel = (code: string | null | undefined) => LANGUAGES.find((l) => l.code === code)?.label ?? (code ? code.toUpperCase() : '—');
export const isKnownLanguage = (code: string) => LANGUAGES.some((l) => l.code === code);

/* ------------------------------------------------------------------ document en blocs */
export const DOC_BLOCK_KINDS = ['heading', 'paragraph', 'bullet', 'numbered', 'definition', 'callout', 'table', 'question'] as const;
export type DocBlockKind = (typeof DOC_BLOCK_KINDS)[number];
/** Encadrés : « À retenir », « Attention », « Passage incertain », « Info ». */
export const CALLOUT_TONES = ['remember', 'warning', 'uncertain', 'info'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];
export const CALLOUT_LABELS: Record<CalloutTone, string> = { remember: 'À retenir', warning: 'Attention', uncertain: 'Passage incertain', info: 'À noter' };

export const docBlockSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(DOC_BLOCK_KINDS),
  /** Texte du bloc (pour un tableau : légende facultative). */
  text: z.string().max(20_000).default(''),
  /** Titre : 1 (titre du document) à 3 ; liste : profondeur 0 à 3. */
  level: z.number().int().min(0).max(3).optional(),
  /** Définition : le terme défini. */
  term: z.string().max(400).optional(),
  tone: z.enum(CALLOUT_TONES).optional(),
  /** Question : réponse attendue (questions d'examen, questions au professeur : facultative). */
  answer: z.string().max(4000).optional(),
  /** Tableau : la première ligne est l'en-tête. */
  rows: z.array(z.array(z.string().max(2000)).max(12)).max(60).optional(),
  /** Le passage source est incertain (mal transcrit, inaudible, ambigu) : affiché comme tel, jamais présenté comme certain. */
  uncertain: z.boolean().optional(),
  /** Instant (ms depuis le début de la séance) du passage source, quand il est connu. */
  startMs: z.number().int().min(0).optional(),
}).superRefine((b, ctx) => {
  if (b.kind === 'table' && !(b.rows && b.rows.length >= 2)) ctx.addIssue({ code: 'custom', message: 'tableau : en-tête + au moins une ligne' });
  if (b.kind !== 'table' && !b.text.trim()) ctx.addIssue({ code: 'custom', message: 'bloc vide' });
  if (b.kind === 'definition' && !b.term?.trim()) ctx.addIssue({ code: 'custom', message: 'définition sans terme' });
});
export type DocBlock = z.infer<typeof docBlockSchema>;

export const docSchema = z.object({
  /** Langue du contenu (code court). */
  language: z.string().min(2).max(12),
  blocks: z.array(docBlockSchema).min(1).max(2000),
});
export type DocContent = z.infer<typeof docSchema>;

/* ------------------------------------------------------------------ provenance */
/** D'où vient le texte traité. Une traduction « du résumé seulement » a pour source un artefact (`parentArtifactId`). */
export const DERIVED_SOURCE_KINDS = ['original', 'clean', 'selection', 'artifact'] as const;
export type DerivedSourceKind = (typeof DERIVED_SOURCE_KINDS)[number];
export const DERIVED_SOURCE_LABELS: Record<DerivedSourceKind, string> = {
  original: 'transcription originale', clean: 'transcription nettoyée', selection: 'passage sélectionné', artifact: 'support existant',
};

export const generatorSchema = z.object({
  /** 'lexnote-local' (règles, sans IA) ou fournisseur distant ('remote:<id>'). */
  providerId: z.string().min(1),
  model: z.string(),
  /** Vrai si produit sur l'appareil, sans aucun envoi. */
  local: z.boolean(),
});
export type GeneratorInfo = z.infer<typeof generatorSchema>;

export const transcriptProvenanceSchema = z.object({
  from: z.literal('transcript'),
  sessionId: z.string(),
  /** Empreinte de la transcription au moment de la génération (segments + textes). */
  transcriptVersion: z.string(),
  sourceKind: z.enum(DERIVED_SOURCE_KINDS),
  parentArtifactId: z.string().optional(),
  /** Passage traité (sélection) : bornes en ms. */
  range: z.object({ startMs: z.number(), endMs: z.number() }).optional(),
  generationType: z.string(),
  generator: generatorSchema,
  /** Langue du contenu produit ; `sourceLanguage` : langue du texte traité, si connue. */
  language: z.string(),
  sourceLanguage: z.string().optional(),
  /** Réglages choisis (type de résumé, langue cible…). */
  options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** Nombre de mots traités et nombre de parties (découpage d'une longue transcription). */
  inputWords: z.number().int().min(0),
  parts: z.number().int().min(1),
  generatedAt: z.string(),
});
export type TranscriptProvenance = z.infer<typeof transcriptProvenanceSchema>;

/* ------------------------------------------------------------------ versions */
/** Version antérieure conservée à chaque régénération : rien n'est jamais écrasé sans trace. */
export interface ArtifactRevision {
  generation: number;
  title: string;
  content: unknown;
  userEdited: boolean;
  savedAt: string;
  generator?: GeneratorInfo;
}
/** Nombre de versions antérieures conservées par support (les plus anciennes sont retirées au-delà). */
export const MAX_REVISIONS = 10;
