import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Mic, ShieldCheck, Sparkles, FileUp } from 'lucide-react';
import { AI_COMMANDS } from '@/services/ai';
import { PROVENANCE_LABELS, VERIFICATION_LABELS } from '@/domain/legal';

interface Heading { level: number; text: string; pos: number }

function useOutline(editor: Editor): Heading[] {
  const [items, setItems] = useState<Heading[]>([]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const compute = () => {
      const out: Heading[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading' && node.textContent.trim()) out.push({ level: node.attrs.level as number, text: node.textContent, pos });
        return node.type.name === 'doc' || node.type.name === 'legalBlock' || node.type.name === 'blockquote';
      });
      setItems((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
    };
    const onUpdate = () => { clearTimeout(t); t = setTimeout(compute, 500); };
    compute();
    editor.on('update', onUpdate);
    return () => { clearTimeout(t); editor.off('update', onUpdate); };
  }, [editor]);
  return items;
}

/**
 * Panneau secondaire. En V1 : plan du CM (fonctionnel) + emplacements honnêtes
 * des fonctions à venir. Rien ici ne simule de résultat.
 */
export function AssistantPanel({ editor }: { editor: Editor }) {
  const outline = useOutline(editor);
  return (
    <aside className="assistant" aria-label="Assistant LexNote">
      <section>
        <h2 className="assistant__h">Plan du CM</h2>
        {outline.length === 0 ? (
          <p className="muted assistant__p">Les titres que vous ajoutez apparaissent ici.</p>
        ) : (
          <ul className="outline">
            {outline.map((h) => (
              <li key={h.pos} style={{ paddingLeft: (h.level - 1) * 12 }}>
                <button onClick={() => { editor.chain().focus().setTextSelection(h.pos + 1).scrollIntoView().run(); }}>{h.text}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="assistant__h"><Sparkles size={14} aria-hidden /> Assistant <span className="tag tag--soon">Bientôt</span></h2>
        <p className="muted assistant__p">Aucun moteur IA n’est branché dans cette version : rien n’est généré, rien ne quitte votre appareil.</p>
        <ul className="assistant__cmds" aria-label="Commandes à venir">
          {AI_COMMANDS.map((c) => (
            <li key={c.id}><button className="chip chip--off" aria-disabled="true" title={`${c.description} — bientôt disponible`}>{c.label}</button></li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="assistant__h">À venir</h2>
        <ul className="assistant__soon">
          <li><Mic size={14} aria-hidden /> Transcription du cours <span className="tag tag--soon">Bientôt</span></li>
          <li><FileUp size={14} aria-hidden /> Supports PDF / PowerPoint <span className="tag tag--soon">Bientôt</span></li>
        </ul>
      </section>

      <section>
        <h2 className="assistant__h"><ShieldCheck size={14} aria-hidden /> Fiabilité juridique</h2>
        <p className="muted assistant__p">
          LexNote distinguera toujours ce que dit le professeur de ce qu’ajoute l’IA, et n’inventera jamais un article ou un arrêt.
        </p>
        <p className="assistant__legend">
          {Object.values(VERIFICATION_LABELS).map((l) => <span key={l} className="tag">{l}</span>)}
        </p>
        <p className="assistant__legend">
          {['PROFESSOR', 'USER_NOTE', 'DOCUMENT', 'AI'].map((k) => <span key={k} className="tag">{PROVENANCE_LABELS[k as keyof typeof PROVENANCE_LABELS]}</span>)}
        </p>
      </section>
    </aside>
  );
}
