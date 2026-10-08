/**
 * Mémoire TEMPORAIRE (onglet courant) de la demande reçue de REV-EM : le nonce arrive dans le fragment d'URL (#n=…), qui ne survit pas
 * à la redirection vers la page de connexion ; on le garde donc dans sessionStorage le temps de se connecter (≤ 10 min), puis on l'efface.
 * C'est une capacité à usage unique liée à UNE intention (≠ secret inter-applications) ; elle n'est jamais écrite dans localStorage.
 */
const KEY = 'lexnote-pending-link';
const TTL_MS = 10 * 60_000;
export interface PendingLink { intent: string; nonce: string; at: number }

export function savePending(intent: string, nonce: string) { try { sessionStorage.setItem(KEY, JSON.stringify({ intent, nonce, at: Date.now() } satisfies PendingLink)); } catch { /* stockage indisponible */ } }
export function clearPending() { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }
export function readPending(intent: string): PendingLink | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as PendingLink | null;
    if (!p || p.intent !== intent || Date.now() - p.at > TTL_MS) { if (p) clearPending(); return null; }
    return p;
  } catch { return null; }
}
