// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ACTION_BUDGETS, HARD_MAX_OUTPUT_TOKENS, globalLimits, intEnv, isAiEnabled, maxTokensFor, modelTimeoutMs, outputCeiling, userLimits } from '../../supabase/functions/study-ai/budgets';
import { TASKS } from '../../supabase/functions/study-ai/prompts';

/** Garde-fous de COÛT de `study-ai` : budgets de sortie par action, limites, budget global, interrupteur. Sans réseau. */
const env = (o: Record<string, string>) => (k: string) => o[k];
const SIZES = [0, 1, 200, 4_000, 16_000, 60_000, 80_000];
const OPTIONS: Record<string, string>[] = [{}, { mode: 'express' }, { mode: 'standard' }, { mode: 'detailed' }];

describe('budgets de sortie par action', () => {
  it('chaque action a un budget ; AUCUNE n’approche 64 000 jetons ; plafond absolu respecté pour toute taille d’entrée', () => {
    expect(Object.keys(ACTION_BUDGETS).sort()).toEqual([...TASKS].sort());
    expect(HARD_MAX_OUTPUT_TOKENS).toBeLessThan(64_000);
    for (const t of TASKS) for (const n of SIZES) for (const o of OPTIONS) {
      const v = maxTokensFor(t, n, o);
      expect(v, `${t} @${n}`).toBeGreaterThanOrEqual(500);
      expect(v, `${t} @${n}`).toBeLessThanOrEqual(HARD_MAX_OUTPUT_TOKENS);
    }
  });
  it('résumé : express < standard < détaillé', () => {
    const r = (mode: string) => maxTokensFor('summarize', 40_000, { mode });
    expect(r('express')).toBeLessThan(r('standard')); expect(r('standard')).toBeLessThan(r('detailed'));
    expect(r('express')).toBe(4_500); expect(r('standard')).toBe(7_000); expect(r('detailed')).toBe(11_000);
  });
  it('petit / moyen / élevé : points clés < glossaire ≤ questions d’examen < structuration (grand texte)', () => {
    const v = (t: (typeof TASKS)[number]) => maxTokensFor(t, 40_000, {});
    expect(v('key-points')).toBeLessThanOrEqual(v('glossary'));
    expect(v('glossary')).toBeLessThan(v('exam-questions'));
    expect(v('exam-questions')).toBeLessThan(v('structure'));
    expect(v('key-points')).toBeLessThanOrEqual(5_500);
  });
  it('traduction / nettoyage proportionnels à la partie (plancher et plafond), jamais d’explosion sur un petit texte', () => {
    expect(maxTokensFor('translate', 200, {})).toBe(2_000);
    expect(maxTokensFor('translate', 16_000, {})).toBe(7_000);
    expect(maxTokensFor('translate', 16_000, {})).toBeGreaterThan(maxTokensFor('translate', 4_000, {}));
    expect(maxTokensFor('clean', 80_000, {})).toBe(13_000);
  });
  it('STUDY_AI_MAX_OUTPUT_TOKENS ne peut que BAISSER le plafond, jamais le relever', () => {
    expect(outputCeiling(env({ STUDY_AI_MAX_OUTPUT_TOKENS: '3000' }))).toBe(3_000);
    expect(outputCeiling(env({ STUDY_AI_MAX_OUTPUT_TOKENS: '64000' }))).toBe(HARD_MAX_OUTPUT_TOKENS);
    expect(outputCeiling(env({ STUDY_AI_MAX_OUTPUT_TOKENS: 'beaucoup' }))).toBe(HARD_MAX_OUTPUT_TOKENS);
    expect(maxTokensFor('structure', 60_000, {}, 3_000)).toBe(3_000);
    expect(maxTokensFor('structure', 60_000, {}, 64_000)).toBe(HARD_MAX_OUTPUT_TOKENS);
  });
});

describe('configuration par secrets : une valeur invalide ne désactive JAMAIS une limite', () => {
  it('intEnv : vide, texte, négatif, décimal, hors bornes → valeur par défaut', () => {
    for (const bad of [undefined, '', '  ', 'abc', 'NaN', '-5', '1.5', '1e9', '999999999999999999999']) expect(intEnv(bad, 12, 1, 600), String(bad)).toBe(12);
    expect(intEnv('30', 12, 1, 600)).toBe(30);
  });
  it('limites utilisateur : valeurs par défaut prudentes', () => {
    expect(userLimits(env({}))).toEqual({ maxConcurrent: 2, perMinute: 12, perDay: 200, charsPerDay: 3_000_000 });
    expect(userLimits(env({ STUDY_AI_MAX_PER_MINUTE: 'abc', STUDY_AI_MAX_PER_DAY: '0' })).perMinute).toBe(12);
    expect(userLimits(env({ STUDY_AI_MAX_PER_DAY: '0' })).perDay).toBe(200);         // 0 n'est pas « illimité » pour un utilisateur
  });
  it('budget global : défauts finis ; 0 = illimité seulement si explicite ; invalide → défaut', () => {
    expect(globalLimits(env({}))).toEqual({ requestsPerDay: 2_000, charsPerDay: 20_000_000 });
    expect(globalLimits(env({ STUDY_AI_GLOBAL_MAX_REQUESTS_DAY: '500', STUDY_AI_GLOBAL_MAX_CHARS_DAY: '5000000' }))).toEqual({ requestsPerDay: 500, charsPerDay: 5_000_000 });
    expect(globalLimits(env({ STUDY_AI_GLOBAL_MAX_REQUESTS_DAY: '0' })).requestsPerDay).toBe(0);
    expect(globalLimits(env({ STUDY_AI_GLOBAL_MAX_REQUESTS_DAY: 'oops' })).requestsPerDay).toBe(2_000);
  });
  it('délai : borné', () => {
    expect(modelTimeoutMs(env({}))).toBe(120_000);
    expect(modelTimeoutMs(env({ STUDY_AI_TIMEOUT_MS: '999999' }))).toBe(120_000);
  });
});

describe('interrupteur STUDY_AI_ENABLED', () => {
  it('désactivé seulement par une valeur « off » explicite ; non défini ou inconnu → activé', () => {
    for (const off of ['false', 'FALSE', ' False ', '0', 'off', 'no', 'disabled', 'non']) expect(isAiEnabled(env({ STUDY_AI_ENABLED: off })), off).toBe(false);
    for (const on of [undefined, '', 'true', '1', 'yes', 'peut-etre']) expect(isAiEnabled(env(on === undefined ? {} : { STUDY_AI_ENABLED: on })), String(on)).toBe(true);
  });
});
