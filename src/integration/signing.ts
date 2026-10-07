/**
 * Authentification serveur → serveur : signature HMAC-SHA256 d'une chaîne canonique qui lie
 * méthode · route · horodatage · nonce · empreinte du corps · expéditeur · destinataire · identifiant de clé.
 *
 *  - rejeu           : horodatage borné (±5 min) ET nonce à usage unique (table `integration_nonces`, voir linking/gateway) ;
 *  - altération      : l'empreinte SHA-256 du corps est signée, et recalculée par le récepteur ;
 *  - expéditeur      : la clé est DÉRIVÉE par direction (`lnrv1|from->to`) : un message de A vers B ne peut pas être rejoué comme B vers A ;
 *  - rotation        : plusieurs `kid` acceptés en vérification, un seul utilisé pour signer.
 * Le secret ne vit que dans les secrets des Edge Functions (jamais dans un navigateur, jamais dans une enveloppe).
 * Dépendances : Web Crypto uniquement (Deno, Node ≥ 20, navigateurs).
 */
import type { IntegrationApp } from './contracts';
import { APPS } from './contracts';
import { fail } from './errors';

export const SIGNATURE_SCHEME = 'LNRV1-HMAC-SHA256';
export const GATEWAY_ROUTE = 'integration-gateway';
export const MAX_SKEW_SECONDS = 300;
export const H = {
  from: 'x-lnrv-from', to: 'x-lnrv-to', kid: 'x-lnrv-key-id', timestamp: 'x-lnrv-timestamp', nonce: 'x-lnrv-nonce', bodySha: 'x-lnrv-content-sha256', signature: 'x-lnrv-signature',
} as const;

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64url = (b: ArrayBuffer) => { let s = ''; for (const x of new Uint8Array(b)) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

export async function sha256Hex(text: string): Promise<string> { return hex(await crypto.subtle.digest('SHA-256', enc.encode(text))); }

/** Aléa cryptographique encodé base64url (`bytes` octets). */
export function randomToken(bytes = 24): string { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return b64url(a.buffer); }

async function deriveKey(secret: string, from: IntegrationApp, to: IntegrationApp): Promise<CryptoKey> {
  const root = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = await crypto.subtle.sign('HMAC', root, enc.encode(`lnrv1|${from}->${to}`));
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export interface CanonicalParts { method: string; timestamp: string; nonce: string; bodySha256: string; from: IntegrationApp; to: IntegrationApp; kid: string }
export const canonicalString = (p: CanonicalParts): string => [SIGNATURE_SCHEME, p.method.toUpperCase(), GATEWAY_ROUTE, p.timestamp, p.nonce, p.bodySha256, p.from, p.to, p.kid].join('\n');

/** Comparaison en temps constant (longueur incluse dans le calcul). */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a); const y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

export interface SignInput { body: string; from: IntegrationApp; to: IntegrationApp; kid: string; secret: string; now?: Date; nonce?: string; method?: string }

export async function signRequest(i: SignInput): Promise<Record<string, string>> {
  const timestamp = String(Math.floor((i.now ?? new Date()).getTime() / 1000));
  const nonce = i.nonce ?? randomToken(24);
  const bodySha256 = await sha256Hex(i.body);
  const key = await deriveKey(i.secret, i.from, i.to);
  const sig = b64url(await crypto.subtle.sign('HMAC', key, enc.encode(canonicalString({ method: i.method ?? 'POST', timestamp, nonce, bodySha256, from: i.from, to: i.to, kid: i.kid }))));
  return { [H.from]: i.from, [H.to]: i.to, [H.kid]: i.kid, [H.timestamp]: timestamp, [H.nonce]: nonce, [H.bodySha]: bodySha256, [H.signature]: sig };
}

export interface VerifyInput {
  method: string; headers: Pick<Headers, 'get'>; body: string;
  /** Application qui vérifie (le destinataire attendu). */
  self: IntegrationApp;
  /** Seul expéditeur accepté. */
  expectedSender: IntegrationApp;
  keys: Record<string, string>;
  now?: Date; maxSkewSeconds?: number;
}
export interface Verified { from: IntegrationApp; nonce: string; timestamp: number; kid: string }

const deny = (reason: string): never => fail('UNAUTHENTICATED', 'Signature de passerelle refusée.', { details: { reason } });

/** Vérifie l'authenticité. N'enregistre PAS le nonce (c'est à l'appelant, après succès, pour ne pas laisser un inconnu remplir la table). */
export async function verifyRequest(i: VerifyInput): Promise<Verified> {
  const g = (n: string) => i.headers.get(n) ?? '';
  const from = g(H.from); const to = g(H.to); const kid = g(H.kid); const ts = g(H.timestamp); const nonce = g(H.nonce); const sha = g(H.bodySha); const sig = g(H.signature);
  if (!from || !to || !kid || !ts || !nonce || !sha || !sig) return deny('missing-header');
  if (!(APPS as readonly string[]).includes(from) || from !== i.expectedSender) return deny('unknown-sender');
  if (to !== i.self) return deny('wrong-recipient');
  const secret = Object.prototype.hasOwnProperty.call(i.keys, kid) ? i.keys[kid] : undefined;
  if (!secret) return deny('unknown-key');
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(nonce)) return deny('bad-nonce');
  const t = Number(ts);
  if (!Number.isInteger(t)) return deny('bad-timestamp');
  const nowS = Math.floor((i.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowS - t) > (i.maxSkewSeconds ?? MAX_SKEW_SECONDS)) return deny('expired');
  if (!timingSafeEqual(await sha256Hex(i.body), sha)) return deny('payload-hash');
  const key = await deriveKey(secret, from as IntegrationApp, i.self);
  const expected = b64url(await crypto.subtle.sign('HMAC', key, enc.encode(canonicalString({ method: i.method, timestamp: ts, nonce, bodySha256: sha, from: from as IntegrationApp, to: i.self, kid }))));
  if (!timingSafeEqual(expected, sig)) return deny('bad-signature');
  return { from: from as IntegrationApp, nonce, timestamp: t, kid };
}
