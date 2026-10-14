/**
 * Passerelle serveur → serveur (`integration-gateway`) et fonction utilisateur (`integration-link`) — logique pure, sans Deno ni Supabase :
 * les Edge Functions ne font que l'injection de dépendances (config, magasin, authentification) autour de ces deux fonctions.
 */
import { allowedBrowserOrigin, type IntegrationConfig } from './config';
import { fail, integrationError, IntegrationFailure, type IntegrationError, type IntegrationErrorCode } from './errors';
import { expectPayload, makeEnvelope, parseEnvelope } from './envelope';
import type { LaunchService } from './launch';
import type { LinkService } from './linking';
import { signRequest, verifyRequest, MAX_SKEW_SECONDS } from './signing';
import type { LinkStore } from './store';
import { INTEGRATION_VERSION } from './version';

const MAX_BODY = 16 * 1024;
const STATUS: Partial<Record<IntegrationErrorCode, number>> = {
  INVALID_PAYLOAD: 400, SECRET_DETECTED: 400, UNSUPPORTED_VERSION: 426, UNAUTHENTICATED: 401, FORBIDDEN: 403, SCOPE_MISSING: 403, LINK_NOT_FOUND: 404, NOT_FOUND: 404,
  LINK_REVOKED: 403, LINK_EXPIRED: 410, LINK_PENDING: 409, CONFLICT: 409, GONE: 410, RATE_LIMITED: 429, UNAVAILABLE: 503, OFFLINE: 503, TIMEOUT: 504, INTERNAL: 500,
};
export const httpStatusOf = (code: string): number => STATUS[code as IntegrationErrorCode] ?? 500;

export interface GatewayDeps { cfg: IntegrationConfig; store: LinkStore; service: LinkService; /** Ouverture de cours (REV-EM seulement). */ launch?: LaunchService; now?: () => Date }

