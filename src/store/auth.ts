import { create } from 'zustand';
import { AuthError, emptyProfile, type AuthUser, type Profile } from '@/services/auth/types';
import { getBackend, type Backend, type BackendKind } from '@/services/backend';
import { closeWorkspace, openWorkspace } from '@/services/workspace';
import { deviceLabel, isStandalone, markBrowserSession, readDevice, setRemember, shouldDiscardStoredSession } from '@/services/auth/device';
import { log } from '@/lib/log';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'unconfigured';
export type WorkspaceStatus = 'closed' | 'opening' | 'ready' | 'error';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  profile: Profile | null;
  workspace: WorkspaceStatus;
  workspaceError: string | null;
  backendKind: BackendKind | null;
  /** Session restaurée sans réseau (jeton non rafraîchissable) : l'utilisateur travaille en local. */
  offlineSession: boolean;
  /** Un lien de réinitialisation de mot de passe vient d'être ouvert. */
  recovering: boolean;
  /** Le profil (cache ou serveur) est connu : évite d'afficher l'onboarding à tort à un utilisateur existant. */
  profileReady: boolean;
  /** La session a été perdue PENDANT l'usage (jeton de rafraîchissement refusé…) : la page de connexion l'explique. */
  sessionExpired: boolean;

  init(): Promise<void>;
  /** `remember` : « Rester connecté sur cet appareil » (session conservée après fermeture du navigateur). */
  signIn(email: string, password: string, opts?: { remember?: boolean }): Promise<void>;
  /** Session ordinaire remise par le serveur LexNote (connexion automatique depuis REV-EM). */
  adoptSession(tokens: { access_token: string; refresh_token: string }): Promise<void>;
  /** La session n'est plus utilisable : retour à la connexion, avec explication, sans perdre la page demandée. */
  sessionLost(): Promise<void>;
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  /** `everywhere` : « Déconnecter tous les appareils » (révoque toutes les sessions du compte). */
  signOut(opts?: { everywhere?: boolean }): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(pw: string): Promise<void>;
  updateProfile(patch: Partial<Omit<Profile, 'id' | 'email'>>): Promise<void>;
  deleteAccount(): Promise<void>;
}

const LAST_USER_KEY = 'lexnote.lastUser';
const profileKey = (id: string) => `lexnote.profile.${id}`;
const readJson = <T,>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) ?? 'null') as T | null; } catch { return null; } };
const writeJson = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* cache non persisté */ } };

let backend: Backend | null = null;
let unsubscribe: (() => void) | null = null;
let applying: Promise<void> = Promise.resolve();

/** Registre des appareils : best effort, jamais bloquant (hors ligne, ancienne base sans la table : sans effet). */
async function touchDevice() {
  try { const d = readDevice(); await backend?.auth.devices?.touch({ deviceId: d.id, label: `${deviceLabel()}${isStandalone() ? ' · application' : ''}`, standalone: isStandalone(), remember: d.remember }); }
  catch { /* sans effet */ }
}

