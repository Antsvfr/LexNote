/**
 * Contrats PUBLICS REV-EM ⇄ LexNote — `lexnote-revem/v1`.
 *
 * Ce fichier est volontairement AUTONOME (seule dépendance : zod) : il peut être copié tel quel dans l'autre dépôt.
 * Il ne référence AUCUN type interne (ni Supabase, ni colonnes, ni store) : les applications ne partagent que ces formes.
 *
 * Principes :
 *  - minimisation : jamais de contenu de cours (notes, transcription, texte de document) — uniquement des RÉFÉRENCES (titres, compteurs, liens) ;
 *  - identifiants opaques : une `…Ref` est un texte stable à ne jamais interpréter ni réutiliser comme clé de base de données de l'autre côté ;
 *  - aucun jeton, aucune clé, aucun e-mail : l'identité d'une liaison est un pseudonyme propre à la liaison ;
 *  - extensible : un lecteur IGNORE les champs inconnus (zod les retire) ; un producteur n'émet que les champs documentés.
 */
import { z } from 'zod';

export const APPS = ['lexnote', 'revem'] as const;
export type IntegrationApp = (typeof APPS)[number];
const app = z.enum(APPS);

const isoDateTime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** Identifiant opaque : visible, sans espace, borné. */
const ref = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:~@-]+$/);
const title = z.string().min(1).max(300);

/* ------------------------------------------------------------------ identité / liaison */

/** Droits accordés PAR l'étudiant à une liaison. Chacun est révocable ; aucun ne donne accès au contenu des cours. */
export const SCOPES = [
  'planning:read-events',        // LexNote lit les évènements de planning de REV-EM
  'sessions:read-references',    // REV-EM lit les références de séances LexNote
  'artifacts:read-references',   // REV-EM lit les références de supports LexNote
  'progress:write-events',       // LexNote pousse des évènements de progression vers REV-EM
  'progress:read-summary',       // lecture d'un résumé de progression
] as const;
export type IntegrationScope = (typeof SCOPES)[number];

export const LINK_STATUSES = ['PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED'] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

/**
 * Identité d'une liaison, vue depuis UNE application. L'étudiant a deux comptes indépendants ; la liaison les relie par des pseudonymes
 * générés aléatoirement à la liaison (jamais l'UUID Supabase, jamais l'e-mail) : rien ne permet de retrouver un compte à partir de l'autre.
 */
export const integrationIdentitySchema = z.object({
  integrationVersion: z.string(),
  kind: z.literal('integration-identity'),
  /** Application qui émet cette identité. */
  app,
  /** Identifiant de liaison, commun aux deux côtés. */
  linkId: ref,
  /** Pseudonyme de l'étudiant DANS cette liaison, côté émetteur. */
  userRef: ref,
  /** Pseudonyme du partenaire, une fois la liaison confirmée par les deux côtés. */
  partnerUserRef: ref.nullable(),
  displayName: z.string().max(80).optional(),
  scopes: z.array(z.enum(SCOPES)).max(SCOPES.length),
  status: z.enum(LINK_STATUSES),
  linkedAt: isoDateTime.nullable(),
  expiresAt: isoDateTime.nullable(),
});
export type IntegrationIdentity = z.infer<typeof integrationIdentitySchema>;

/** Référence à une matière de l'une des deux applications (jamais fusionnées : deux références, éventuellement appariées par l'étudiant). */
export const externalSubjectRefSchema = z.object({ app, ref, name: title, color: z.string().max(30).optional() });
export type ExternalSubjectRef = z.infer<typeof externalSubjectRefSchema>;

/* ------------------------------------------------------------------ REV-EM → LexNote : planning */

export const SESSION_TYPE_HINTS = ['CM', 'TD', 'TP', 'COURSE', 'SEMINAR', 'WORKSHOP', 'REVISION', 'OTHER'] as const;
export const CALENDAR_SOURCES = ['ics', 'manual', 'brightspace', 'other'] as const;

/**
 * Un cours du planning de REV-EM, tel qu'il peut devenir une séance LexNote. `externalId` est l'identifiant STABLE de l'évènement
 * côté REV-EM (UID du flux ICS quand il existe) : il sert à dédupliquer, jamais à retrouver une ligne en base.
 */
export const externalCourseEventSchema = z.object({
  integrationVersion: z.string(),
  kind: z.literal('external-course-event'),
  origin: app,
  externalId: ref,
  title,
  /** Instants avec fuseau. Un évènement « toute la journée » utilise `allDay` et des dates à minuit local. */
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  allDay: z.boolean().default(false),
  location: z.string().max(200).optional(),
  teacher: z.string().max(120).optional(),
  sessionTypeHint: z.enum(SESSION_TYPE_HINTS).optional(),
  subject: externalSubjectRefSchema.optional(),
  calendarSource: z.enum(CALENDAR_SOURCES).default('other'),
  cancelled: z.boolean().default(false),
  updatedAt: isoDateTime,
}).refine((e) => Date.parse(e.endsAt) >= Date.parse(e.startsAt), { message: 'endsAt avant startsAt', path: ['endsAt'] });
export type ExternalCourseEvent = z.infer<typeof externalCourseEventSchema>;

