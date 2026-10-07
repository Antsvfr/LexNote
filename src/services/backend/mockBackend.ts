/**
 * Backend SIMULÉ (comptes + « cloud » persistés dans le localStorage du navigateur).
 *
 * ⚠ Uniquement pour les tests automatisés et le développement hors ligne : activé par `VITE_BACKEND=mock` au
 * moment du build. Un build de production normal (Vercel) ne contient PAS ce code : le branchement est éliminé
 * à la compilation. La vraie sécurité (RLS) est testée séparément sur un Postgres réel (tests/db).
 */
import { AuthError, emptyProfile, type AuthEvent, type AuthRepository, type AuthUser, type Profile, type ProfileRepository, type SignUpResult } from '../auth/types';
import { CloudDb, InMemoryRemote } from '../sync/inMemoryRemote';
import type { RemoteStore } from '../sync/types';
import type { Backend } from './index';
import { saveEngineSettings } from '../../lib/engineSettings';
import { EngineUnavailableError, registerEngineProvider, setActiveEngineProvider } from '../engine/provider';

const AUTH_KEY = 'lexnote-mock-auth';
const CLOUD_KEY = 'lexnote-mock-cloud';
/** Coupure du « serveur » persistante (survit aux rechargements) pour tester le hors ligne. */
const DOWN_KEY = 'lexnote-mock-down';

interface MockUser { id: string; email: string; password: string; confirmed: boolean }
interface MockAuthState { users: MockUser[]; sessionUserId: string | null; profiles: Record<string, Profile> }

const load = (): MockAuthState => {
  try { return { users: [], sessionUserId: null, profiles: {}, ...(JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null') ?? {}) }; }
  catch { return { users: [], sessionUserId: null, profiles: {} }; }
};
const save = (s: MockAuthState) => localStorage.setItem(AUTH_KEY, JSON.stringify(s));
const uuid = () => crypto.randomUUID();

export function createMockBackend(): Backend {
  const cloud = CloudDb.fromJSON((() => { try { return JSON.parse(localStorage.getItem(CLOUD_KEY) ?? 'null'); } catch { return null; } })());
  Object.defineProperty(cloud, 'offline', { get: () => { try { return localStorage.getItem(DOWN_KEY) === '1'; } catch { return false; } }, set: () => undefined });
  cloud.onChange = () => localStorage.setItem(CLOUD_KEY, JSON.stringify(cloud));
  const listeners = new Set<(e: AuthEvent, u: AuthUser | null) => void>();
  const emit = (e: AuthEvent, u: AuthUser | null) => listeners.forEach((l) => l(e, u));
  const asUser = (u: MockUser | undefined): AuthUser | null => (u ? { id: u.id, email: u.email } : null);

  const auth: AuthRepository = {
    async getSession() {
      const st = load();
      return { user: asUser(st.users.find((u) => u.id === st.sessionUserId)), offlineFallback: false };
    },
    onAuthChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async signUp(email, password): Promise<SignUpResult> {
      const st = load();
      const e = email.trim().toLowerCase();
      if (st.users.some((u) => u.email === e)) throw new AuthError('Un compte existe déjà avec cet e-mail.', 'email_taken');
      if (password.length < 8) throw new AuthError('Mot de passe trop faible (8 caractères minimum).', 'weak_password');
      const user: MockUser = { id: uuid(), email: e, password, confirmed: true };
      st.users.push(user); st.sessionUserId = user.id; st.profiles[user.id] = emptyProfile({ id: user.id, email: e });
      save(st);
      emit('SIGNED_IN', asUser(user));
      return { needsConfirmation: false, user: asUser(user) };
    },
    async signIn(email, password) {
      const st = load();
      const u = st.users.find((x) => x.email === email.trim().toLowerCase());
      if (!u || u.password !== password) throw new AuthError('E-mail ou mot de passe incorrect.', 'invalid_credentials');
      st.sessionUserId = u.id; save(st);
      emit('SIGNED_IN', asUser(u));
      return asUser(u)!;
    },
    async signOut() { const st = load(); st.sessionUserId = null; save(st); emit('SIGNED_OUT', null); },
    async requestPasswordReset() { /* le vrai service envoie un e-mail ; ici rien à faire */ },
    async updatePassword(pw) {
      const st = load(); const u = st.users.find((x) => x.id === st.sessionUserId);
      if (!u) throw new AuthError('Session expirée.', 'unknown');
      if (pw.length < 8) throw new AuthError('Mot de passe trop faible (8 caractères minimum).', 'weak_password');
      u.password = pw; save(st);
    },
    async getAccessToken() { const st = load(); return st.sessionUserId ? `mock-token-${st.sessionUserId}` : null; },
    async deleteAccount() {
      const st = load(); const id = st.sessionUserId;
      st.users = st.users.filter((u) => u.id !== id); delete st.profiles[id ?? '']; st.sessionUserId = null; save(st);
      for (const m of cloud.tables.values()) for (const [k, r] of [...m]) if (r.user_id === id) m.delete(k);
      cloud.onChange?.();
      emit('SIGNED_OUT', null);
    },
  };

  const profiles: ProfileRepository = {
    async get(user) { return load().profiles[user.id] ?? emptyProfile(user); },
    async update(user, patch) {
      const st = load(); const p = { ...(st.profiles[user.id] ?? emptyProfile(user)), ...patch };
      st.profiles[user.id] = p; save(st); return p;
    },
  };

  // Outils de test (jamais présents en production) : couper le « serveur », altérer une ligne, lire l'état.
  (window as unknown as { __lx: unknown }).__lx = {
    cloud,
    setServerDown: (v: boolean) => { if (v) localStorage.setItem(DOWN_KEY, '1'); else localStorage.removeItem(DOWN_KEY); },
    rows: (table: string) => [...cloud.rows(table as never).values()],
    tamper: (table: string, id: string, patch: Record<string, unknown>) => {
      const r = cloud.rows(table as never).get(id);
      if (!r) throw new Error('ligne absente');
      cloud.rows(table as never).set(id, { ...r, ...patch, version: (r.version ?? 0) + 1, server_updated_at: cloud.now() });
      cloud.onChange?.();
    },
    /** Simule un moteur de cours distant injoignable (tests hors-ligne du moteur). */
    breakEngine: (fallback = false) => { registerEngineProvider({ id: 'remote', label: 'Moteur distant (simulé)', local: false, isAvailable: () => true, compose: async () => { throw new EngineUnavailableError('Moteur distant injoignable (réseau ?).'); } }); setActiveEngineProvider('remote'); saveEngineSettings({ providerId: 'remote', fallbackToLocal: !!fallback }); },
    users: () => load().users.map((u) => ({ id: u.id, email: u.email })),
  };

  return {
    kind: 'mock', auth, profiles,
    remoteFor: (userId: string): RemoteStore => new InMemoryRemote(cloud, userId),
  };
}
