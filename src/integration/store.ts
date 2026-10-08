/**
 * Accès aux tables d'intégration. Une seule implémentation de production : appels `rpc` des fonctions SQL `integration_*`
 * (atomiques, réservées à la clé service role). Le client est injecté (supabase-js en production, un adaptateur PGlite en test).
 */
import { fail } from './errors';

export type LinkRowStatus = 'PENDING' | 'CONNECTED' | 'REVOKED' | 'ERROR';
export interface LinkRow {
  linkId: string; userId: string; provider: string; status: LinkRowStatus;
  localReference: string; externalReference: string;
  linkedAt: string | null; revokedAt: string | null; revokedBy: 'self' | 'partner' | null; errorCode: string | null;
  createdAt: string; updatedAt: string;
}
/** Raisons renvoyées par les fonctions SQL. */
export type Reason = 'OK' | 'NOT_FOUND' | 'EXPIRED' | 'NONCE_MISMATCH' | 'CANCELLED' | 'CONFIRMED' | 'USED' | 'ALREADY_LINKED' | 'REPLAY' | 'PENDING' | 'CONNECTED' | 'REVOKED' | 'ERROR';

export interface LinkStore {
  startIntent(userId: string, nonceHash: string, ttlSeconds: number): Promise<{ reason: Reason; intentId?: string; expiresAt?: string }>;
  cancelIntents(userId: string): Promise<void>;
  inspectIntent(intentId: string, nonceHash: string): Promise<{ reason: Reason; displayHint?: string; expiresAt?: string }>;
  redeemIntent(a: { intentId: string; nonceHash: string; provider: string; partnerRef: string; linkId: string; localRef: string }): Promise<{ reason: Reason }>;
  createPendingLink(a: { userId: string; provider: string; linkId: string; localRef: string; partnerRef: string }): Promise<{ reason: Reason }>;
  activateLink(linkId: string, partnerRef: string): Promise<{ reason: Reason }>;
  revokeLink(linkId: string, partnerRef: string | null, by: 'self' | 'partner'): Promise<{ reason: Reason; externalReference?: string }>;
  markError(linkId: string, code: string): Promise<void>;
  getLink(linkId: string, partnerRef: string | null): Promise<LinkRow | null>;
  getUserLink(userId: string): Promise<LinkRow | null>;
  registerNonce(sender: string, nonce: string, expiresAt: Date): Promise<boolean>;
}

export interface RpcClient { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> }

const toRow = (j: Record<string, any>): LinkRow => ({
  linkId: j.link_id, userId: j.user_id, provider: j.provider, status: j.status, localReference: j.local_reference, externalReference: j.external_reference,
  linkedAt: j.linked_at ?? null, revokedAt: j.revoked_at ?? null, revokedBy: j.revoked_by ?? null, errorCode: j.error_code ?? null, createdAt: j.created_at, updatedAt: j.updated_at,
});

export function createRpcStore(db: RpcClient): LinkStore {
  async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, any>> {
    const { data, error } = await db.rpc(fn, args);
    // Le message technique reste dans les journaux du serveur ; l'appelant ne reçoit qu'une erreur publique.
    if (error) { console.error('[integration] rpc', fn, error.message); return fail('UNAVAILABLE', 'Base de données indisponible.'); }
    return (data ?? {}) as Record<string, any>;
  }
  return {
    async startIntent(userId, nonceHash, ttl) { const r = await call('integration_start_intent', { p_user: userId, p_nonce_hash: nonceHash, p_ttl_seconds: ttl }); return { reason: r.reason, intentId: r.intent_id, expiresAt: r.expires_at }; },
    async cancelIntents(userId) { await call('integration_cancel_intents', { p_user: userId }); },
    async inspectIntent(id, hash) { const r = await call('integration_inspect_intent', { p_intent: id, p_nonce_hash: hash }); return { reason: r.reason, displayHint: r.display_hint, expiresAt: r.expires_at }; },
    async redeemIntent(a) { const r = await call('integration_redeem_intent', { p_intent: a.intentId, p_nonce_hash: a.nonceHash, p_provider: a.provider, p_partner_ref: a.partnerRef, p_link_id: a.linkId, p_local_ref: a.localRef }); return { reason: r.reason }; },
    async createPendingLink(a) { const r = await call('integration_create_pending_link', { p_user: a.userId, p_provider: a.provider, p_link_id: a.linkId, p_local_ref: a.localRef, p_partner_ref: a.partnerRef }); return { reason: r.reason }; },
    async activateLink(linkId, partnerRef) { const r = await call('integration_activate_link', { p_link_id: linkId, p_partner_ref: partnerRef }); return { reason: r.reason }; },
    async revokeLink(linkId, partnerRef, by) { const r = await call('integration_revoke_link', { p_link_id: linkId, p_partner_ref: partnerRef, p_by: by }); return { reason: r.reason, externalReference: r.external_reference }; },
    async markError(linkId, code) { await call('integration_mark_error', { p_link_id: linkId, p_code: code }); },
    async getLink(linkId, partnerRef) { const r = await call('integration_get_link', { p_link_id: linkId, p_partner_ref: partnerRef }); return r.reason === 'OK' ? toRow(r.link) : null; },
    async getUserLink(userId) { const r = await call('integration_get_user_link', { p_user: userId }); return r.reason === 'OK' ? toRow(r.link) : null; },
    async registerNonce(sender, nonce, expiresAt) { const r = await call('integration_register_nonce', { p_sender: sender, p_nonce: nonce, p_expires: expiresAt.toISOString() }); return r.reason === 'OK'; },
  };
}
