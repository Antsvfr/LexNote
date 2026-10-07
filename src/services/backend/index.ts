import { createClient } from '@supabase/supabase-js';
import type { AuthRepository, ProfileRepository } from '../auth/types';
import { SupabaseAuth, SupabaseProfiles } from '../auth/supabaseAuth';
import { SupabaseRemote } from '../sync/supabaseRemote';
import type { RemoteStore } from '../sync/types';

export type BackendKind = 'supabase' | 'mock' | 'unconfigured';

export interface Backend {
  kind: BackendKind;
  auth: AuthRepository;
  profiles: ProfileRepository;
  /** Accès distant aux données d'UN utilisateur (la RLS fait le reste côté base). */
  remoteFor(userId: string): RemoteStore;
}

/** Variables attendues (voir .env.example). Ce sont des valeurs PUBLIQUES (clé « anon ») : la sécurité vient de la RLS. */
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = () => !!URL && !!ANON && !/votre-projet|your-project|xxxx/i.test(URL);

let cached: Promise<Backend> | null = null;

export function getBackend(): Promise<Backend> {
  cached ??= (async (): Promise<Backend> => {
    // Branche éliminée à la compilation sauf si VITE_BACKEND=mock (tests automatisés).
    if (import.meta.env.VITE_BACKEND === 'mock') {
      const { createMockBackend } = await import('./mockBackend');
      return createMockBackend();
    }
    if (!isSupabaseConfigured()) {
      const reject = async () => { throw new Error('LexNote n’est pas connecté à un projet Supabase.'); };
      return {
        kind: 'unconfigured',
        auth: {
          getSession: async () => ({ user: null, offlineFallback: false }),
          onAuthChange: () => () => undefined,
          signUp: reject, signIn: reject, signOut: async () => undefined, requestPasswordReset: reject, updatePassword: reject, deleteAccount: reject,
        },
        profiles: { get: reject, update: reject },
        remoteFor: () => { throw new Error('Supabase non configuré'); },
      };
    }
    const client = createClient(URL!, ANON!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'lexnote-auth' },
    });
    return {
      kind: 'supabase',
      auth: new SupabaseAuth(client),
      profiles: new SupabaseProfiles(client),
      remoteFor: (userId) => new SupabaseRemote(client, userId),
    };
  })();
  return cached;
}
