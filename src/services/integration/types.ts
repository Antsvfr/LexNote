import type { ConnectionState } from '@/integration/contracts';

/** Actions de l'étudiant exposées par l'Edge Function `integration-link` (le navigateur n'appelle QUE celle-ci, jamais la passerelle). */
export type IntegrationAction = 'inspect' | 'confirm' | 'status' | 'revoke';
export interface IntegrationFailureBody { code: string; message: string; retryable: boolean }
export type IntegrationReply =
  | { ok: true; state?: ConnectionState; returnUrl?: string; displayHint?: string; expiresAt?: string; peerNotified?: boolean }
  | { ok: false; error: IntegrationFailureBody };

export interface IntegrationApi { call(action: IntegrationAction, body?: Record<string, unknown>): Promise<IntegrationReply> }