/* ------------------------------------------------------------------ liens profonds */

export const DEEP_LINK_KINDS = ['session', 'course', 'review', 'artifact', 'subject', 'chapter', 'planning-event'] as const;
export type DeepLinkKind = (typeof DEEP_LINK_KINDS)[number];
/** Cible symbolique : l'application destinataire est seule à savoir en faire une URL (REV-EM n'a pas de routeur d'URL aujourd'hui). */
export const deepLinkTargetSchema = z.object({ app, kind: z.enum(DEEP_LINK_KINDS), ref });
export type DeepLinkTarget = z.infer<typeof deepLinkTargetSchema>;
/** Lien prêt à ouvrir : l'origine est vérifiée contre une liste blanche AVANT d'être émise ou suivie (voir links.ts). */
const deepLinkUrl = z.string().url().max(500);

/* ------------------------------------------------------------------ LexNote → REV-EM : références */

export const lexNoteSessionReferenceSchema = z.object({
  integrationVersion: z.string(),
  kind: z.literal('lexnote-session-reference'),
  sessionRef: ref,
  /** `externalId` de l'évènement REV-EM dont la séance est issue, si l'étudiant les a liés. */
  linkedExternalId: ref.nullable(),
  title,
  sessionType: z.enum(SESSION_TYPE_HINTS),
  number: z.number().int().min(0).nullable(),
  date: isoDate,
  startTime: hhmm.optional(),
  endTime: hhmm.optional(),
  status: z.enum(['in_progress', 'completed']),
  subject: externalSubjectRefSchema,
  /** Compteurs et indicateurs : aucune donnée de contenu. */
  flags: z.object({ hasNotes: z.boolean(), hasTranscript: z.boolean(), sourceCount: z.number().int().min(0) }),
  course: z.object({ latestVersion: z.number().int().min(1).nullable(), generatedAt: isoDateTime.nullable() }),
  artifactCount: z.number().int().min(0),
  updatedAt: isoDateTime,
  links: z.object({ session: deepLinkUrl, course: deepLinkUrl, review: deepLinkUrl }),
});
export type LexNoteSessionReference = z.infer<typeof lexNoteSessionReferenceSchema>;

export const ARTIFACT_KINDS = ['COURSE_SHEET', 'MIND_MAP', 'DIAGRAM', 'COMPARISON_TABLE', 'TIMELINE', 'METHOD', 'FLASHCARDS', 'QUIZ'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const studyArtifactReferenceSchema = z.object({
  integrationVersion: z.string(),
  kind: z.literal('study-artifact-reference'),
  artifactRef: ref,
  artifactType: z.enum(ARTIFACT_KINDS),
  title,
  sessionRef: ref,
  courseVersion: z.number().int().min(1),
  generation: z.number().int().min(1),
  userEdited: z.boolean(),
  /** Un cours plus récent existe : le support peut être régénéré. */
  stale: z.boolean(),
  itemCount: z.number().int().min(0),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  link: deepLinkUrl,
});
export type StudyArtifactReference = z.infer<typeof studyArtifactReferenceSchema>;

/* ------------------------------------------------------------------ progression */

export const PROGRESS_KINDS = ['SESSION_CAPTURED', 'COURSE_RECONSTRUCTED', 'ARTIFACT_CREATED', 'ARTIFACT_STUDIED', 'FLASHCARDS_REVIEWED', 'QUIZ_COMPLETED'] as const;
export type ProgressKind = (typeof PROGRESS_KINDS)[number];

const count = z.number().int().min(0).max(1_000_000);
/**
 * Évènement de progression, IDEMPOTENT : `eventId` est calculé de façon déterministe par l'émetteur (voir `progressEventId`),
 * le rejouer (hors ligne, double envoi) ne crée jamais de doublon côté récepteur.
 */
export const courseProgressEventSchema = z.object({
  integrationVersion: z.string(),
  kind: z.literal('course-progress-event'),
  eventId: ref,
  progressKind: z.enum(PROGRESS_KINDS),
  occurredAt: isoDateTime,
  sessionRef: ref,
  artifactRef: ref.optional(),
  metrics: z.object({
    answered: count.optional(), correct: count.optional(), itemsReviewed: count.optional(),
    durationSeconds: z.number().int().min(0).max(86_400).optional(), scorePct: z.number().min(0).max(100).optional(),
  }).refine((m) => m.correct === undefined || m.answered === undefined || m.correct <= m.answered, { message: 'correct > answered' }).default({}),
});
export type CourseProgressEvent = z.infer<typeof courseProgressEventSchema>;

/** Identifiant déterministe : mêmes entrées ⇒ même identifiant (empreinte non cryptographique, suffisante pour la déduplication). */
export function progressEventId(p: { progressKind: ProgressKind; sessionRef: string; artifactRef?: string; occurredAt: string }): string {
  const s = `${p.progressKind}|${p.sessionRef}|${p.artifactRef ?? ''}|${p.occurredAt}`;
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `pe_${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}
