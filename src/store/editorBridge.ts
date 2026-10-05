import { create } from 'zustand';
import type { Editor } from '@tiptap/core';

/** Permet à la palette de commandes (globale) d'agir sur l'éditeur actif, sans couplage direct. */
export const useEditorBridge = create<{ editor: Editor | null; setEditor: (e: Editor | null) => void }>((set) => ({
  editor: null,
  setEditor: (editor) => set({ editor }),
}));
