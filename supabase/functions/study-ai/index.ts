// Edge Function « study-ai » — point d'entrée. Toute la logique (authentification, validation, appel au modèle) : handler.ts.
// Déploiement et sécurité : voir l'en-tête de handler.ts et docs/TRANSCRIPT_ACTIONS.md.
import { handler } from './handler.ts';

Deno.serve(handler);
