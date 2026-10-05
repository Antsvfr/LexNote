import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { Mic, ShieldCheck, Sparkles, FileUp } from 'lucide-react';
import { AI_COMMANDS } from '@/services/ai';
import { PROVENANCE_LABELS, VERIFICATION_LABELS } from '@/domain/legal';
import { useUI } from '@/store/ui';
import { TranscriptPanel } from '@/features/capture/TranscriptPanel';

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
function AssistantContent({ editor }: { editor: Editor }) {
  const outline = useOutline(editor);
  return (
    <div className="assistant">
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
          <li><Mic size={14} aria-hidden /> Transcription du cours <span className="tag tag--ok">Disponible</span></li>
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
          {['PROFESSOR', 'USER_NOTE', 'DOCUMENT', 'TRANSCRIPTION', 'AI'].map((k) => <span key={k} className="tag">{PROVENANCE_LABELS[k as keyof typeof PROVENANCE_LABELS]}</span>)}
        </p>
      </section>
    </div>
  );
}

/** Panneau latéral : Transcription (direct) et Assistant (à venir). */
export function SidePanel({ editor, sessionId }: { editor: Editor; sessionId: string }) {
  const tab = useUI((s) => s.sideTab);
  const setTab = useUI((s) => s.setSideTab);
  return (
    <aside className="sidepanel" aria-label="Panneau latéral">
      <div className="sidepanel__tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'transcript'} className={tab === 'transcript' ? 'is-on' : ''} onClick={() => setTab('transcript')} data-testid="tab-transcript"><Mic size={14} aria-hidden /> Transcription</button>
        <button role="tab" aria-selected={tab === 'assistant'} className={tab === 'assistant' ? 'is-on' : ''} onClick={() => setTab('assistant')}><Sparkles size={14} aria-hidden /> Assistant</button>
      </div>
      <div className="sidepanel__body">
        {tab === 'transcript' ? <TranscriptPanel sessionId={sessionId} /> : <AssistantContent editor={editor} />}
      </div>
    </aside>
  );
}