export const useAuth = create<AuthState>((set, get) => {
  /** Applique un changement d'identité : ouvre l'espace du nouvel utilisateur, ou ferme et vide tout. Sérialisé. */
  function apply(user: AuthUser | null, opts: { offline?: boolean } = {}) {
    applying = applying.then(async () => {
      const prev = get().user;
      if (user && prev?.id === user.id && get().workspace === 'ready') { set({ status: 'authenticated', user }); return; }
      if (prev && (!user || prev.id !== user.id)) {
        await closeWorkspace();
        set({ user: null, profile: null, workspace: 'closed', workspaceError: null, profileReady: false });
      }
      if (!user) { set({ status: 'unauthenticated', user: null, profile: null, workspace: 'closed', offlineSession: false, profileReady: false }); return; }

      writeJson(LAST_USER_KEY, user);
      if (!opts.offline) void touchDevice();
      const cached = readJson<Profile>(profileKey(user.id));
      set({ status: 'authenticated', user, workspace: 'opening', workspaceError: null, offlineSession: !!opts.offline, profile: cached ?? emptyProfile(user), profileReady: !!cached });
      try {
        await openWorkspace(user, backend!);
        set({ workspace: 'ready' });
      } catch (e) {
        log.auth.error('ouverture de l’espace de travail', e);
        set({ workspace: 'error', workspaceError: (e as Error).message });
        return;
      }
      // Profil : on affiche le cache tout de suite, puis on rafraîchit depuis le serveur si possible.
      try {
        const p = await backend!.profiles.get(user);
        if (get().user?.id === user.id) { writeJson(profileKey(user.id), p); set({ profile: p }); }
      } catch { /* hors ligne : le cache suffit */ }
      if (get().user?.id === user.id) set({ profileReady: true });
    });
    return applying;
  }

  return {
    status: 'loading', user: null, profile: null, workspace: 'closed', workspaceError: null, backendKind: null, offlineSession: false, recovering: false, profileReady: false, sessionExpired: false,

    async init() {
      backend = await getBackend();
      set({ backendKind: backend.kind });
      if (backend.kind === 'unconfigured') { set({ status: 'unconfigured' }); return; }
      unsubscribe?.();
      unsubscribe = backend.auth.onAuthChange((event, user) => {
        if (event === 'PASSWORD_RECOVERY') { set({ recovering: true }); }
        if (event === 'SIGNED_OUT') { void apply(null); return; }
        if (user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED')) void apply(user);
      });
      // « Rester connecté » décoché et navigateur fermé depuis : la session stockée est révoquée (cet appareil seulement) avant tout usage.
      if (shouldDiscardStoredSession()) { try { await backend.auth.signOut({ scope: 'local' }); } catch { /* hors ligne : effacée localement par supabase-js */ } }
      markBrowserSession();
      const { user, offlineFallback } = await backend.auth.getSession();
      if (user) { await apply(user); return; }
      if (offlineFallback) {
        // Hors ligne avec une session stockée mais non rafraîchissable : on rouvre l'espace LOCAL du dernier utilisateur.
        const last = readJson<AuthUser>(LAST_USER_KEY);
        if (last) { await apply(last, { offline: true }); return; }
      }
      await apply(null);
    },

    async signIn(email, password, opts = {}) {
      setRemember(opts.remember === true);          // AVANT la connexion : décide du sort de la session à la fermeture du navigateur
      markBrowserSession();
      const user = await backend!.auth.signIn(email, password);
      set({ sessionExpired: false });
      await apply(user);
    },
    async adoptSession(tokens) {
      markBrowserSession();
      const user = await backend!.auth.adoptSession(tokens);
      set({ sessionExpired: false });
      await apply(user);
    },
    async sessionLost() {
      set({ sessionExpired: true });
      try { await backend!.auth.signOut({ scope: 'local' }); } catch { /* jeton déjà invalide : rien à révoquer */ }
      await apply(null);
    },
    async signUp(email, password) {
      const res = await backend!.auth.signUp(email, password);
      if (res.user) await apply(res.user);
      return { needsConfirmation: res.needsConfirmation };
    },
    async signOut(opts = {}) {
      if (opts.everywhere) { try { await backend!.auth.devices?.forgetAll(); } catch { /* best effort */ } }
      try { await backend!.auth.signOut({ scope: opts.everywhere ? 'global' : 'local' }); } catch (e) { if (!(e instanceof AuthError) || e.code !== 'network') throw e; }
      try { localStorage.removeItem(LAST_USER_KEY); } catch { /* sans effet */ }
      await apply(null);
    },
    requestPasswordReset: (email) => backend!.auth.requestPasswordReset(email),
    async updatePassword(pw) { await backend!.auth.updatePassword(pw); set({ recovering: false }); },
    async updateProfile(patch) {
      const user = get().user;
      if (!user) return;
      // Optimiste + cache local ; si le serveur est injoignable, le cache garde la valeur (réessayée à la prochaine sauvegarde).
      const next = { ...(get().profile ?? emptyProfile(user)), ...patch };
      set({ profile: next }); writeJson(profileKey(user.id), next);
      try {
        const saved = await backend!.profiles.update(user, patch);
        if (get().user?.id === user.id) { set({ profile: saved }); writeJson(profileKey(user.id), saved); }
      } catch (e) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        throw e;
      }
    },
    async deleteAccount() {
      await backend!.auth.deleteAccount();
      await apply(null);
    },
  };
});
