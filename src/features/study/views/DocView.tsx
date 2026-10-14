import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { newId } from '@/lib/ids';
import { formatHMS } from '@/domain/capture';
import { CALLOUT_LABELS, CALLOUT_TONES, DOC_BLOCK_KINDS, type CalloutTone, type DocBlock, type DocBlockKind, type DocContent } from '@/domain/derived';

const KIND_LABELS: Record<DocBlockKind, string> = {
  heading: 'Titre', paragraph: 'Paragraphe', bullet: 'Puce', numbered: 'Liste numérotée', definition: 'Définition', callout: 'Encadré', table: 'Tableau', question: 'Question',
};

/** Zone de texte qui s'ajuste à son contenu (édition confortable de longs paragraphes). */
function AutoText({ value, onChange, className, label, placeholder }: { value: string; onChange: (v: string) => void; className?: string; label: string; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; } }, [value]);
  return <textarea ref={ref} className={`doc__input ${className ?? ''}`} value={value} rows={1} aria-label={label} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

/** Lecture : hiérarchie, définitions, encadrés, tableaux ; passages incertains signalés ; horodatage cliquable si fourni. */
function ReadBlock({ b, n, onTime }: { b: DocBlock; n: number; onTime?: (ms: number) => void }) {
  const unc = b.uncertain ? <span className="doc__unc" title="Passage incertain dans la source">incertain</span> : null;
  const at = b.startMs !== undefined && onTime ? <button type="button" className="doc__at" onClick={() => onTime(b.startMs!)} title="Voir dans la transcription">{formatHMS(b.startMs)}</button> : null;
  switch (b.kind) {
    case 'heading': { const L = (b.level ?? 1) <= 1 ? 'h2' : (b.level ?? 1) === 2 ? 'h3' : 'h4'; return <L className={`doc__h doc__h--${b.level ?? 1}`}>{b.text}{at}</L>; }
    case 'bullet': return <div className="doc__li" style={{ marginLeft: (b.level ?? 0) * 18 }}><span className="doc__dot" aria-hidden>•</span><span>{b.text} {unc}{at}</span></div>;
    case 'numbered': return <div className="doc__li" style={{ marginLeft: (b.level ?? 0) * 18 }}><span className="doc__num">{n}.</span><span>{b.text} {unc}{at}</span></div>;
    case 'definition': return <div className="doc__def"><strong>{b.term}</strong><span>{b.text} {unc}</span></div>;
    case 'callout': return <aside className={`doc__callout doc__callout--${b.tone ?? 'info'}`}><strong>{CALLOUT_LABELS[b.tone ?? 'info']}</strong><span>{b.text}</span>{at}</aside>;
    case 'question': return <div className="doc__q"><p><strong>Q.</strong> {b.text}</p>{b.answer && <details><summary>Éléments de réponse</summary><p>{b.answer}</p></details>}</div>;
    case 'table': {
      const [head, ...rows] = b.rows ?? [];
      return (
        <div className="doc__tablewrap">
          {b.text && <p className="doc__caption">{b.text}</p>}
          <table className="doc__table"><thead><tr>{head?.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{head?.map((_, k) => <td key={k}>{r[k] ?? ''}</td>)}</tr>)}</tbody></table>
        </div>
      );
    }
    default: return <p className="doc__p">{b.text} {unc}{at}</p>;
  }
}

/**
 * Document dérivé (résumé, traduction, cours structuré…) : lecture soignée, et édition bloc par bloc en mode « Modifier ».
 * Toute modification est enregistrée comme VOTRE version (la version générée reste disponible).
 */
