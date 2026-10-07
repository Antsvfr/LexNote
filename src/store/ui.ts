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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#050b14' : '#f3f5fa');
}

import type { SessionType } from '@/domain/sessionType';

export interface NewSessionPreset { subjectId?: string; moduleId?: string | null; type?: SessionType }

interface UIState {
  theme: ThemePref;
  /** Mode Focus CM (éditeur seul, distractions supprimées). */
  focus: boolean;
  /** Panneau secondaire de l'éditeur (futur assistant). */
  assistantOpen: boolean;
  paletteOpen: boolean;
  /** Tiroir de navigation (tablette / mobile). */
  navOpen: boolean;
  newSession: NewSessionPreset | null;
  /** Boîte de dialogue matière (création / modification). */
  subjectDialog: { id?: string } | null;
  /** Onglet du panneau latéral de l'éditeur. */
  sideTab: 'transcript' | 'assistant';
  /** Mode Focus : contrôles de transcription flottants (le panneau est masqué). */
  recPopover: boolean;

  setTheme(t: ThemePref): void;
  setFocus(v: boolean): void;
  toggleAssistant(): void;
  setPalette(v: boolean): void;
  setNavOpen(v: boolean): void;
  setSideTab(t: 'transcript' | 'assistant'): void;
  /** Ouvre le panneau Transcription (ou, en mode Focus, les contrôles flottants). */
  openTranscript(): void;
  setRecPopover(v: boolean): void;
  openSubjectDialog(id?: string): void;
  closeSubjectDialog(): void;
  openNewSession(preset?: NewSessionPreset): void;
  closeNewSession(): void;
}

export const useUI = create<UIState>((set, get) => ({
  theme: read<ThemePref>('lexnote.theme', 'dark'),
  focus: false,
  assistantOpen: read('lexnote.assistantOpen', true),
  paletteOpen: false,
  navOpen: false,
  newSession: null,
  subjectDialog: null,
  sideTab: 'transcript',
  recPopover: false,

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
  setNavOpen: (navOpen) => set({ navOpen }),
  setSideTab: (sideTab) => set({ sideTab }),
  openTranscript: () => {
    if (get().focus) return set((s) => ({ recPopover: !s.recPopover }));
    write('lexnote.assistantOpen', true);
    set({ assistantOpen: true, sideTab: 'transcript' });
  },
  setRecPopover: (recPopover) => set({ recPopover }),
  openSubjectDialog: (id) => set({ subjectDialog: { id } }),
  closeSubjectDialog: () => set({ subjectDialog: null }),
  openNewSession: (preset = {}) => set({ newSession: preset }),
  closeNewSession: () => set({ newSession: null }),
}));
