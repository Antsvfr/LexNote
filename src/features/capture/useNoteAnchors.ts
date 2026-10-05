import { useEffect } from 'react';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import { debounce } from '@/lib/debounce';
import { captureManager, FLUSH_ANCHORS_EVENT } from '@/services/capture/manager';
import { useCapture } from '@/store/capture';

const SETTLE_MS = 1500; // on ancre quand l'étudiant marque une pause d'écriture…
const MAX_WAIT_MS = 10_000; // …ou au plus toutes les 10 s pendant une écriture continue.

/**
 * Relie ce que l'étudiant écrit à ce que dit le professeur — en métadonnées uniquement
 * (jamais de timestamps dans le texte). L'instant retenu est celui de la dernière frappe, le texte est le
 * paragraphe qu'on vient d'écrire. Aucune sérialisation du document : coût négligeable pour la frappe.
 */
export function useNoteAnchors(editor: Editor | null, sessionId: string) {
  useEffect(() => {
    if (!editor) return;
    let lastEditAt = 0;
    const record = debounce(() => {
      if (editor.isDestroyed || useCapture.getState().status !== 'RECORDING') return;
      try {
        const { $head } = editor.state.selection;
        captureManager.recordAnchor(sessionId, { notePosition: $head.pos, textSnippet: $head.parent.textContent, at: lastEditAt });
      } catch (err) {
        console.warn('[LexNote] ancrage ignoré', err); // n'affecte jamais les notes
      }
    }, SETTLE_MS, MAX_WAIT_MS);
    const onUpdate = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.steps.length === 0 || useCapture.getState().status !== 'RECORDING') return;
      lastEditAt = Date.now();
      record();
    };
    const flush = () => record.flush();
    editor.on('update', onUpdate);
    window.addEventListener(FLUSH_ANCHORS_EVENT, flush);
    return () => {
      editor.off('update', onUpdate);
      window.removeEventListener(FLUSH_ANCHORS_EVENT, flush);
      record.cancel();
    };
  }, [editor, sessionId]);
}
