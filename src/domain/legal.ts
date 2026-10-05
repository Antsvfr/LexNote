/**
 * Modèle juridique de LexNote.
 *
 * Principe fondateur : LexNote distingue TOUJOURS ce que le professeur a dit
 * de ce que l'IA a ajouté, et n'invente JAMAIS silencieusement un article,
 * une jurisprudence ou une règle. Toute information juridique porte donc :
 *   - une provenance  (d'où vient-elle ?)
 *   - un statut de vérification (a-t-elle été vérifiée ?)
 */

export type Provenance =
  | 'PROFESSOR' // dit par le professeur (cours, transcription)
  | 'USER_NOTE' // écrit par l'étudiant
  | 'DOCUMENT' // extrait d'un support importé (PDF/PPT)
  | 'AI' // produit ou ajouté par une IA
  | 'VERIFIED_SOURCE' // issu d'une source officielle vérifiée (Légifrance, etc.)
  | 'UNKNOWN';

export type VerificationStatus = 'VERIFIED' | 'UNVERIFIED' | 'POTENTIAL_CONFLICT' | 'NEEDS_REVIEW';

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  PROFESSOR: 'Professeur',
  USER_NOTE: 'Mes notes',
  DOCUMENT: 'Document',
  AI: 'IA',
  VERIFIED_SOURCE: 'Source vérifiée',
  UNKNOWN: 'Inconnue',
};

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  VERIFIED: 'Verified',
  UNVERIFIED: 'Unverified',
  POTENTIAL_CONFLICT: 'Potential conflict',
  NEEDS_REVIEW: 'Needs review',
};

/** Où retrouver l'origine d'un élément (pour pouvoir toujours "montrer la source"). */
export interface SourceRef {
  sessionId?: string;
  /** Identifiant d'un bloc de notes. */
  blockId?: string;
  documentId?: string;
  /** Intervalle de la transcription, en millisecondes. */
  transcriptRange?: { startMs: number; endMs: number };
  /** Référence externe (URL Légifrance, etc.). */
  url?: string;
}

interface LegalItemBase {
  id: string;
  provenance: Provenance;
  verification: VerificationStatus;
  source?: SourceRef;
  createdAt: string;
  /** Renseigné quand l'élément vient d'une IA : modèle, fournisseur, date. */
  generatedBy?: { providerId: string; model: string; at: string };
}

export interface ArticleOfLaw extends LegalItemBase {
  kind: 'ARTICLE_OF_LAW';
  code?: string; // ex. "Code civil"
  number: string; // ex. "1128"
  text?: string;
}
export interface CaseLaw extends LegalItemBase {
  kind: 'CASE_LAW';
  court: string; // ex. "Cass. civ. 1re"
  date?: string;
  reference?: string;
  name?: string; // ex. "Arrêt Poussin"
  summary?: string;
}
export interface LegalDefinition extends LegalItemBase {
  kind: 'LEGAL_DEFINITION';
  term: string;
  definition: string;
}
export interface LegalRule extends LegalItemBase {
  kind: 'LEGAL_RULE';
  statement: string;
  conditions?: string[];
}
export interface Exception extends LegalItemBase {
  kind: 'EXCEPTION';
  statement: string;
  /** Règle à laquelle l'exception déroge. */
  ruleId?: string;
}
export interface ProfessorExample extends LegalItemBase {
  kind: 'PROFESSOR_EXAMPLE';
  text: string;
}
export interface ImportantPoint extends LegalItemBase {
  kind: 'IMPORTANT_POINT';
  text: string;
}
export interface QuestionToVerify extends LegalItemBase {
  kind: 'QUESTION_TO_VERIFY';
  question: string;
  reason?: string;
}

export type LegalItem =
  | ArticleOfLaw
  | CaseLaw
  | LegalDefinition
  | LegalRule
  | Exception
  | ProfessorExample
  | ImportantPoint
  | QuestionToVerify;

export type LegalItemKind = LegalItem['kind'];

/** Provenances qui ne peuvent jamais, à elles seules, valider une information. */
const SELF_ASSERTED: ReadonlySet<Provenance> = new Set(['AI', 'UNKNOWN']);

/**
 * Applique la règle d'or : une information issue de l'IA (ou d'origine
 * inconnue) ne peut JAMAIS être créée comme "Verified". Seule une source
 * vérifiée peut ensuite la faire passer à Verified (action explicite).
 */
export function resolveInitialVerification(
  provenance: Provenance,
  requested: VerificationStatus = 'UNVERIFIED',
): VerificationStatus {
  if (SELF_ASSERTED.has(provenance) && requested === 'VERIFIED') return 'UNVERIFIED';
  return requested;
}

/** Peut-on afficher cet élément comme fiable, sans avertissement ? */
export function isTrusted(item: Pick<LegalItem, 'provenance' | 'verification'>): boolean {
  return item.verification === 'VERIFIED' && !SELF_ASSERTED.has(item.provenance);
}

/** Un élément ajouté par l'IA doit toujours être signalé visuellement. */
export function mustBeFlagged(item: Pick<LegalItem, 'provenance' | 'verification'>): boolean {
  return item.provenance === 'AI' || item.verification !== 'VERIFIED';
}

/** Types de blocs de notes juridiques (édités dans l'éditeur). */
export type NoteBlockKind = 'article' | 'caselaw' | 'definition' | 'important' | 'example' | 'question';

export const NOTE_BLOCKS: Record<
  NoteBlockKind,
  { label: string; emoji: string; legalKind: LegalItemKind; hint: string }
> = {
  article: { label: 'Article', emoji: '⚖️', legalKind: 'ARTICLE_OF_LAW', hint: 'Texte de loi' },
  caselaw: { label: 'Jurisprudence', emoji: '📚', legalKind: 'CASE_LAW', hint: 'Arrêt, décision' },
  definition: { label: 'Définition', emoji: '💡', legalKind: 'LEGAL_DEFINITION', hint: 'Notion à retenir' },
  important: { label: 'Important', emoji: '⭐', legalKind: 'IMPORTANT_POINT', hint: 'Point clé du cours' },
  example: { label: 'Exemple du professeur', emoji: '🧑‍🏫', legalKind: 'PROFESSOR_EXAMPLE', hint: 'Illustration' },
  question: { label: 'Question / à vérifier', emoji: '❓', legalKind: 'QUESTION_TO_VERIFY', hint: 'À revoir plus tard' },
};

export const NOTE_BLOCK_KINDS = Object.keys(NOTE_BLOCKS) as NoteBlockKind[];
