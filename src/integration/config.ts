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
/** Origines OFFICIELLES de production (seules origines navigateur acceptées en production, avec celles ajoutées explicitement par l'opérateur). */
export const PRODUCTION_ORIGINS: Record<IntegrationApp, readonly string[]> = {
  lexnote: ['https://lex-note-svfr.vercel.app'],
  revem: ['https://antsvfr.github.io'],
};
/** URLs complètes officielles (avec chemin) : valeurs à poser dans INTEGRATION_SELF_APP_URL / INTEGRATION_PEER_APP_URL. */
export const OFFICIAL_APP_URLS: Record<IntegrationApp, string> = {
  lexnote: 'https://lex-note-svfr.vercel.app/',
  revem: 'https://antsvfr.github.io/REV-EM/',
};

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

/**
 * Origines NAVIGATEUR autorisées pour les fonctions appelées depuis le front de `self` (CORS, liste blanche stricte).
 * Ne dépend d'aucune clé : utilisable par n'importe quelle Edge Function (ex. `delete-account`).
 * production : origine officielle + INTEGRATION_SELF_APP_URL + INTEGRATION_ALLOWED_ORIGINS ; development : localhost explicite en plus.
 */
export function readBrowserOrigins(self: IntegrationApp, src: EnvSource): string[] {
  const get = (k: string) => (src(k) ?? '').trim();
  const env = (get('INTEGRATION_ENV') || 'production') as IntegrationEnvironment;
  if (env !== 'development' && env !== 'production') cfgError('INTEGRATION_ENV doit valoir development ou production');
  const out = new Set<string>();
  for (const o of PRODUCTION_ORIGINS[self]) out.add(checkOrigin(o, env));
  if (get('INTEGRATION_SELF_APP_URL')) out.add(checkOrigin(new URL(get('INTEGRATION_SELF_APP_URL')).origin, env));
  for (const o of get('INTEGRATION_ALLOWED_ORIGINS').split(/[\s,]+/).filter(Boolean)) out.add(checkOrigin(o, env));
  if (env === 'development') for (const o of DEV_ORIGINS[self]) out.add(o);
  return [...out];
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

  const selfOrigins = new Set<string>(readBrowserOrigins(self, src));

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
export const allowedBrowserOrigin = (cfg: Pick<IntegrationConfig, 'selfOrigins'>, origin: string | null): string | null => (origin && cfg.selfOrigins.includes(origin) ? origin : null);

/** En-têtes CORS pour une réponse à un navigateur : écho EXACT d'une origine autorisée, sinon aucun en-tête d'autorisation. Jamais « * ». */
export function corsHeadersFor(origins: readonly string[], origin: string | null): Record<string, string> {
  const base = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
  return origin && origins.includes(origin) ? { 'Access-Control-Allow-Origin': origin, ...base } : base;
}
