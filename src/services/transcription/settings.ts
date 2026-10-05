/** Réglages du moteur de transcription — stockés uniquement dans le localStorage de cet appareil. */
export interface EngineSettings {
  providerId: string;
  language: string;
  keepAudio: boolean;
  /** API compatible OpenAI. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Durée d'un segment audio (ms). Réglage avancé, 30 000 par défaut. */
  chunkMs?: number;
}

const KEY = 'lexnote.transcription';
export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
  providerId: 'auto',
  language: 'fr-FR',
  keepAudio: true,
  baseUrl: '',
  apiKey: '',
  model: 'whisper-1',
};

export function loadEngineSettings(): EngineSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULT_ENGINE_SETTINGS, ...(raw ? (JSON.parse(raw) as Partial<EngineSettings>) : {}) };
  } catch {
    return { ...DEFAULT_ENGINE_SETTINGS };
  }
}
export function saveEngineSettings(patch: Partial<EngineSettings>): EngineSettings {
  const next = { ...loadEngineSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* préférence non persistée */ }
  return next;
}

const CONSENT_KEY = 'lexnote.recordingConsent';
export const hasRecordingConsent = () => { try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch { return false; } };
export const grantRecordingConsent = () => { try { localStorage.setItem(CONSENT_KEY, '1'); } catch { /* sans effet */ } };
export const resetRecordingConsent = () => { try { localStorage.removeItem(CONSENT_KEY); } catch { /* sans effet */ } };
