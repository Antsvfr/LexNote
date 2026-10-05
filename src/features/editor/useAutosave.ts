import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { debounce } from '@/lib/debounce';
import { useLibrary } from '@/store/library';
import { useSaveStatus } from './saveStatus';

const WAIT_MS = 500;
const MAX_WAIT_MS = 4000;

/**
 * Autosave : frappe → (debounce) → stockage local.
 *
 *  - La frappe ne fait que marquer "Enregistrement…" (mise à jour de store dédiée, quasi gratuite) ;
 *  - la sérialisation du document et l'écriture IndexedDB se font après une courte pause (ou 4 s max) ;
 *  - flush immédiat quand l'onglet est masqué, fermé, ou quand on quitte l'éditeur.
 */
export function useAutosave(editor: Editor | null, sessionId: string, getDuration: () => number) {
  const getDurationRef = useRef(getDuration);
  getDurationRef.current = getDuration;
  const dirty = useRef(false);

  useEffect(() => {
    if (!editor) return;
    const status = useSaveStatus.getState();
    status.set('idle');

    let inflight: Promise<void> = Promise.resolve();

    const save = () => {
      if (!dirty.current || editor.isDestroyed) return;
      dirty.current = false;
      const content = editor.getJSON();
      const plainText = editor.getText({ blockSeparator: '\n' });
      const durationSec = getDurationRef.current();
      // Les écritures sont chaînées : l'ordre est garanti, la dernière gagne.
      inflight = inflight
        .then(() => useLibrary.getState().saveNotes(sessionId, { content, plainText, durationSec }))
        .then(() => {
          if (!dirty.current) useSaveStatus.getState().set('saved');
        })
        .catch(() => {
          dirty.current = true; // on retentera au prochain flush
          useSaveStatus.getState().set('error');
        });
    };

    const debounced = debounce(save, WAIT_MS, MAX_WAIT_MS);
    const onUpdate = ({ transaction }: { transaction: Transaction }) => {
      // Aucune étape = normalisation interne à l'ouverture (ex. paragraphe final ajouté) : pas une modification de l'étudiant.
      if (transaction.steps.length === 0) return;
      dirty.current = true;
      useSaveStatus.getState().set('saving');
      debounced();
    };
    const flush = () => debounced.flush();
    const onVisibility = () => document.visibilityState === 'hidden' && flush();

    editor.on('update', onUpdate);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      editor.off('update', onUpdate);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush(); // sortie de l'éditeur : rien ne doit rester en attente
    };
  }, [editor, sessionId]);

  /** Permet à l'appelant (bouton "Terminer") de forcer l'écriture et d'attendre. */
  return {
    flushNow: async () => {
      if (editor && !editor.isDestroyed && dirty.current) {
        dirty.current = false;
        await useLibrary.getState().saveNotes(sessionId, {
          content: editor.getJSON(),
          plainText: editor.getText({ blockSeparator: '\n' }),
          durationSec: getDurationRef.current(),
        });
        useSaveStatus.getState().set('saved');
      }
    },
  };
}
