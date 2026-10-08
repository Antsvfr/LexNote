import { z } from 'zod';
import { APPS, connectionStateSchema, courseProgressEventSchema, linkRequestSchema, linkResponseSchema, externalCourseEventSchema, integrationIdentitySchema, lexNoteSessionReferenceSchema, studyArtifactReferenceSchema } from './contracts';
import { fail, integrationError, integrationErrorSchema, IntegrationFailure, type IntegrationError } from './errors';
import { findSecrets } from './security';
import { INTEGRATION_VERSION, isSupportedVersion, majorOf } from './version';

const payloadSchema = z.discriminatedUnion('kind', [
  externalCourseEventSchema, lexNoteSessionReferenceSchema, studyArtifactReferenceSchema, courseProgressEventSchema, integrationIdentitySchema, integrationErrorSchema, linkRequestSchema, linkResponseSchema, connectionStateSchema,
]);
export type IntegrationPayload = z.infer<typeof payloadSchema>;
export type PayloadKind = IntegrationPayload['kind'];

/**
 * Enveloppe : la SEULE forme qui circule entre les deux applications. Elle identifie la liaison (`linkId`) mais n'authentifie rien par elle-même :
 * l'authentification est portée par le canal (appel serveur → serveur ou grant signé, docs §5), jamais par un champ de l'enveloppe.
 */
export const envelopeSchema = z.object({
  integrationVersion: z.string(),
  messageId: z.string().min(8).max(100),
  issuedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  from: z.enum(APPS),
  to: z.enum(APPS),
  linkId: z.string().min(1).max(128),
  correlationId: z.string().max(100).optional(),
  payload: payloadSchema,
}).refine((e) => e.from !== e.to, { message: 'from et to identiques', path: ['to'] });
export type IntegrationEnvelope = z.infer<typeof envelopeSchema>;

export interface EnvelopeInit { from: IntegrationEnvelope['from']; to: IntegrationEnvelope['to']; linkId: string; payload: IntegrationPayload; messageId?: string; correlationId?: string; ttlSeconds?: number; now?: Date }

const newMessageId = () => (globalThis.crypto?.randomUUID?.() ?? `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

/** Construit une enveloppe VALIDÉE et sans secret. Lève `IntegrationFailure` sinon (jamais d'envoi partiel). */
export function makeEnvelope(init: EnvelopeInit): IntegrationEnvelope {
  const now = init.now ?? new Date();
  const env = {
    integrationVersion: INTEGRATION_VERSION, messageId: init.messageId ?? newMessageId(), issuedAt: now.toISOString(),
    ...(init.ttlSeconds ? { expiresAt: new Date(now.getTime() + init.ttlSeconds * 1000).toISOString() } : {}),
    from: init.from, to: init.to, linkId: init.linkId, ...(init.correlationId ? { correlationId: init.correlationId } : {}), payload: init.payload,
  };
  if (findSecrets(env).length) fail('SECRET_DETECTED', 'Une valeur ressemblant à un secret a été refusée avant envoi.', { details: { paths: findSecrets(env).map((f) => f.path).slice(0, 5).join(',') } });
  const res = envelopeSchema.safeParse(env);
  if (!res.success) return fail('INVALID_PAYLOAD', 'Enveloppe sortante invalide.', { details: { issues: res.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join(' | ').slice(0, 290) } });
  return res.data;
}

export type ParseResult = { ok: true; envelope: IntegrationEnvelope } | { ok: false; error: IntegrationError };

/**
 * Lit une enveloppe REÇUE (donnée non fiable). Ordre : secrets → version → forme → expiration.
 * Les champs inconnus sont retirés (extensibilité) ; un majeur inconnu est refusé AVANT toute interprétation du reste.
 */
export function parseEnvelope(raw: unknown, now: Date = new Date()): ParseResult {
  const secrets = findSecrets(raw);
  if (secrets.length) return { ok: false, error: integrationError('SECRET_DETECTED', 'Message refusé : il contient une valeur ressemblant à un secret.', { details: { paths: secrets.map((f) => f.path).slice(0, 5).join(',') } }) };
  const v = (raw && typeof raw === 'object' ? (raw as { integrationVersion?: unknown }).integrationVersion : undefined);
  if (typeof v !== 'string' || !isSupportedVersion(v)) {
    return { ok: false, error: integrationError('UNSUPPORTED_VERSION', 'Version d’intégration non prise en charge.', { details: { received: String(v).slice(0, 40), supported: INTEGRATION_VERSION, receivedMajor: String(typeof v === 'string' ? majorOf(v) : null) } }) };
  }
  const res = envelopeSchema.safeParse(raw);
  if (!res.success) return { ok: false, error: integrationError('INVALID_PAYLOAD', 'Message invalide.', { details: { issues: res.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join(' | ').slice(0, 290) } }) };
  const e = res.data;
  if (e.expiresAt && Date.parse(e.expiresAt) < now.getTime()) return { ok: false, error: integrationError('GONE', 'Message expiré.', { correlationId: e.correlationId }) };
  return { ok: true, envelope: e };
}

/** Déballage typé d'un payload attendu. */
export function expectPayload<K extends PayloadKind>(env: IntegrationEnvelope, kind: K): Extract<IntegrationPayload, { kind: K }> {
  if (env.payload.kind !== kind) fail('INVALID_PAYLOAD', `Charge utile « ${kind} » attendue.`, { details: { received: env.payload.kind } });
  return env.payload as Extract<IntegrationPayload, { kind: K }>;
}
export { IntegrationFailure };
