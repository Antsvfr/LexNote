/**
 * Cycle de vie d'une liaison REV-EM ⇄ LexNote. Même code des deux côtés (injecté : configuration, magasin, client du partenaire).
 *
 *   initiateur (REV-EM)                              répondant (LexNote)
 *   startLink ─ intention + nonce (navigateur → ouvre LexNote)
 *                                                    inspect ─▶ INSPECT  (affiche « REV-EM souhaite… »)
 *                                                    confirm ─▶ REDEEM   (intention PENDING→CONFIRMED, liaison PENDING des deux côtés)
 *                                                            ─▶ ACTIVATE (CONNECTED côté initiateur) puis CONNECTED côté répondant
 *   getState ─ STATUS vers le partenaire : « Connecté » seulement si les DEUX côtés le disent.
 */
import type { ConnectionState, LinkRequest, LinkResponse } from './contracts';
import type { IntegrationConfig } from './config';
import { fail, IntegrationFailure, integrationError, normalizeErrorCode, type IntegrationErrorCode } from './errors';
import type { PeerClient } from './peer';
import { randomToken, sha256Hex } from './signing';
import type { LinkRow, LinkStore, Reason } from './store';
import { INTEGRATION_VERSION } from './version';

export const INTENT_TTL_SECONDS = 300;
export const CONFIRM_PATH = (initiator: string) => `integrations/${initiator}/connect`;

const REASON_TO_CODE: Partial<Record<Reason, IntegrationErrorCode>> = {
  NOT_FOUND: 'NOT_FOUND', NONCE_MISMATCH: 'FORBIDDEN', EXPIRED: 'LINK_EXPIRED', CANCELLED: 'GONE', CONFIRMED: 'GONE', USED: 'GONE', ALREADY_LINKED: 'CONFLICT', REVOKED: 'LINK_REVOKED', ERROR: 'CONFLICT', PENDING: 'LINK_PENDING',
};
const failReason = (r: Reason): never => fail(REASON_TO_CODE[r] ?? 'INTERNAL', r === 'ALREADY_LINKED' ? 'Un compte est déjà lié.' : 'Opération de liaison refusée.', { details: { reason: r } });

export interface LinkDeps { cfg: IntegrationConfig; store: LinkStore; peer: PeerClient; now?: () => Date; token?: (bytes: number) => string }

