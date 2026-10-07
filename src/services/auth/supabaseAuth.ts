import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AuthError, emptyProfile, type AuthEvent, type AuthRepository, type AuthUser, type Profile, type ProfileRepository, type SignUpResult } from './types';

const toUser = (u: User | null | undefined): AuthUser | null => (u ? { id: u.id, email: u.email ?? '' } : null);

/** Traduit les erreurs Supabase en messages clairs (sans jamais révéler si un e-mail existe lors d'un reset). */
function mapError(err: { message?: string; status?: number; code?: string; name?: string }): AuthError {
  const m = (err.message ?? '').toLowerCase();
  if (/failed to fetch|network|fetch failed|load failed/.test(m) || err.name === 'AuthRetryableFetchError') return new AuthError('Connexion impossible. Vérifiez votre réseau.', 'network');
  if (/invalid login credentials|invalid_credentials/.test(m) || err.code === 'invalid_credentials') return new AuthError('E-mail ou mot de passe incorrect.', 'invalid_credentials');
  if (/already registered|already been registered|user_already_exists/.test(m) || err.code === 'user_already_exists') return new AuthError('Un compte existe déjà avec cet e-mail.', 'email_taken');
  if (/email not confirmed|email_not_confirmed/.test(m) || err.code === 'email_not_confirmed') return new AuthError('Confirmez d’abord votre e-mail (lien reçu dans votre boîte).', 'not_confirmed');
  if (/password/.test(m) && /(weak|short|least|characters)/.test(m)) return new AuthError('Mot de passe trop faible (8 caractères minimum).', 'weak_password');
  if (err.status === 429 || /rate limit|too many/.test(m)) return new AuthError('Trop de tentatives. Réessayez dans quelques minutes.', 'rate_limited');
  return new AuthError('Une erreur est survenue. Réessayez.', 'unknown');
}

export class SupabaseAuth implements AuthRepository {
  constructor(private client: SupabaseClient) {}

  async getSession() {
    try {
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      return { user: toUser(data.session?.user), offlineFallback: false };
    } catch (e) {
      // Hors ligne avec un jeton expiré : la session stockée existe encore, mais n'a pas pu être rafraîchie.
      const retryable = (e as { name?: string })?.name === 'AuthRetryableFetchError' || (typeof navigator !== 'undefined' && !navigator.onLine);
      if (retryable) return { user: null, offlineFallback: true };
      throw mapError(e as Error);
    }
  }

  onAuthChange(cb: (e: AuthEvent, u: AuthUser | null) => void) {
    const { data } = this.client.auth.onAuthStateChange((event, session) => cb(event as AuthEvent, toUser(session?.user)));
    return () => data.subscription.unsubscribe();
  }

  async signUp(email: string, password: string): Promise<SignUpResult> {
    const { data, error } = await this.client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } });
    if (error) throw mapError(error);
    // Adresse déjà utilisée : Supabase renvoie un utilisateur sans identité (anti-énumération).
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new AuthError('Un compte existe déjà avec cet e-mail.', 'email_taken');
    return { needsConfirmation: !data.session, user: data.session ? toUser(data.user) : null };
  }

  async signIn(email: string, password: string) {
    const { data, error } = await this.client.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw mapError(error);
    return toUser(data.user)!;
  }
  async signOut() {
    const { error } = await this.client.auth.signOut();
    if (error && !/session/i.test(error.message)) throw mapError(error);
  }
  async requestPasswordReset(email: string) {
    const { error } = await this.client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    if (error) throw mapError(error);
  }
  async updatePassword(newPassword: string) {
    const { error } = await this.client.auth.updateUser({ password: newPassword });
    if (error) throw mapError(error);
  }
  async getAccessToken() {
    const { data } = await this.client.auth.getSession();
    return data.session?.access_token ?? null;
  }
  async deleteAccount() {
    // Impossible côté client (clé « service role » requise) : fonction serveur dédiée.
    const { error } = await this.client.functions.invoke('delete-account', { method: 'POST' });
    if (error) throw new AuthError('La suppression du compte n’est pas disponible (fonction serveur non déployée). Voir la documentation.', 'unknown');
    await this.client.auth.signOut().catch(() => undefined);
  }
}

interface ProfileRow {
  id: string; email: string | null; first_name: string | null; last_name: string | null; avatar_url: string | null; institution: string | null;
  academic_year: string | null; usage_type: string | null; onboarding_completed: boolean;
}
const fromRow = (r: ProfileRow, u: AuthUser): Profile => ({
  id: u.id, email: u.email, firstName: r.first_name ?? '', lastName: r.last_name ?? '', avatarUrl: r.avatar_url ?? '', institution: r.institution ?? '',
  academicYear: r.academic_year ?? '', usageType: r.usage_type ?? '', onboardingCompleted: r.onboarding_completed,
});

export class SupabaseProfiles implements ProfileRepository {
  constructor(private client: SupabaseClient) {}
  async get(user: AuthUser): Promise<Profile> {
    const { data, error } = await this.client.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return fromRow(data as ProfileRow, user);
    const { error: e2 } = await this.client.from('profiles').upsert({ id: user.id, email: user.email });
    if (e2) throw new Error(e2.message);
    return emptyProfile(user);
  }
  async update(user: AuthUser, patch: Partial<Omit<Profile, 'id' | 'email'>>): Promise<Profile> {
    const row: Record<string, unknown> = { id: user.id, email: user.email };
    if (patch.firstName !== undefined) row.first_name = patch.firstName.trim() || null;
    if (patch.lastName !== undefined) row.last_name = patch.lastName.trim() || null;
    if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl || null;
    if (patch.institution !== undefined) row.institution = patch.institution.trim() || null;
    if (patch.academicYear !== undefined) row.academic_year = patch.academicYear.trim() || null;
    if (patch.usageType !== undefined) row.usage_type = patch.usageType || null;
    if (patch.onboardingCompleted !== undefined) row.onboarding_completed = patch.onboardingCompleted;
    const { data, error } = await this.client.from('profiles').upsert(row).select().single();
    if (error) throw new Error(error.message);
    return fromRow(data as ProfileRow, user);
  }
}
