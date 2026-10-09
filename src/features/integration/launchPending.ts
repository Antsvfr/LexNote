/**
 * Mémoire TEMPORAIRE (onglet courant) du lancement reçu de REV-EM : `/integrations/revem/launch?intent=<uuid>#n=<nonce>`.
 * Le nonce arrive dans le fragment (qui ne survit pas à la redirection vers la connexion) : on le garde en sessionStorage le temps de se
 * connecter (≤ 10 min), puis on l'efface. C'est une capacité à usage unique liée à UNE intention (≠ secret inter-applications).
 * Le résultat (identifiant de séance) est mémorisé pour qu'un rechargement de la page reprenne l'ouverture au lieu de rejouer une intention consommée.
 */
const KEY = 'lexnote-pending-launch';
const RESULT = 'lexnote-launch-result';
const TTL_MS = 10 * 60_000;
export interface PendingLaunch { intent: string; nonce: string; at: number }

export function savePendingLaunch(intent: string, nonce: string) { try { sessionStorage.setItem(KEY, JSON.stringify({ intent, nonce, at: Date.now() } satisfies PendingLaunch)); } catch { /* stockage indisponible */ } }
export function clearPendingLaunch() { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }
export function readPendingLaunch(intent: string): PendingLaunch | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as PendingLaunch | null;
    if (!p || p.intent !== intent || Date.now() - p.at > TTL_MS) { if (p) clearPendingLaunch(); return null; }
    return p;
  } catch { return null; }
}
export function saveLaunchResult(intent: string, sessionId: string) { try { sessionStorage.setItem(RESULT, JSON.stringify({ intent, sessionId, at: Date.now() })); } catch { /* ignore */ } }
export function readLaunchResult(intent: string): string | null {
  try { const r = JSON.parse(sessionStorage.getItem(RESULT) ?? 'null') as { intent: string; sessionId: string; at: number } | null; return r && r.intent === intent && Date.now() - r.at < TTL_MS ? r.sessionId : null; } catch { return null; }
}