export function createLinkService(d: LinkDeps) {
  const { cfg, store, peer } = d;
  const now = d.now ?? (() => new Date());
  const token = d.token ?? randomToken;
  const base = () => ({ integrationVersion: INTEGRATION_VERSION, kind: 'connection-state' as const, partner: cfg.peer, checkedAt: now().toISOString() });
  const unwrap = async (req: LinkRequest): Promise<LinkResponse> => {
    const r = await peer.send({ ...req, integrationVersion: INTEGRATION_VERSION });
    if (!r.ok) throw new IntegrationFailure({ ...r.error, code: normalizeErrorCode(r.error.code) });
    return r.response;
  };
  const req = (operation: LinkRequest['operation'], extra: Partial<LinkRequest> = {}): LinkRequest => ({ integrationVersion: INTEGRATION_VERSION, kind: 'link-request', operation, ...extra });
  const stateOf = (link: LinkRow | null, peerStatus: ConnectionState['peerStatus'], verified: boolean, errorCode?: string): ConnectionState => {
    if (!link) return { ...base(), state: 'NOT_CONNECTED', localStatus: null, peerStatus: 'UNKNOWN', verified: false };
    const common = { ...base(), linkId: link.linkId, localStatus: link.status, peerStatus, verified };
    switch (link.status) {
      case 'CONNECTED': return { ...common, state: 'CONNECTED', linkedAt: link.linkedAt ?? undefined };
      case 'PENDING': return { ...common, state: 'PENDING' };
      case 'REVOKED': return { ...common, state: 'REVOKED', revokedAt: link.revokedAt ?? undefined, revokedBy: link.revokedBy ?? undefined, linkedAt: link.linkedAt ?? undefined };
      default: return { ...common, state: 'ERROR', errorCode: errorCode ?? link.errorCode ?? 'ERROR' };
    }
  };

  return {
    /* ------------------------------------------------------------------ côté initiateur : action de l'étudiant */
    async startLink(userId: string) {
      const nonce = token(32);
      const r = await store.startIntent(userId, await sha256Hex(nonce), INTENT_TTL_SECONDS);
      if (r.reason !== 'OK' || !r.intentId) return failReason(r.reason);
      const url = new URL(CONFIRM_PATH(cfg.self), cfg.peerAppUrl.endsWith('/') ? cfg.peerAppUrl : `${cfg.peerAppUrl}/`);
      url.searchParams.set('intent', r.intentId);
      url.hash = `n=${nonce}`;                                     // fragment : jamais envoyé à un serveur, absent des en-têtes Referer
      return { linkIntentId: r.intentId, expiresAt: r.expiresAt!, confirmUrl: url.toString() };
    },
    async cancelLink(userId: string) { await store.cancelIntents(userId); },

    /* ------------------------------------------------------------------ côté répondant : action de l'étudiant */
    async inspect(intentId: string, nonce: string) {
      const r = await unwrap(req('INSPECT', { linkIntentId: intentId, nonce }));
      return { displayHint: r.displayHint ?? '', expiresAt: r.expiresAt ?? '' };
    },
    async confirm(userId: string, intentId: string, nonce: string): Promise<ConnectionState> {
      const existing = await store.getUserLink(userId);
      if (existing && existing.status === 'CONNECTED') return failReason('ALREADY_LINKED');
      const localRef = `ref_${token(24)}`;
      const redeemed = await unwrap(req('REDEEM', { linkIntentId: intentId, nonce, senderReference: localRef }));
      if (!redeemed.linkId || !redeemed.receiverReference) return fail('INVALID_PAYLOAD', 'Réponse de liaison incomplète.');
      const linkId = redeemed.linkId;
      const created = await store.createPendingLink({ userId, provider: cfg.peer, linkId, localRef, partnerRef: redeemed.receiverReference });
      if (created.reason !== 'OK') { await peer.send(req('REVOKE', { linkId, senderReference: localRef })); return failReason(created.reason); }
      try { await unwrap(req('ACTIVATE', { linkId, senderReference: localRef })); }
      catch (e) {
        await store.markError(linkId, 'ACTIVATE_FAILED');
        await peer.send(req('REVOKE', { linkId, senderReference: localRef }));     // compensation : pas de liaison à moitié créée
        throw e;
      }
      const act = await store.activateLink(linkId, redeemed.receiverReference);
      if (act.reason !== 'OK') return failReason(act.reason);
      return stateOf(await store.getUserLink(userId), 'CONNECTED', true);
    },

    /* ------------------------------------------------------------------ état (vérifié auprès du partenaire) */
    async getState(userId: string, opts: { probe?: boolean } = {}): Promise<ConnectionState> {
      const link = await store.getUserLink(userId);
      if (!link) return stateOf(null, 'UNKNOWN', false);
      if (link.status !== 'CONNECTED') return stateOf(link, link.status === 'REVOKED' && link.revokedBy === 'partner' ? 'REVOKED' : 'UNKNOWN', false);
      // Jamais « CONNECTED » sans vérification auprès du partenaire : sans sonde, l'état est PENDING (vérification en attente).
      const unverified = (peerStatus: ConnectionState['peerStatus'], code: string, state: 'PENDING' | 'ERROR'): ConnectionState => ({ ...stateOf(link, peerStatus, false), state, ...(state === 'ERROR' ? { errorCode: code } : {}) });
      if (opts.probe === false) return unverified('UNKNOWN', 'NOT_VERIFIED', 'PENDING');
      try {
        const r = await unwrap(req('STATUS', { linkId: link.linkId, senderReference: link.localReference }));
        if (r.status === 'CONNECTED') return stateOf(link, 'CONNECTED', true);
        if (r.status === 'REVOKED') { await store.revokeLink(link.linkId, null, 'partner'); return stateOf(await store.getUserLink(userId), 'REVOKED', false); }
        return unverified(r.status === 'PENDING' ? 'PENDING' : 'UNKNOWN', 'PEER_NOT_ACTIVE', 'PENDING');
      } catch (e) {
        const code = e instanceof IntegrationFailure ? e.error.code : 'INTERNAL';
        if (code === 'LINK_REVOKED') { await store.revokeLink(link.linkId, null, 'partner'); return stateOf(await store.getUserLink(userId), 'REVOKED', false); }
        if (code === 'NOT_FOUND') { await store.markError(link.linkId, 'PEER_MISSING'); return stateOf(await store.getUserLink(userId), 'MISSING', false, 'PEER_MISSING'); }
        return unverified('UNKNOWN', 'PEER_UNREACHABLE', 'ERROR');              // panne transitoire : on ne modifie rien
      }
    },

    /** Révocation : EFFET IMMÉDIAT ici (la passerelle refuse dès lors tout échange), puis information du partenaire au mieux. */
    async revoke(userId: string): Promise<{ state: ConnectionState; peerNotified: boolean }> {
      const link = await store.getUserLink(userId);
      if (!link || link.status === 'REVOKED') return { state: stateOf(link, 'UNKNOWN', false), peerNotified: true };
      await store.revokeLink(link.linkId, null, 'self');
      let peerNotified = false;
      try { await unwrap(req('REVOKE', { linkId: link.linkId, senderReference: link.localReference })); peerNotified = true; } catch { /* le partenaire l'apprendra à son prochain échange */ }
      return { state: stateOf(await store.getUserLink(userId), 'UNKNOWN', false), peerNotified };
    },

    /* ------------------------------------------------------------------ côté serveur : requêtes du partenaire (déjà authentifiées) */
    async handlePeerRequest(r: LinkRequest): Promise<LinkResponse> {
      const ok = (extra: Partial<LinkResponse> = {}): LinkResponse => ({ integrationVersion: INTEGRATION_VERSION, kind: 'link-response', operation: r.operation, ok: true, ...extra });
      const need = <T>(v: T | undefined, what: string): T => (v === undefined ? fail('INVALID_PAYLOAD', `${what} manquant.`) : v);
      switch (r.operation) {
        case 'INSPECT': {
          const x = await store.inspectIntent(need(r.linkIntentId, 'linkIntentId'), await sha256Hex(need(r.nonce, 'nonce')));
          if (x.reason !== 'OK') return failReason(x.reason);
          return ok({ displayHint: x.displayHint, expiresAt: x.expiresAt });
        }
        case 'REDEEM': {
          const linkId = `lnk_${token(24)}`; const localRef = `ref_${token(24)}`;
          const x = await store.redeemIntent({ intentId: need(r.linkIntentId, 'linkIntentId'), nonceHash: await sha256Hex(need(r.nonce, 'nonce')), provider: cfg.peer, partnerRef: need(r.senderReference, 'senderReference'), linkId, localRef });
          if (x.reason !== 'OK') return failReason(x.reason);
          return ok({ linkId, receiverReference: localRef, status: 'PENDING' });
        }
        case 'ACTIVATE': {
          const x = await store.activateLink(need(r.linkId, 'linkId'), need(r.senderReference, 'senderReference'));
          if (x.reason !== 'OK') return failReason(x.reason);
          return ok({ linkId: r.linkId, status: 'CONNECTED' });
        }
        case 'REVOKE': {
          const x = await store.revokeLink(need(r.linkId, 'linkId'), need(r.senderReference, 'senderReference'), 'partner');
          if (x.reason !== 'OK') return failReason(x.reason);
          return ok({ linkId: r.linkId, status: 'REVOKED' });
        }
        case 'STATUS': {
          const link = await store.getLink(need(r.linkId, 'linkId'), need(r.senderReference, 'senderReference'));
          if (!link) return failReason('NOT_FOUND');
          return ok({ linkId: link.linkId, status: link.status });
        }
      }
    },

    /**
     * Point de contrôle des FUTURS échanges (planning, références, progression…) : un message n'est traité que si la liaison
     * existe, correspond à l'expéditeur ET est CONNECTED. Une liaison révoquée échoue ici, immédiatement.
     */
    async assertLinkUsable(linkId: string, senderReference: string): Promise<LinkRow> {
      const link = await store.getLink(linkId, senderReference);
      if (!link) return fail('LINK_NOT_FOUND', 'Liaison inconnue.');
      if (link.status === 'REVOKED') return fail('LINK_REVOKED', 'Liaison révoquée.');
      if (link.status === 'PENDING') return fail('LINK_PENDING', 'Liaison non confirmée.');
      if (link.status === 'ERROR') return fail('FORBIDDEN', 'Liaison en erreur.');
      return link;
    },
  };
}
export type LinkService = ReturnType<typeof createLinkService>;
export { integrationError };
