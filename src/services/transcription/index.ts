/**
 * Registre des moteurs de transcription.
 *
 * Choix V2 (voir README « Choix du moteur ») :
 *  - `webspeech`          : live, zéro configuration (Chrome/Safari) — l'audio peut transiter par le cloud du navigateur ;
 *  - `openai-compatible`  : Whisper par chunks — API OpenAI (clé de l'utilisateur) ou serveur Whisper local ;
 *  - Whisper WASM/WebGPU dans le navigateur : prévu (même interface), NON implémenté.
 * Sans moteur disponible, LexNote enregistre quand même l'audio (« audio seul ») : rien n'est simulé.
 */
import { loadEngineSettings } from './settings';
import { OpenAICompatibleProvider } from './providers/openaiCompatible';
import { WebSpeechProvider } from './providers/webSpeech';
import type { TranscriptionProvider } from './types';

export type { TranscriptionProvider, ProviderContext, SegmentDraft } from './types';

export interface ProviderEntry {
  id: string;
  label: string;
  planned?: boolean;
  create(): TranscriptionProvider;
}

export const PROVIDERS: ProviderEntry[] = [
  { id: 'webspeech', label: 'Reconnaissance vocale du navigateur', create: () => new WebSpeechProvider() },
  { id: 'openai-compatible', label: 'Whisper (API compatible OpenAI / serveur local)', create: () => new OpenAICompatibleProvider() },
];
export const PLANNED_PROVIDERS = [
  { id: 'whisper-wasm', label: 'Whisper dans le navigateur (WASM / WebGPU)' },
];

/** Résout le moteur à utiliser. `auto` : le premier disponible. Renvoie `null` = audio seul. */
export function resolveProvider(): TranscriptionProvider | null {
  const { providerId } = loadEngineSettings();
  if (providerId === 'none') return null;
  const order = providerId === 'auto' ? PROVIDERS : PROVIDERS.filter((p) => p.id === providerId);
  for (const entry of order) {
    const p = entry.create();
    if (p.availability().available) return p;
  }
  return null;
}

export function describeProviders() {
  return PROVIDERS.map((e) => {
    const p = e.create();
    return { id: e.id, label: e.label, availability: p.availability(), mode: p.mode, privacyNote: p.privacyNote() };
  });
}
