import type { ConnectionState } from '@/integration/contracts';

/** Actions de l'étudiant exposées par l'Edge Function `integration-link` (le navigateur n'appelle QUE celle-ci, jamais la passerelle). */
export type IntegrationAction = 'inspect' | 'confirm' | 'status' | 'revoke' | 'auto-login' | 'launch-open' | 'launch-signin';
/** `details.reason` : cause technique courte (ex. `gateway-verify-jwt`) affichée en « code » pour le support, jamais un secret. */
export interface IntegrationFailureBody { code: string; message: string; retryable: boolean; details?: Record<string, string> }
/** Session Supabase ORDINAIRE remise par le serveur après une connexion automatique (corps de réponse HTTPS, jamais une URL). */
export interface HandedSession { access_token: string; refresh_token: string; expires_in: number; expires_at: number; token_type: 'bearer' }
export type IntegrationReply =
  | { ok: true; state?: ConnectionState; returnUrl?: string; displayHint?: string; expiresAt?: string; peerNotified?: boolean; sessionId?: string; subjectId?: string; createdSession?: boolean; createdSubject?: boolean; session?: HandedSession }
  | { ok: false; error: IntegrationFailureBody };

export interface IntegrationApi { call(action: IntegrationAction, body?: Record<string, unknown>): Promise<IntegrationReply> }

/**
 * Codes produits CÔTÉ NAVIGATEUR (jamais par le serveur) :
 *  - SESSION_REQUIRED : aucune session LexNote utilisable (absente, ou jeton de rafraîchissement refusé) → il faut se reconnecter ;
 *  - OFFLINE : pas de réseau, impossible de vérifier ou rafraîchir la session.
 */
export const CLIENT_ERROR = { SESSION_REQUIRED: 'SESSION_REQUIRED', OFFLINE: 'OFFLINE' } as const;
