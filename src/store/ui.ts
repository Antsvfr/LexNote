import { create } from 'zustand';

export type ThemePref = 'light' | 'dark' | 'system';

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : préférence non persistée, sans conséquence */
  }
};

export function applyTheme(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#14182a' : '#f6f3ec');
}

interface NewCmPreset { subjectId?: string; moduleId?: string }

interface UIState {
  theme: ThemePref;
  /** Mode Focus CM (éditeur seul, distractions supprimées). */
  focus: boolean;
  /** Panneau secondaire de l'éditeur (futur assistant). */
  assistantOpen: boolean;
  paletteOpen: boolean;
  newCm: NewCmPreset | null;

  setTheme(t: ThemePref): void;
  setFocus(v: boolean): void;
  toggleAssistant(): void;
  setPalette(v: boolean): void;
  openNewCm(preset?: NewCmPreset): void;
  closeNewCm(): void;
}

export const useUI = create<UIState>((set, get) => ({
  theme: read<ThemePref>('lexnote.theme', 'system'),
  focus: false,
  assistantOpen: read('lexnote.assistantOpen', true),
  paletteOpen: false,
  newCm: null,

  setTheme: (theme) => {
    write('lexnote.theme', theme);
    applyTheme(theme);
    set({ theme });
  },
  setFocus: (focus) => set({ focus }),
  toggleAssistant: () => {
    const assistantOpen = !get().assistantOpen;
    write('lexnote.assistantOpen', assistantOpen);
    set({ assistantOpen });
  },
  setPalette: (paletteOpen) => set({ paletteOpen }),
  openNewCm: (preset = {}) => set({ newCm: preset }),
  closeNewCm: () => set({ newCm: null }),
}));
