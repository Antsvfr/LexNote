import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { newId } from '@/lib/ids';
import { SHEET_SECTION_LABELS, type SheetContent } from '@/domain/study';
import { describeLocation } from '@/services/engine/sourceLabels';
import { Sources } from './Sources';

interface P { content: SheetContent; onChange(c: SheetContent): void; showSources: boolean }

/** Fiche : lisible comme un document, modifiable partout (titres, textes, ajout / suppression). */
export function SheetView({ content, onChange, showSources }: P) {
  const [open, setOpen] = useState<string | null>(null);
  const setSec = (id: string, fn: (s: SheetContent['sections'][number]) => void) => { const c = structuredClone(content); const s = c.sections.find((x) => x.id === id); if (s) fn(s); onChange(c); };
  return (
    <article className="paper sheet" data-testid="sheet">
      {content.sections.map((sec) => (
        <section key={sec.id} className="sheet__sec" data-kind={sec.kind} data-testid={`sheet-sec-${sec.kind}`}>
          <h2><input className="sheet__h" aria-label="Titre de la section" value={sec.title} onChange={(e) => setSec(sec.id, (s) => { s.title = e.target.value || SHEET_SECTION_LABELS[s.kind]; })} />
            <button className="iconbtn sheet__rm no-print" aria-label={`Supprimer la section ${sec.title}`} onClick={() => { const c = structuredClone(content); c.sections = c.sections.filter((s) => s.id !== sec.id); onChange(c); }}><Trash2 size={14} /></button></h2>
          <ul>
            {sec.items.map((it) => (
              <li key={it.id} className={it.uncertain ? 'is-uncertain' : ''} data-testid="sheet-item" style={it.depth ? { marginLeft: it.depth * 18 } : undefined}>
                {it.label && <strong className="sheet__label">{it.label}</strong>}
                <textarea className="sheet__t" aria-label="Contenu" value={it.text} rows={Math.max(1, Math.ceil(it.text.length / 90) + (it.text.split('\n').length - 1))}
                  onChange={(e) => setSec(sec.id, (s) => { const x = s.items.find((i) => i.id === it.id)!; x.text = e.target.value; x.uncertain = undefined; })} />
                <span className="sheet__print">{it.text}</span>
                <span className="sheet__tools no-print">
                  {showSources && <button className="link" onClick={() => setOpen(open === it.id ? null : it.id)} aria-expanded={open === it.id}>Source</button>}
                  <button className="iconbtn" aria-label="Supprimer l’élément" onClick={() => setSec(sec.id, (s) => { s.items = s.items.filter((i) => i.id !== it.id); })}><Trash2 size={13} /></button>
                </span>
                {showSources && open === it.id && <Sources sources={it.sources} confidence={it.confidence} />}
                {showSources && it.sources[0] && <small className="sheet__src print-only">{describeLocation(it.sources[0].location)}</small>}
              </li>
            ))}
          </ul>
          <button className="btn btn--ghost btn--sm no-print" onClick={() => setSec(sec.id, (s) => { s.items.push({ id: newId(), text: 'Nouvel élément', sources: [] }); })}><Plus /> Ajouter un élément</button>
        </section>
      ))}
      <button className="btn btn--sm no-print" onClick={() => { const c = structuredClone(content); c.sections.push({ id: newId(), kind: 'concepts', title: 'Nouvelle section', items: [{ id: newId(), text: 'Texte', sources: [] }] }); onChange(c); }}><Plus /> Ajouter une section</button>
    </article>
  );
}
