import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { buildExtensions } from '@/features/editor/extensions';
import { useLibrary } from '@/store/library';

/** Sélectionne et amène à l'écran le passage cité (retour à la source). */
export function highlightQuote(root: HTMLElement | null, quote: string): boolean {
  if (!root || !quote) return false;
  const want = quote.replace(/\s+/g, ' ').trim().slice(0, 40).toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const txt = (n.textContent ?? '').replace(/\s+/g, ' ').toLowerCase();
    const i = txt.indexOf(want.slice(0, 24));
    if (i >= 0) {
      const el = n.parentElement!;
      const r = document.createRange(); r.setStart(n, Math.min(i, (n.textContent ?? '').length)); r.setEnd(n, Math.min(i + want.length, (n.textContent ?? '').length));
      const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('is-source-hit'); setTimeout(() => el.classList.remove('is-source-hit'), 2500);
      return true;
    }
  }
  return false;
}

export function NotesTab({ sessionId, quote }: { sessionId: string; quote: string | null }) {
  const loadNotes = useLibrary((s) => s.loadNotes);
  const [content, setContent] = useState<unknown>(undefined);
  const [loaded, setLoaded] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const editor = useEditor({ extensions: buildExtensions(), editable: false, content: undefined }, []);
  useEffect(() => { void loadNotes(sessionId).then((c) => { setContent(c); setLoaded(true); }).catch(() => setLoaded(true)); }, [sessionId, loadNotes]);
  useEffect(() => {
    if (!editor || !loaded) return;
    editor.commands.setContent((content as object) ?? '', { emitUpdate: false });
    if (quote) setTimeout(() => highlightQuote(box.current, quote), 80);
  }, [editor, loaded, content, quote]);
  const empty = loaded && !JSON.stringify(content ?? '').includes('"text"');
  return (
    <div className="note-editor note-editor--readonly" ref={box} data-testid="course-notes">
      {empty ? <p className="muted">Aucune note pour cette séance.</p> : <EditorContent editor={editor} />}
    </div>
  );
}
