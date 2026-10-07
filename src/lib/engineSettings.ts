import { scoped } from './scope';

export interface EngineSettings { providerId: string; fallbackToLocal: boolean }
const KEY = 'lexnote.engine';
export function loadEngineSettings(): EngineSettings {
  try { return { providerId: 'local', fallbackToLocal: true, ...(JSON.parse(localStorage.getItem(scoped(KEY)) ?? 'null') ?? {}) }; } catch { return { providerId: 'local', fallbackToLocal: true }; }
}
export function saveEngineSettings(patch: Partial<EngineSettings>): EngineSettings {
  const next = { ...loadEngineSettings(), ...patch };
  try { localStorage.setItem(scoped(KEY), JSON.stringify(next)); } catch { /* préférence non persistée */ }
  return next;
}
