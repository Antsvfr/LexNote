/**
 * Configuration CENTRALISÉE de l'intégration (origines, passerelle, clés). Lue depuis les secrets / variables d'environnement du
 * projet Supabase — jamais depuis le navigateur, jamais committée. Fail-fast : une configuration douteuse empêche l'intégration
 * de démarrer plutôt que de fonctionner à moitié.
 *
 * Règles : aucune origine joker (`*`), HTTPS obligatoire en production, `http://localhost` uniquement en développement,
 * l'URL de la passerelle du partenaire vient d'ICI (jamais d'une requête : pas de SSRF).
 */
import type { IntegrationApp } from './contracts';
import { IntegrationFailure, integrationError } from './errors';

export type EnvSource = (key: string) => string | undefined;
export type IntegrationEnvironment = 'development' | 'production';

/** Origines de développement connues (le développement local est la seule situation où `http://localhost` est accepté). */
export const DEV_ORIGINS: Record<IntegrationApp, readonly string[]> = {
  lexnote: ['http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173', 'http://127.0.0.1:4173'],
  revem: ['http://localhost:8080', 'http://localhost:3000', 'http://127.0.0.1:8080', 'http://127.0.0.1:3000'],
};
/**
 * Origines OFFICIELLES de production connues. REV-EM est publié sur GitHub Pages ; l'adresse officielle de LexNote n'est pas encore figée :
 * elle est fournie par `INTEGRATION_SELF_APP_URL` (LexNote) / `INTEGRATION_PEER_APP_URL` (REV-EM) — jamais devinée.
 */
export const PRODUCTION_ORIGINS: Partial<Record<IntegrationApp, readonly string[]>> = { revem: ['https://antsvfr.github.io'] };

export interface IntegrationConfig {
  self: IntegrationApp;
  peer: IntegrationApp;
  environment: IntegrationEnvironment;
  /** URL complète de CETTE application (avec son chemin éventuel, ex. https://antsvfr.github.io/REV-EM/). */
  selfAppUrl: string;
  /** Origines navigateur autorisées à appeler les fonctions utilisateur de CE projet (CORS, liste blanche stricte). */
  selfOrigins: string[];
  peerAppUrl: string;
  peerOrigin: string;
  /** URL de la fonction `integration-gateway` du partenaire. */
  peerGatewayUrl: string;
  keyId: string;
  /** kid → secret. Contient la clé courante et, pendant une rotation, la précédente (vérification seulement). */
  keys: Record<string, string>;
}

const other = (a: IntegrationApp): IntegrationApp => (a === 'lexnote' ? 'revem' : 'lexnote');

function cfgError(msg: string): never { throw new IntegrationFailure(integrationError('INTERNAL', `Configuration d'intégration invalide : ${msg}`)); }

/** Normalise une origine ; refuse joker, identifiants, protocoles non sûrs. */
export function checkOrigin(value: string, env: IntegrationEnvironment): string {
  const v = value.trim();
  if (!v || v.includes('*')) cfgError('origine joker ou vide interdite');
  let u: URL;
  try { u = new URL(v); } catch { return cfgError(`origine illisible « ${v.slice(0, 60)} »`); }
  if (u.username || u.password) cfgError('identifiants dans une origine');
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol === 'https:') return u.origin;
  if (u.protocol === 'http:' && local && env === 'development') return u.origin;
  return cfgError(`origine non sécurisée « ${u.origin} » (https requis${local ? ' ; localhost réservé au développement' : ''})`);
}

export function readIntegrationConfig(self: IntegrationApp, src: EnvSource): IntegrationConfig {
  const get = (k: string) => (src(k) ?? '').trim();
  const req = (k: string) => get(k) || cfgError(`variable ${k} manquante`);
  const env = (get('INTEGRATION_ENV') || 'production') as IntegrationEnvironment;
  if (env !== 'development' && env !== 'production') cfgError('INTEGRATION_ENV doit valoir development ou production');
  const peer = other(self);

  const selfAppUrl = new URL(req('INTEGRATION_SELF_APP_URL'));
  checkOrigin(selfAppUrl.origin, env);
  const peerAppUrl = new URL(req('INTEGRATION_PEER_APP_URL'));
  const peerOrigin = checkOrigin(peerAppUrl.origin, env);
  const gw = new URL(req('INTEGRATION_PEER_GATEWAY_URL'));
  checkOrigin(gw.origin, env);
  if (gw.search || gw.hash) cfgError('URL de passerelle avec paramètres');

  const extra = get('INTEGRATION_ALLOWED_ORIGINS').split(/[\s,]+/).filter(Boolean);
  const selfOrigins = new Set<string>([checkOrigin(selfAppUrl.origin, env), ...extra.map((o) => checkOrigin(o, env))]);
  if (env === 'development') for (const o of DEV_ORIGINS[self]) selfOrigins.add(o);
  else for (const o of PRODUCTION_ORIGINS[self] ?? []) selfOrigins.add(checkOrigin(o, env));

  const keyId = req('INTEGRATION_KEY_ID');
  const keys: Record<string, string> = {};
  const key = req('INTEGRATION_KEY');
  if (key.length < 32) cfgError('INTEGRATION_KEY trop courte (≥ 32 caractères)');
  keys[keyId] = key;
  const prevId = get('INTEGRATION_KEY_PREVIOUS_ID'); const prev = get('INTEGRATION_KEY_PREVIOUS');
  if (prevId || prev) {
    if (!prevId || prev.length < 32) cfgError('clé précédente incomplète');
    if (prevId === keyId) cfgError('identifiants de clé identiques');
    keys[prevId] = prev;
  }
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(keyId)) cfgError('INTEGRATION_KEY_ID invalide');
  return { self, peer, environment: env, selfAppUrl: selfAppUrl.toString(), selfOrigins: [...selfOrigins], peerAppUrl: peerAppUrl.toString(), peerOrigin, peerGatewayUrl: gw.toString(), keyId, keys };
}

/** CORS : renvoie l'origine SI elle est autorisée, sinon null. Jamais de joker, jamais d'écho aveugle. */
export const allowedBrowserOrigin = (cfg: IntegrationConfig, origin: string | null): string | null => (origin && cfg.selfOrigins.includes(origin) ? origin : null);