const jsonResponse = (body: string, status: number, headers: Record<string, string> = {}) => new Response(body, { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

/** Erreur NON signée (appelant non authentifié) : pas de détail exploitable au-delà d'une raison courte. */
function plainError(e: IntegrationError): Response { return jsonResponse(JSON.stringify(e), httpStatusOf(e.code)); }

export async function handleGatewayRequest(req: Request, deps: GatewayDeps): Promise<Response> {
  const { cfg, store, service } = deps;
  const now = deps.now ?? (() => new Date());
  try {
    if (req.method !== 'POST') return plainError(integrationError('INVALID_PAYLOAD', 'Méthode non autorisée.'));
    // Un navigateur envoie toujours `Origin` sur un POST inter-sites : la passerelle n'est PAS faite pour lui.
    if (req.headers.get('origin')) return plainError(integrationError('FORBIDDEN', 'Origine non autorisée pour la passerelle.', { details: { reason: 'browser-origin' } }));
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (declared > MAX_BODY) return plainError(integrationError('INVALID_PAYLOAD', 'Message trop volumineux.'));
    const body = await req.text();
    if (body.length > MAX_BODY) return plainError(integrationError('INVALID_PAYLOAD', 'Message trop volumineux.'));

    // 1) authenticité (expéditeur connu, clé connue, horodatage, empreinte du corps, signature) — AVANT toute lecture du contenu
    const v = await verifyRequest({ method: req.method, headers: req.headers, body, self: cfg.self, expectedSender: cfg.peer, keys: cfg.keys, now: now() });
    // 2) rejeu : le nonce n'est mémorisé qu'après une signature valide
    if (!(await store.registerNonce(v.from, v.nonce, new Date(now().getTime() + (MAX_SKEW_SECONDS + 60) * 1000)))) {
      return fail('UNAUTHENTICATED', 'Message déjà reçu.', { details: { reason: 'replay' } });
    }
    // 3) contrat lexnote-revem/v1 : secrets → version → forme → expiration
    let raw: unknown; try { raw = JSON.parse(body); } catch { return fail('INVALID_PAYLOAD', 'JSON illisible.'); }
    const parsed = parseEnvelope(raw, now());
    if (!parsed.ok) throw new IntegrationFailure(parsed.error);
    const env = parsed.envelope;
    if (env.from !== v.from || env.to !== cfg.self) return fail('FORBIDDEN', 'Enveloppe incohérente avec la signature.');
    // 4) traitement → réponse SIGNÉE
    let out;
    try {
      if (env.payload.kind === 'course-launch-request') {
        if (!deps.launch) return fail('INVALID_PAYLOAD', 'Ouverture de cours non prise en charge ici.');
        out = await deps.launch.handlePeerLaunch(env.payload);
      } else out = await service.handlePeerRequest(expectPayload(env, 'link-request'));
    }
    catch (e) {
      const err = e instanceof IntegrationFailure ? e.error : integrationError('INTERNAL', 'Erreur interne.');
      if (!(e instanceof IntegrationFailure)) console.error('[integration-gateway]', e);
      return await signedResponse(cfg, env.linkId, err, httpStatusOf(err.code), env.correlationId, now);
    }
    return await signedResponse(cfg, env.linkId, out, 200, env.correlationId, now);
  } catch (e) {
    if (e instanceof IntegrationFailure) return plainError(e.error);
    console.error('[integration-gateway]', e);
    return plainError(integrationError('INTERNAL', 'Erreur interne.'));
  }
}

async function signedResponse(cfg: IntegrationConfig, linkId: string, payload: Parameters<typeof makeEnvelope>[0]['payload'], status: number, correlationId: string | undefined, now: () => Date): Promise<Response> {
  const env = makeEnvelope({ from: cfg.self, to: cfg.peer, linkId, payload, correlationId, ttlSeconds: 120, now: now() });
  const body = JSON.stringify(env);
  return jsonResponse(body, status, await signRequest({ body, from: cfg.self, to: cfg.peer, kid: cfg.keyId, secret: cfg.keys[cfg.keyId]!, now: now() }));
}

/* ====================================================================================================== fonction utilisateur */

export interface UserDeps { cfg: IntegrationConfig; service: LinkService; launch?: LaunchService; authenticate(req: Request): Promise<string> }
const ACTIONS = ['start', 'cancel', 'inspect', 'confirm', 'status', 'revoke', 'launch-start', 'launch-open'] as const;

function cors(origin: string | null): Record<string, string> {
  return origin ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS', vary: 'Origin' } : { vary: 'Origin' };
}

export async function handleUserRequest(req: Request, deps: UserDeps): Promise<Response> {
  const { cfg, service } = deps;
  const origin = allowedBrowserOrigin(cfg, req.headers.get('origin'));
  // Navigateur d'une origine inconnue : refus net, sans en-tête CORS (la réponse ne sera pas lisible) et SANS traitement.
  if (req.headers.get('origin') && !origin) return new Response(JSON.stringify({ ok: false, error: integrationError('FORBIDDEN', 'Origine non autorisée.') }), { status: 403, headers: { 'content-type': 'application/json', vary: 'Origin' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  const reply = (body: unknown, status = 200) => jsonResponse(JSON.stringify(body), status, cors(origin));
  try {
    if (req.method !== 'POST') return reply({ ok: false, error: integrationError('INVALID_PAYLOAD', 'Méthode non autorisée.') }, 405);
    const userId = await deps.authenticate(req);                                  // identité issue du JETON, jamais du corps
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '') as (typeof ACTIONS)[number];
    if (!ACTIONS.includes(action)) return fail('INVALID_PAYLOAD', 'Action inconnue.');
    const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : fail('INVALID_PAYLOAD', 'Identifiant invalide.'));
    const nonce = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_-]{32,100}$/.test(v) ? v : fail('INVALID_PAYLOAD', 'Code invalide.'));
    switch (action) {
      case 'start': return reply({ ok: true, ...(await service.startLink(userId)) });
      case 'cancel': await service.cancelLink(userId); return reply({ ok: true });
      case 'inspect': return reply({ ok: true, ...(await service.inspect(uuid(body.linkIntentId), nonce(body.nonce))) });
      case 'confirm': {
        const state = await service.confirm(userId, uuid(body.linkIntentId), nonce(body.nonce));
        const back = new URL(cfg.peerAppUrl); back.searchParams.set(`${cfg.self}_link`, 'connected');
        return reply({ ok: true, state, returnUrl: back.toString() });
      }
      case 'status': return reply({ ok: true, state: await service.getState(userId, { probe: body.probe !== false }) });
      case 'revoke': return reply({ ok: true, ...(await service.revoke(userId)) });
      case 'launch-start': {
        if (!deps.launch) return fail('INVALID_PAYLOAD', 'Action non disponible.');
        const eventId = typeof body.eventId === 'string' && /^[A-Za-z0-9._:~@-]{1,128}$/.test(body.eventId) ? body.eventId : fail('INVALID_PAYLOAD', 'Évènement invalide.');
        const tz = typeof body.tz === 'string' && body.tz.length <= 64 ? body.tz : undefined;
        return reply({ ok: true, ...(await deps.launch.startLaunch(userId, { eventId, tz })) });
      }
      case 'launch-open': {
        if (!deps.launch) return fail('INVALID_PAYLOAD', 'Action non disponible.');
        const r = await deps.launch.openLaunch(userId, uuid(body.launchIntentId), nonce(body.nonce));
        return reply({ ok: true, sessionId: r.sessionId, subjectId: r.subjectId, createdSession: !!r.createdSession, createdSubject: !!r.createdSubject });
      }
    }
  } catch (e) {
    const err = e instanceof IntegrationFailure ? e.error : integrationError('INTERNAL', 'Erreur interne.');
    if (!(e instanceof IntegrationFailure)) console.error('[integration-link]', e);
    return reply({ ok: false, error: err }, httpStatusOf(err.code));
  }
}
export { INTEGRATION_VERSION };
