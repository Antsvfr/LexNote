import { z } from 'zod';
import { INTEGRATION_VERSION } from './version';

/** Codes d'erreur PUBLICS. Ensemble ouvert : un consommateur traite tout code inconnu comme `INTERNAL`. */
export const ERROR_CODES = [
  'INVALID_PAYLOAD', 'UNSUPPORTED_VERSION', 'SECRET_DETECTED',
  'UNAUTHENTICATED', 'FORBIDDEN', 'SCOPE_MISSING',
  'LINK_NOT_FOUND', 'LINK_REVOKED', 'LINK_EXPIRED', 'LINK_PENDING',
  'NOT_FOUND', 'CONFLICT', 'GONE',
  'RATE_LIMITED', 'UNAVAILABLE', 'OFFLINE', 'TIMEOUT', 'INTERNAL',
] as const;
export type IntegrationErrorCode = (typeof ERROR_CODES)[number];

/** Codes pour lesquels réessayer a un sens (avec délai croissant) ; les autres exigent une action de l'utilisateur ou un correctif. */
const RETRYABLE: ReadonlySet<IntegrationErrorCode> = new Set(['RATE_LIMITED', 'UNAVAILABLE', 'OFFLINE', 'TIMEOUT', 'INTERNAL']);

export const integrationErrorSchema = z.object({
  integrationVersion: z.string(),
  kind: z.literal('integration-error'),
  code: z.string(),
  /** Message pour un développeur / un journal : jamais affiché tel quel à l'étudiant, jamais de donnée personnelle. */
  message: z.string().max(500),
  retryable: z.boolean(),
  retryAfterSeconds: z.number().int().min(0).max(86_400).optional(),
  correlationId: z.string().max(100).optional(),
  /** Détails non sensibles (noms de champs fautifs, version attendue…). */
  details: z.record(z.string(), z.string().max(300)).optional(),
});
export type IntegrationError = Omit<z.infer<typeof integrationErrorSchema>, 'code'> & { code: IntegrationErrorCode };

export function integrationError(code: IntegrationErrorCode, message: string, extra: Partial<Pick<IntegrationError, 'retryAfterSeconds' | 'correlationId' | 'details'>> = {}): IntegrationError {
  return { integrationVersion: INTEGRATION_VERSION, kind: 'integration-error', code, message: message.slice(0, 500), retryable: RETRYABLE.has(code), ...extra };
}

/** Lue depuis un autre processus : un code inconnu devient `INTERNAL` (ensemble ouvert). */
export function normalizeErrorCode(code: string): IntegrationErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code) ? (code as IntegrationErrorCode) : 'INTERNAL';
}

/** Exception interne portant une erreur publique (les couches basses lèvent ceci ; la frontière la convertit en message). */
export class IntegrationFailure extends Error {
  constructor(readonly error: IntegrationError) { super(`${error.code}: ${error.message}`); this.name = 'IntegrationFailure'; }
}
export const fail = (code: IntegrationErrorCode, message: string, extra?: Parameters<typeof integrationError>[2]): never => { throw new IntegrationFailure(integrationError(code, message, extra)); };
