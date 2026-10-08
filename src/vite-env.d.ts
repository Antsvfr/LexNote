/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** `mock` : backend simulé pour les tests automatisés (jamais en production). */
  readonly VITE_BACKEND?: string;
  /** Point d'accès (Edge Function) du moteur de cours distant — facultatif ; aucune clé de modèle dans l'application. */
  readonly VITE_ENGINE_URL?: string;
}
