import type { DeepLinkTarget } from './contracts';
import { fail } from './errors';

/**
 * Liens profonds. Une origine n'est JAMAIS déduite d'un message reçu : elle vient de la configuration locale de CETTE application
 * (liste blanche), ce qui empêche un message forgé de rediriger l'étudiant vers un site tiers.
 */
export interface LinkConfig { lexnoteOrigin: string; revemOrigin: string }

const isLocalHttp = (u: URL) => u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
export function normalizeOrigin(origin: string): string {
  let u: URL;
  try { u = new URL(origin); } catch { return fail('INVALID_PAYLOAD', 'Origine invalide.'); }
  if (u.protocol !== 'https:' && !isLocalHttp(u)) return fail('INVALID_PAYLOAD', 'Origine non sécurisée (https requis).');
  if (u.username || u.password) return fail('INVALID_PAYLOAD', 'Origine invalide.');
  return u.origin;
}

/** Chemins LexNote (routeur existant). Les chemins REV-EM seront définis par REV-EM quand il aura un routeur d'URL (docs §4.7). */
export function buildLexNoteLink(origin: string, t: Pick<DeepLinkTarget, 'kind' | 'ref'>): string {
  const base = normalizeOrigin(origin);
  const id = encodeURIComponent(t.ref);
  switch (t.kind) {
    case 'session': return `${base}/session/${id}`;
    case 'course': return `${base}/session/${id}/course`;
    case 'review': return `${base}/session/${id}/review`;
    case 'artifact': return `${base}/supports/${id}`;
    default: return fail('INVALID_PAYLOAD', `Cible « ${t.kind} » non gérée par LexNote.`);
  }
}

/** Accepte un lien reçu seulement s'il appartient à l'origine attendue (comparaison stricte d'origine). */
export function isTrustedLink(url: string, expectedOrigin: string): boolean {
  try { return new URL(url).origin === normalizeOrigin(expectedOrigin); } catch { return false; }
}
