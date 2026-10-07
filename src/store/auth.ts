import { create } from 'zustand';
import {
  refreshAuthSession,
  restPatch,
  restSelect,
  sendPasswordReset,
  signInWithPassword,
  signOut as remoteSignOut,
  signUp,
  type SupabaseSession,
  updatePassword as remoteUpdatePassword,
} from '@/services/supabase/client';

export interface CloudProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  institution: string;
  academicYear: string;
  quote: string;
  onboardingCompleted: boolean;
}

type AuthStatus = 'loading' | 'anonymous' | 'authenticated';
const SESSION_KEY = 'lexnote.auth.session';
const DEFAULT_QUOTE = 'Comprendre aujourd’hui, maîtriser demain.';

function readSession(): SupabaseSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as SupabaseSession : null;
  } catch { return null; }
}

function saveSession(session: SupabaseSession | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* session non persistée */ }
}

interface AuthState {
  status: AuthStatus;
  session: SupabaseSession | null;
  profile: CloudProfile | null;
  error: string | null;
  message: string | null;
  recoveryMode: boolean;
  initialize(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, firstName: string): Promise<'authenticated' | 'confirm_email'>;
  sendReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  updateProfile(patch: Partial<Omit<CloudProfile, 'id' | 'email'>>): Promise<void>;
  signOut(): Promise<void>;
  clearMessages(): void;
}

async function loadProfile(session: SupabaseSession): Promise<CloudProfile> {
  const rows = await restSelect<Record<string, unknown>>(
    'profiles',
    'select=*&id=eq.' + encodeURIComponent(session.user.id) + '&limit=1',
    session.access_token,
  );
  const r = rows[0] ?? {};
  return {
    id: session.user.id,
    email: String(r.email ?? session.user.email ?? ''),
    firstName: String(r.first_name ?? session.user.user_metadata?.first_name ?? ''),
    lastName: String(r.last_name ?? ''),
    avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
    institution: String(r.institution ?? ''),
    academicYear: String(r.academic_year ?? ''),
    quote: String(r.quote ?? DEFAULT_QUOTE),
    onboardingCompleted: Boolean(r.onboarding_completed),
  };
}

function decodeSub(jwt: string): string {
  try {
    const part = jwt.split('.')[1];
    if (!part) return '';
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string };
    return json.sub ?? '';
  } catch { return ''; }
}

function sessionFromHash(): { session: SupabaseSession; recovery: boolean } | null {
  if (typeof window === 'undefined' || !window.location.hash.includes('access_token=')) return null;
  const p = new URLSearchParams(window.location.hash.slice(1));
  const access = p.get('access_token');
  const refresh = p.get('refresh_token');
  if (!access || !refresh) return null;
  const expiresIn = Number(p.get('expires_in') ?? 3600);
  const session: SupabaseSession = {
    access_token: access,
    refresh_token: refresh,
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    token_type: p.get('token_type') ?? 'bearer',
    user: { id: decodeSub(access) },
  };
  return session.user.id ? { session, recovery: p.get('type') === 'recovery' } : null;
}

let refreshTimer: number | null = null;

function scheduleRefresh(session: SupabaseSession) {
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  const ms = Math.max(15_000, session.expires_at * 1000 - Date.now() - 60_000);
  refreshTimer = window.setTimeout(() => { void useAuth.getState().initialize(); }, ms);
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  session: null,
  profile: null,
  error: null,
  message: null,
  recoveryMode: false,

  async initialize() {
    set({ status: 'loading', error: null });
    try {
      const redirected = sessionFromHash();
      let session = redirected?.session ?? readSession();
      const recoveryMode = redirected?.recovery ?? false;
      if (redirected) {
        saveSession(session);
        history.replaceState(null, '', recoveryMode ? '/reset-password' : '/');
      }
      if (!session) {
        set({ status: 'anonymous', session: null, profile: null, recoveryMode: false });
        return;
      }
      if (session.expires_at * 1000 <= Date.now() + 60_000) {
        session = await refreshAuthSession(session.refresh_token);
        saveSession(session);
      }
      const profile = await loadProfile(session);
      scheduleRefresh(session);
      set({ status: 'authenticated', session, profile, recoveryMode, error: null });
    } catch (err) {
      console.warn('[LexNote] session invalide', err);
      saveSession(null);
      set({ status: 'anonymous', session: null, profile: null, recoveryMode: false, error: null });
    }
  },

  async signIn(email, password) {
    set({ error: null, message: null });
    try {
      const session = await signInWithPassword(email.trim(), password);
      saveSession(session);
      const profile = await loadProfile(session);
      scheduleRefresh(session);
      set({ status: 'authenticated', session, profile, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Connexion impossible.';
      set({ error: message });
      throw err;
    }
  },

  async signUp(email, password, firstName) {
    set({ error: null, message: null });
    try {
      const out = await signUp(email.trim(), password, firstName.trim());
      if (!out.session) {
        set({ status: 'anonymous', message: 'Compte créé. Vérifiez votre e-mail pour confirmer votre adresse.' });
        return 'confirm_email';
      }
      saveSession(out.session);
      const profile = await loadProfile(out.session);
      scheduleRefresh(out.session);
      set({ status: 'authenticated', session: out.session, profile });
      return 'authenticated';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Inscription impossible.';
      set({ error: message });
      throw err;
    }
  },

  async sendReset(email) {
    set({ error: null, message: null });
    try {
      await sendPasswordReset(email.trim());
      set({ message: 'Si ce compte existe, un e-mail de réinitialisation vient d’être envoyé.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Envoi impossible.';
      set({ error: message });
      throw err;
    }
  },

  async updatePassword(password) {
    const token = get().session?.access_token;
    if (!token) throw new Error('Session expirée.');
    await remoteUpdatePassword(token, password);
    set({ recoveryMode: false, message: 'Mot de passe mis à jour.' });
  },

  async updateProfile(patch) {
    const session = get().session;
    const current = get().profile;
    if (!session || !current) throw new Error('Session expirée.');
    const dbPatch: Record<string, unknown> = {};
    if (patch.firstName !== undefined) dbPatch.first_name = patch.firstName.trim();
    if (patch.lastName !== undefined) dbPatch.last_name = patch.lastName.trim();
    if (patch.avatarUrl !== undefined) dbPatch.avatar_url = patch.avatarUrl;
    if (patch.institution !== undefined) dbPatch.institution = patch.institution.trim();
    if (patch.academicYear !== undefined) dbPatch.academic_year = patch.academicYear.trim();
    if (patch.quote !== undefined) dbPatch.quote = patch.quote.trim();
    if (patch.onboardingCompleted !== undefined) dbPatch.onboarding_completed = patch.onboardingCompleted;
    await restPatch('profiles', 'id=eq.' + encodeURIComponent(session.user.id), dbPatch, session.access_token);
    set({ profile: { ...current, ...patch } });
  },

  async signOut() {
    const token = get().session?.access_token;
    if (token) await remoteSignOut(token);
    if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    refreshTimer = null;
    saveSession(null);
    set({ status: 'anonymous', session: null, profile: null, error: null, message: null, recoveryMode: false });
  },

  clearMessages() { set({ error: null, message: null }); },
}));

export { DEFAULT_QUOTE };