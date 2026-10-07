/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** `mock` : backend simulé pour les tests automatisés (jamais en production). */
  readonly VITE_BACKEND?: string;
}
