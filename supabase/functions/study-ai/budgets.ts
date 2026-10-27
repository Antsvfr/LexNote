// Budgets, limites et interrupteur de `study-ai` — AUCUNE dépendance (ni Deno, ni réseau) : testé par Vitest ET par Deno.
//
// Tout ce qui pèse sur le COÛT est ici, lisible d'un coup d'œil :
//   1. plafond de SORTIE par action (jetons) — jamais 64 000 ;
//   2. limites PAR UTILISATEUR (simultanés, minute, jour, volume de texte) ;
//   3. budget GLOBAL (requêtes et volume de texte par jour, tous utilisateurs confondus) ;
//   4. interrupteur d'urgence STUDY_AI_ENABLED.
// Les valeurs viennent de secrets serveur ; une valeur invalide retombe sur la valeur par défaut (jamais « illimité » par accident).
import type { Task } from './prompts.ts';

/** Plafond absolu d'une sortie, quelle que soit l'action et quelle que soit la configuration. */
export const HARD_MAX_OUTPUT_TOKENS = 15_000;

/**
 * Budget de sortie PAR ACTION. `tier` donne l'intention (petit / moyen / élevé) ; `base` le plafond de rédaction ;
 * la marge de réflexion s'ajoute (réduite pour les tâches mécaniques). Les tâches « proportionnelles » suivent la taille du texte reçu.
 *
 *   petit  ≈ 1 500 – 3 000     moyen ≈ 3 500 – 4 000     élevé ≈ 8 000 (+ réflexion)
 */
export type Tier = 'small' | 'medium' | 'high' | 'proportional';
export interface ActionBudget { tier: Tier; base: (inTok: number, options: Record<string, string | number | boolean>) => number }
const fixed = (n: number) => () => n;

export const ACTION_BUDGETS: Record<Task, ActionBudget> = {
  // résumés : express petit, standard moyen, détaillé élevé
  summarize: { tier: 'medium', base: (_i, o) => (o.mode === 'express' ? 1_500 : o.mode === 'detailed' ? 8_000 : 4_000) },
  'key-points': { tier: 'small', base: fixed(2_500) },
  'to-remember': { tier: 'small', base: fixed(2_500) },
  explain: { tier: 'small', base: fixed(2_500) },
  flashcard: { tier: 'small', base: fixed(2_500) },
  glossary: { tier: 'small', base: fixed(3_000) },
  definitions: { tier: 'small', base: fixed(3_000) },
  concepts: { tier: 'medium', base: fixed(4_000) },
  'course-plan': { tier: 'medium', base: fixed(4_000) },
  'exam-questions': { tier: 'medium', base: fixed(3_500) },
  'teacher-questions': { tier: 'medium', base: fixed(3_500) },
  ambiguities: { tier: 'medium', base: fixed(3_500) },
  'important-passages': { tier: 'medium', base: fixed(3_500) },
  // synthèse intermédiaire d'une partie de longue transcription : ≈ 30 % de l'entrée
  digest: { tier: 'proportional', base: (i) => Math.min(3_000, Math.max(800, Math.ceil(i * 0.3))) },
  // structuration : moyen / élevé, ≈ taille du texte
  structure: { tier: 'proportional', base: (i) => Math.min(12_000, Math.max(3_000, Math.ceil(i * 1.1))) },
  // traduction / nettoyage : proportionnels à la partie traitée (le client découpe à 16 000 caractères)
  translate: { tier: 'proportional', base: (i) => Math.min(12_000, Math.max(1_000, Math.ceil(i * 1.5))) },
  clean: { tier: 'proportional', base: (i) => Math.min(12_000, Math.max(1_000, Math.ceil(i * 1.5))) },
};
/** Tâches « mécaniques » (partie par partie) : effort réduit et moindre marge de réflexion. */
export const LOW_EFFORT: readonly Task[] = ['translate', 'clean', 'digest'];

export function maxTokensFor(task: Task, inputChars: number, options: Record<string, string | number | boolean>, ceiling = HARD_MAX_OUTPUT_TOKENS): number {
  const inTok = Math.ceil(Math.max(0, inputChars) / 4); // ordre de grandeur : ~4 caractères par jeton
  const thinking = LOW_EFFORT.includes(task) ? 1_000 : 3_000;
  return Math.max(500, Math.min(ACTION_BUDGETS[task].base(inTok, options) + thinking, ceiling, HARD_MAX_OUTPUT_TOKENS));
}

/* ------------------------------------------------------------------ configuration (secrets serveur) */
type Env = (name: string) => string | undefined;

/** Entier borné ; vide, non numérique, négatif ou hors bornes → valeur par défaut. */
export function intEnv(raw: string | undefined, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** Limites par utilisateur : protection contre les coûts et les abus. */
export const userLimits = (env: Env) => ({
  maxConcurrent: intEnv(env('STUDY_AI_MAX_CONCURRENT'), 2, 1, 20),
  perMinute: intEnv(env('STUDY_AI_MAX_PER_MINUTE'), 12, 1, 600),
  perDay: intEnv(env('STUDY_AI_MAX_PER_DAY'), 200, 1, 100_000),
  charsPerDay: intEnv(env('STUDY_AI_MAX_CHARS_PER_DAY'), 3_000_000, 1_000, 1_000_000_000),
});

/**
 * Budget GLOBAL (tous utilisateurs, fenêtre glissante de 24 h). Valeurs par défaut volontairement prudentes pour un lancement ;
 * `0` désactive explicitement la limite (à éviter en production).
 */
export const globalLimits = (env: Env) => ({
  requestsPerDay: intEnv(env('STUDY_AI_GLOBAL_MAX_REQUESTS_DAY'), 2_000, 0, 10_000_000),
  charsPerDay: intEnv(env('STUDY_AI_GLOBAL_MAX_CHARS_DAY'), 20_000_000, 0, 100_000_000_000),
});

/** Plafond de sortie configurable (ne peut que BAISSER le plafond absolu). */
export const outputCeiling = (env: Env) => intEnv(env('STUDY_AI_MAX_OUTPUT_TOKENS'), HARD_MAX_OUTPUT_TOKENS, 500, HARD_MAX_OUTPUT_TOKENS);

/** Délai maximal d'un appel au modèle (la plateforme coupe la fonction au-delà de ~150 s). */
export const modelTimeoutMs = (env: Env) => intEnv(env('STUDY_AI_TIMEOUT_MS'), 120_000, 1, 140_000);

/**
 * INTERRUPTEUR D'URGENCE : `STUDY_AI_ENABLED=false` (ou 0 / off / no / disabled) coupe immédiatement tout appel payant.
 * Non défini → activé (comportement historique). Toute autre valeur → activé, sauf les valeurs « off » ci-dessus.
 */
export function isAiEnabled(env: Env): boolean {
  const v = (env('STUDY_AI_ENABLED') ?? '').trim().toLowerCase();
  return !['false', '0', 'off', 'no', 'disabled', 'non'].includes(v);
}

/** Codes d'erreur diagnostic renvoyés à l'utilisateur (sans détail interne). */
export const AI_ERROR_CODES: Record<string, string> = {
  ai_disabled: 'AI-DISABLED', ai_capacity: 'AI-CAPACITY', rate_limited: 'AI-429', rate_limit_unavailable: 'AI-GATE',
  not_configured: 'AI-CONFIG', provider_busy: 'AI-503', unavailable: 'AI-503', timeout: 'AI-504', refused: 'AI-422',
  truncated: 'AI-502', empty: 'AI-502', bad_request: 'AI-400', payload_too_large: 'AI-413', unauthorized: 'AI-401', internal: 'AI-500',
};
