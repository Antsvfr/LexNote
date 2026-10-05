import { create } from 'zustand';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Petit store isolé : seul l'indicateur se re-rend, jamais l'éditeur. */
export const useSaveStatus = create<{ state: SaveState; savedAt: number | null; set: (s: SaveState) => void }>((set) => ({
  state: 'idle',
  savedAt: null,
  set: (state) => set((cur) => (cur.state === state ? cur : { state, savedAt: state === 'saved' ? Date.now() : cur.savedAt })),
}));