export function DocView({ content, onChange, editing, onTime }: { content: DocContent; onChange: (c: DocContent) => void; editing: boolean; onTime?: (ms: number) => void }) {
  const blocks = content.blocks;
  const set = (i: number, patch: Partial<DocBlock>) => onChange({ ...content, blocks: blocks.map((b, k) => (k === i ? { ...b, ...patch } : b)) });
  const remove = (i: number) => onChange({ ...content, blocks: blocks.filter((_, k) => k !== i) });
  const move = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= blocks.length) return; const next = [...blocks]; [next[i], next[j]] = [next[j]!, next[i]!]; onChange({ ...content, blocks: next }); };
  const insert = (i: number, kind: DocBlockKind = 'paragraph') => {
    const b: DocBlock = kind === 'table' ? { id: newId(), kind, text: '', rows: [['Colonne 1', 'Colonne 2'], ['', '']] } : kind === 'definition' ? { id: newId(), kind, term: 'Terme', text: '' } : { id: newId(), kind, text: '' };
    onChange({ ...content, blocks: [...blocks.slice(0, i + 1), b, ...blocks.slice(i + 1)] });
  };
  const changeKind = (i: number, kind: DocBlockKind) => {
    const b = blocks[i]!;
    set(i, { kind, ...(kind === 'definition' && !b.term ? { term: 'Terme' } : {}), ...(kind === 'callout' && !b.tone ? { tone: 'remember' as CalloutTone } : {}), ...(kind === 'table' && !b.rows ? { rows: [['Colonne 1', 'Colonne 2'], [b.text, '']] } : {}) });
  };

  if (!editing) {
    let n = 0;
    return (
      <article className="doc" data-testid="doc-view" lang={content.language !== 'und' ? content.language : undefined}>
        {blocks.map((b) => { n = b.kind === 'numbered' ? n + 1 : 0; return <ReadBlock key={b.id} b={b} n={n} onTime={onTime} />; })}
      </article>
    );
  }
  return (
    <div className="doc doc--edit" data-testid="doc-edit">
      {blocks.map((b, i) => (
        <div key={b.id} className={`doc__eb doc__eb--${b.kind}`} data-testid="doc-block">
          <div className="doc__ebbar">
            <select className="doc__kind" value={b.kind} aria-label="Type de bloc" onChange={(e) => changeKind(i, e.target.value as DocBlockKind)}>
              {DOC_BLOCK_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
            {(b.kind === 'heading' || b.kind === 'bullet' || b.kind === 'numbered') && (
              <select className="doc__kind" value={b.level ?? (b.kind === 'heading' ? 1 : 0)} aria-label="Niveau" onChange={(e) => set(i, { level: Number(e.target.value) })}>
                {(b.kind === 'heading' ? [1, 2, 3] : [0, 1, 2, 3]).map((l) => <option key={l} value={l}>{b.kind === 'heading' ? `Niveau ${l}` : `Retrait ${l}`}</option>)}
              </select>
            )}
            {b.kind === 'callout' && (
              <select className="doc__kind" value={b.tone ?? 'info'} aria-label="Type d’encadré" onChange={(e) => set(i, { tone: e.target.value as CalloutTone })}>
                {CALLOUT_TONES.map((t) => <option key={t} value={t}>{CALLOUT_LABELS[t]}</option>)}
              </select>
            )}
            <label className="doc__uncchk"><input type="checkbox" checked={!!b.uncertain} onChange={(e) => set(i, { uncertain: e.target.checked || undefined })} /> incertain</label>
            <span className="spacer" />
            <button type="button" className="ttools__ib" aria-label="Monter" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp size={14} /></button>
            <button type="button" className="ttools__ib" aria-label="Descendre" onClick={() => move(i, 1)} disabled={i === blocks.length - 1}><ArrowDown size={14} /></button>
            <button type="button" className="ttools__ib" aria-label="Ajouter un bloc après" onClick={() => insert(i)}><Plus size={14} /></button>
            <button type="button" className="ttools__ib ttools__ib--danger" aria-label="Supprimer le bloc" onClick={() => remove(i)} disabled={blocks.length <= 1} data-testid="doc-block-delete"><Trash2 size={14} /></button>
          </div>
          {b.kind === 'definition' && <input className="input doc__term" value={b.term ?? ''} aria-label="Terme" onChange={(e) => set(i, { term: e.target.value })} />}
          {b.kind === 'table' ? (
            <div className="doc__tablewrap"><table className="doc__table doc__table--edit"><tbody>
              {(b.rows ?? []).map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci}><input className="input" value={c} aria-label={`Cellule ${ri + 1}-${ci + 1}`} onChange={(e) => set(i, { rows: (b.rows ?? []).map((rr, x) => (x === ri ? rr.map((cc, y) => (y === ci ? e.target.value : cc)) : rr)) })} /></td>)}</tr>
              ))}
            </tbody></table>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => set(i, { rows: [...(b.rows ?? []), (b.rows?.[0] ?? ['', '']).map(() => '')] })}><Plus size={14} /> Ligne</button>
            </div>
          ) : <AutoText value={b.text} label={`Texte du bloc ${i + 1}`} className={`doc__input--${b.kind}`} onChange={(v) => set(i, { text: v })} />}
          {b.kind === 'question' && <AutoText value={b.answer ?? ''} label="Éléments de réponse" placeholder="Éléments de réponse (facultatif)" onChange={(v) => set(i, { answer: v || undefined })} />}
        </div>
      ))}
    </div>
  );
}
