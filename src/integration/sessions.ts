/**
 * Création d'une session Supabase LexNote NORMALE pour un utilisateur déjà identifié par une liaison REV-EM ⇄ LexNote
 * (connexion automatique, consentement explicite). Côté serveur LexNote uniquement.
 *
 * Mécanisme (aucun mot de passe, aucun secret vers le navigateur) :
 *   1. Auth admin (service_role, dans l'Edge Function) génère un lien de connexion à usage unique pour CET utilisateur
 *      (`generateLink` — aucun e-mail n'est envoyé) et n'en garde que l'empreinte `hashed_token` ;
 *   2. le serveur l'échange IMMÉDIATEMENT (`verifyOtp`, client public) : le jeton est consommé côté serveur, il n'existe plus nulle part ;
 *   3. il renvoie au navigateur, dans le CORPS d'une réponse HTTPS (jamais dans une URL), la paire access / refresh d'une session ordinaire —
 *      exactement ce que renverrait une connexion par mot de passe. Le navigateur l'installe avec `auth.setSession`.
 * Le jeton d'accès est un JWT utilisateur standard (rôle `authenticated`, durée Supabase habituelle), jamais un JWT administratif.
 */
import { fail } from './errors';

export interface MintedSession { access_token: string; refresh_token: string; expires_in: number; expires_at: number; token_type: 'bearer' }
export interface SessionMinter { mint(userId: string): Promise<MintedSession> }

/** Formes minimales des clients supabase-js utilisés (injectés : testables sans réseau). */
export interface AdminAuth {
  getUserById(id: string): Promise<{ data: { user: { id: string; email?: string | null; banned_until?: string | null } | null }; error: { message: string } | null }>;
  generateLink(p: { type: 'magiclink'; email: string }): Promise<{ data: { properties?: { hashed_token?: string } | null; user?: { id: string } | null }; error: { message: string } | null }>;
}
export interface PublicAuth {
  verifyOtp(p: { token_hash: string; type: 'magiclink' | 'email' }): Promise<{ data: { session: { access_token: string; refresh_token: string; expires_in?: number; expires_at?: number; user?: { id: string } | null } | null }; error: { message: string } | null }>;
}

export function createSessionMinter(admin: AdminAuth, publicAuth: () => PublicAuth, now: () => number = () => Date.now()): SessionMinter {
  return {
    async mint(userId) {
      const u = await admin.getUserById(userId);
      const email = u.data.user?.email;
      if (u.error || !u.data.user || !email) return fail('UNAVAILABLE', 'Compte LexNote introuvable pour la connexion automatique.');
      if (u.data.user.banned_until && Date.parse(u.data.user.banned_until) > now()) return fail('FORBIDDEN', 'Compte suspendu.');
      const link = await admin.generateLink({ type: 'magiclink', email });
      const hashed = link.data.properties?.hashed_token;
      // Défense en profondeur : le lien doit viser exactement l'utilisateur de la liaison.
      if (link.error || !hashed || (link.data.user && link.data.user.id !== userId)) { console.error('[integration] generateLink', link.error?.message); return fail('UNAVAILABLE', 'Connexion automatique indisponible.'); }
      // Échange immédiat côté serveur : le jeton à usage unique ne quitte jamais ce processus.
      let v = await publicAuth().verifyOtp({ token_hash: hashed, type: 'magiclink' });
      if (v.error && /type/i.test(v.error.message)) v = await publicAuth().verifyOtp({ token_hash: hashed, type: 'email' });
      const s = v.data.session;
      if (v.error || !s?.access_token || !s.refresh_token) { console.error('[integration] verifyOtp', v.error?.message); return fail('UNAVAILABLE', 'Connexion automatique indisponible.'); }
      if (s.user && s.user.id !== userId) return fail('FORBIDDEN', 'Session inattendue.');
      const expiresIn = typeof s.expires_in === 'number' ? s.expires_in : 3600;
      return { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: expiresIn, expires_at: s.expires_at ?? Math.floor(now() / 1000) + expiresIn, token_type: 'bearer' };
    },
  };
}
