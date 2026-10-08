import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { newId } from '@/lib/ids';
import type { TableContent } from '@/domain/study';
import { Sources } from './Sources';

interface P { content: TableContent; onChange(c: TableContent): void; showSources: boolean }
export function TableView({ content, onChange, showSources }: P) {
  const [sel, setSel] = useState<{ row: string; col: string } | null>(null);
  const upd = (fn: (c: TableContent) => void) => { const c = structuredClone(content); fn(c); onChange(c); };
  const cell = sel ? content.rows.find((r) => r.id === sel.row)?.cells[sel.col] : undefined;
  return (
    <div className="paper tablewrap" data-testid="comparison">
      <table className="cmp">
        <thead><tr><th />{content.columns.map((c) => <th key={c.id}><input aria-label="Notion" value={c.title} onChange={(e) => upd((x) => { x.columns.find((k) => k.id === c.id)!.title = e.target.value || c.title; })} /></th>)}</tr></thead>
        <tbody>
          {content.rows.map((r) => (
            <tr key={r.id} data-testid="cmp-row">
              <th scope="row"><input aria-label="Critère" value={r.label} onChange={(e) => upd((x) => { x.rows.find((k) => k.id === r.id)!.label = e.target.value || r.label; })} />
                <button className="iconbtn no-print" aria-label={`Supprimer la ligne ${r.label}`} onClick={() => upd((x) => { x.rows = x.rows.filter((k) => k.id !== r.id); })}><Trash2 size={13} /></button></th>
              {content.columns.map((c) => (
                <td key={c.id} className={sel?.row === r.id && sel.col === c.id ? 'is-sel' : ''}>
                  <textarea aria-label={`${r.label} — ${c.title}`} value={r.cells[c.id]?.text ?? ''} rows={Math.max(2, Math.ceil((r.cells[c.id]?.text.length ?? 0) / 28))}
                    onFocus={() => setSel({ row: r.id, col: c.id })}
                    onChange={(e) => upd((x) => { const row = x.rows.find((k) => k.id === r.id)!; row.cells[c.id] = { text: e.target.value, sources: row.cells[c.id]?.text === e.target.value ? row.cells[c.id]!.sources : row.cells[c.id]?.sources ?? [] }; })} />
                  <span className="sheet__print">{r.cells[c.id]?.text}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn btn--sm no-print" onClick={() => upd((x) => { x.rows.push({ id: newId(), label: 'Nouveau critère', cells: Object.fromEntries(x.columns.map((c) => [c.id, { text: '', sources: [] }])) }); })}><Plus /> Ajouter une ligne</button>
      {showSources && sel && <div className="cmp__src no-print"><strong>Source de la cellule sélectionnée</strong><Sources sources={cell?.sources ?? []} confidence={cell?.confidence} empty="Cellule vide ou ajoutée par vous : aucune source dans le cours." /></div>}
    </div>
  );
}
