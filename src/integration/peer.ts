/** Client de la passerelle du PARTENAIRE (serveur → serveur). Signe chaque requête, vérifie la signature de chaque réponse. */
import type { CourseLaunchRequest, CourseLaunchResponse, LinkRequest, LinkResponse } from './contracts';
import { integrationError, type IntegrationError } from './errors';
import { makeEnvelope, parseEnvelope } from './envelope';
import { H, signRequest, verifyRequest } from './signing';
import type { IntegrationConfig } from './config';

export type PeerResult = { ok: true; response: LinkResponse } | { ok: false; error: IntegrationError };
export type LaunchPeerResult = { ok: true; response: CourseLaunchResponse } | { ok: false; error: IntegrationError };
export interface PeerClient { send(payload: LinkRequest): Promise<PeerResult>; sendLaunch(payload: CourseLaunchRequest): Promise<LaunchPeerResult> }
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; redirect: 'error'; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string>; headers: { get(n: string): string | null } }>;

export function createPeerClient(cfg: IntegrationConfig, opts: { fetch?: FetchLike; now?: () => Date; timeoutMs?: number } = {}): PeerClient {
  const now = opts.now ?? (() => new Date());
  const doFetch: FetchLike = opts.fetch ?? ((u, i) => fetch(u, i) as never);
  /** Échange signé serveur → serveur ; `expected` = `kind` de la réponse attendue (toute autre charge utile est refusée). */
  async function exchange(payload: LinkRequest | CourseLaunchRequest, linkId: string, expected: 'link-response' | 'course-launch-response'): Promise<{ ok: true; payload: any } | { ok: false; error: IntegrationError }> {
    {
      const env = makeEnvelope({ from: cfg.self, to: cfg.peer, linkId, payload, ttlSeconds: 120, now: now() });
      const body = JSON.stringify(env);
      const headers = { 'content-type': 'application/json', ...(await signRequest({ body, from: cfg.self, to: cfg.peer, kid: cfg.keyId, secret: cfg.keys[cfg.keyId]!, now: now() })) };
      let res;
      try {
        // `redirect: 'error'` : une redirection ne doit jamais emporter une requête signée vers un autre hôte.
        res = await doFetch(cfg.peerGatewayUrl, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(opts.timeoutMs ?? 8000) });
      } catch (e) {
        const timeout = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
        return { ok: false, error: integrationError(timeout ? 'TIMEOUT' : 'UNAVAILABLE', 'Passerelle du partenaire injoignable.') };
      }
      const text = await res.text();
      // Une réponse n'est digne de confiance que si elle est signée par le partenaire. Sinon : échec générique, sans effet d'état.
      let verified = false;
      try { await verifyRequest({ method: 'POST', headers: res.headers, body: text, self: cfg.self, expectedSender: cfg.peer, keys: cfg.keys, now: now() }); verified = true; } catch { /* non signée */ }
      if (!verified) return { ok: false, error: classifyUnsigned(res.status, text) };
      let raw: unknown; try { raw = JSON.parse(text); } catch { return { ok: false, error: integrationError('INVALID_PAYLOAD', 'Réponse illisible.') }; }
      const parsed = parseEnvelope(raw, now());
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const p = parsed.envelope.payload;
      if (p.kind === 'integration-error') return { ok: false, error: p as unknown as IntegrationError };
      if (p.kind !== expected) return { ok: false, error: integrationError('INVALID_PAYLOAD', 'Charge utile inattendue.') };
      return { ok: true, payload: p };
    }
  }
  return {
    async send(payload) {
      const r = await exchange(payload, payload.linkId ?? payload.linkIntentId ?? 'pairing', 'link-response');
      return r.ok ? { ok: true, response: r.payload as LinkResponse } : r;
    },
    async sendLaunch(payload) {
      const r = await exchange(payload, payload.linkId ?? 'launch-identify', 'course-launch-response');
      return r.ok ? { ok: true, response: r.payload as CourseLaunchResponse } : r;
    },
  };
}
/**
 * Réponse NON signée du partenaire = il n'a pas pu (ou pas voulu) authentifier NOTRE serveur, ou la requête n'a jamais atteint son code.
 * Avant : un 401 devenait `UNAUTHENTICATED`, affiché à l'étudiant comme « Votre session a expiré » alors que sa session LexNote était valide.
 * Désormais la cause serveur ↔ serveur est explicite (`PEER_AUTH_FAILED` + raison), pour l'interface comme pour les journaux.
 */
export function classifyUnsigned(status: number, text: string): IntegrationError {
  let body: { kind?: unknown; code?: unknown; details?: { reason?: unknown }; message?: unknown; msg?: unknown } | null = null;
  try { body = JSON.parse(text); } catch { /* corps non JSON */ }
  const ours = body?.kind === 'integration-error' && typeof body.code === 'string';        // refus émis par la passerelle lexnote-revem/v1 elle-même
  const reason = ours && typeof body?.details?.reason === 'string' ? body.details.reason.slice(0, 60) : undefined;
  const at = `HTTP ${status}`;
  if (status === 401) {
    // Passerelle déployée SANS `--no-verify-jwt` : la plateforme Supabase exige un JWT utilisateur et répond avant notre code.
    if (!ours) return integrationError('PEER_AUTH_FAILED', `Passerelle du partenaire protégée par JWT (${at}) : redéployer avec --no-verify-jwt.`, { details: { reason: 'gateway-verify-jwt' } });
    return integrationError('PEER_AUTH_FAILED', `Authentification serveur refusée par le partenaire (${at}).`, { details: { reason: reason ?? 'signature' } });
  }
  if (status === 403 && ours) return integrationError(String(body!.code) === 'FORBIDDEN' ? 'PEER_AUTH_FAILED' : 'FORBIDDEN', `Requête serveur refusée par le partenaire (${at}).`, { details: { reason: reason ?? 'forbidden' } });
  if (status === 404) return integrationError('UNAVAILABLE', `Passerelle du partenaire introuvable (${at}) : fonction non déployée ?`, { details: { reason: 'gateway-not-found' } });
  if (status === 429) return integrationError('RATE_LIMITED', `Partenaire saturé (${at}).`);
  if (status >= 500) return integrationError('UNAVAILABLE', `Partenaire indisponible (${at}).`, { details: { reason: ours && reason ? reason : 'server-error' } });
  return integrationError('INVALID_PAYLOAD', `Réponse non authentifiée du partenaire (${at}).`, reason ? { details: { reason } } : {});
}
export { H };
