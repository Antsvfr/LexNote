import { useMemo, useRef, useState } from 'react';
import { Crosshair, Maximize2, Minus, Plus, Trash2 } from 'lucide-react';
import type { DiagramContent } from '@/domain/study';
import { DNODE_H, DNODE_W, layoutDiagram } from '@/services/study/layout';
import { addDiagramEdge, addDiagramStepAfter, moveDiagramNode, relabelDiagramNode, removeDiagramEdge, removeDiagramNode, setEdgeLabel } from '@/services/study/edit';
import { wrap } from '@/services/study/export';
import { usePanZoom } from './panzoom';
import { Sources } from './Sources';

interface P { content: DiagramContent; onChange(c: DiagramContent): void; showSources: boolean }
const FILL: Record<string, string> = { decision: '#fff4e5', start: '#e9f7ef', end: '#fdebee', note: '#f4f6fb', step: '#e8eefc', concept: '#e8eefc' };
const STROKE: Record<string, string> = { decision: '#d9822b', start: '#2e9d64', end: '#d4143a', note: '#8a94ad', step: '#3b63c9', concept: '#3b63c9' };

export function DiagramView({ content, onChange, showSources }: P) {
  const box = useRef<HTMLDivElement>(null);
  const pz = usePanZoom(box);
  const [sel, setSel] = useState<string | null>(null);
  const drag = useRef<{ id: string; ox: number; oy: number; nx: number; ny: number } | null>(null);
  const [live, setLive] = useState<{ id: string; x: number; y: number } | null>(null);
  const layout = useMemo(() => layoutDiagram(content), [content]);
  const fitted = useRef(false);
  if (!fitted.current && layout.width > 20) { queueMicrotask(() => pz.fit(layout.width, layout.height)); fitted.current = true; }
  const pos = (id: string) => (live?.id === id ? { ...layout.pos[id]!, x: live.x, y: live.y } : layout.pos[id]!);
  const selected = content.nodes.find((n) => n.id === sel);

  const startDrag = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const p = layout.pos[id]!;
    drag.current = { id, ox: e.clientX, oy: e.clientY, nx: p.x, ny: p.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setSel(id);
  };
  const moveDrag = (e: React.PointerEvent) => { const d = drag.current; if (!d) return; setLive({ id: d.id, x: d.nx + (e.clientX - d.ox) / pz.view.k, y: d.ny + (e.clientY - d.oy) / pz.view.k }); };
  const endDrag = () => { const d = drag.current; drag.current = null; if (d && live && (Math.abs(live.x - d.nx) > 3 || Math.abs(live.y - d.ny) > 3)) onChange(moveDiagramNode(content, d.id, live.x, live.y)); setLive(null); };

  return (
    <div className="mm" data-testid="diagram">
      <div className="mm__bar no-print" role="toolbar" aria-label="Schéma">
        <button className="btn btn--sm" onClick={() => { const r = addDiagramStepAfter(content, sel ?? content.nodes.at(-1)?.id ?? null); onChange(r.content); setSel(r.id); }} data-testid="dg-add"><Plus /> Ajouter une étape{selected ? ' après' : ''}</button>
        <span className="spacer" />
        <button className="iconbtn" onClick={pz.zoomOut} aria-label="Dézoomer"><Minus size={16} /></button>
        <button className="iconbtn" onClick={pz.zoomIn} aria-label="Zoomer"><Plus size={16} /></button>
        <button className="iconbtn" onClick={() => pz.fit(layout.width, layout.height)} aria-label="Centrer le schéma"><Crosshair size={16} /></button>
        <button className="iconbtn" onClick={() => void box.current?.parentElement?.requestFullscreen?.()} aria-label="Plein écran"><Maximize2 size={16} /></button>
      </div>
      <div className="mm__stage">
        <div ref={box} className="mm__canvas paper" {...pz.handlers} data-testid="dg-canvas">
          <svg width="100%" height="100%" role="img" aria-label="Schéma">
            <defs><marker id="dg-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#6b7694" /></marker></defs>
            <g transform={`translate(${pz.view.x} ${pz.view.y}) scale(${pz.view.k})`}>
              {content.edges.map((e) => {
                const a = pos(e.from), b = pos(e.to);
                if (!a || !b) return null;
                const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y;
                return (
                  <g key={e.id} data-testid="dg-edge" data-basis={e.basis}>
                    <path d={`M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`} stroke="#6b7694" strokeWidth={1.8} fill="none" markerEnd="url(#dg-arr)" strokeDasharray={e.uncertain || e.basis === 'inferred' ? '6 4' : undefined} />
                    {e.label && <text x={(x1 + x2) / 2 + 6} y={(y1 + y2) / 2} fontSize={11} fill="#475069">{e.label}{e.uncertain ? ' ?' : ''}</text>}
                  </g>
                );
              })}
              {content.nodes.map((n) => {
                const p = pos(n.id);
                return (
                  <g key={n.id} data-testid="dg-node" data-id={n.id} onPointerDown={(e) => startDrag(e, n.id)} onPointerMove={moveDrag} onPointerUp={endDrag} style={{ cursor: 'grab' }} tabIndex={0} role="button" aria-label={n.label}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSel(n.id); }}>
                    {n.kind === 'decision'
                      ? <polygon points={`${p.x + p.w / 2},${p.y - 4} ${p.x + p.w + 6},${p.y + p.h / 2} ${p.x + p.w / 2},${p.y + p.h + 4} ${p.x - 6},${p.y + p.h / 2}`} fill={FILL.decision} stroke={sel === n.id ? '#ff3b5c' : STROKE.decision} strokeWidth={sel === n.id ? 3 : 1.6} />
                      : <rect x={p.x} y={p.y} width={DNODE_W} height={DNODE_H} rx={n.kind === 'start' || n.kind === 'end' ? 26 : 10} fill={FILL[n.kind]} stroke={sel === n.id ? '#ff3b5c' : STROKE[n.kind]} strokeWidth={sel === n.id ? 3 : 1.6} strokeDasharray={n.uncertain ? '5 3' : undefined} />}
                    {wrap(n.label, 28, 2).map((l, k, arr) => <text key={k} x={p.x + p.w / 2} y={p.y + p.h / 2 + (k - (arr.length - 1) / 2) * 15 + 4} textAnchor="middle" fontSize={12.5} fontWeight={500} fill="#1b2233" style={{ pointerEvents: 'none' }}>{l}</text>)}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
        {selected && (
          <aside className="mm__panel no-print" aria-label="Détail de l’étape" data-testid="dg-panel">
            <div className="field"><label htmlFor="dg-label">Texte</label><input id="dg-label" className="input" value={selected.label} onChange={(e) => onChange(relabelDiagramNode(content, selected.id, e.target.value || selected.label))} data-testid="dg-label" /></div>
            {selected.detail && <p className="muted">{selected.detail}</p>}
            {selected.uncertain && <p className="banner banner--warn">Non retrouvé dans le cours : à vérifier.</p>}
            {showSources && <><strong>Sources</strong><Sources sources={selected.sources} /></>}
            <strong>Flèches sortantes</strong>
            {content.edges.filter((e) => e.from === selected.id).map((e) => (
              <div key={e.id} className="row-actions">
                <span className="truncate">→ {content.nodes.find((n) => n.id === e.to)?.label}</span>
                <input className="input" aria-label="Libellé de la flèche" placeholder="libellé" value={e.label ?? ''} onChange={(ev) => onChange(setEdgeLabel(content, e.id, ev.target.value))} style={{ maxWidth: 110 }} />
                <button className="iconbtn" aria-label="Supprimer la flèche" onClick={() => onChange(removeDiagramEdge(content, e.id))}><Trash2 size={14} /></button>
              </div>
            ))}
            <div className="field"><label htmlFor="dg-link">Relier à…</label>
              <select id="dg-link" className="select" value="" onChange={(e) => { if (e.target.value) onChange(addDiagramEdge(content, selected.id, e.target.value)); }}>
                <option value="">Choisir une étape</option>
                {content.nodes.filter((n) => n.id !== selected.id).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
            </div>
            <div className="row-actions">
              <button className="btn btn--sm" onClick={() => { const r = addDiagramStepAfter(content, selected.id); onChange(r.content); setSel(r.id); }}><Plus /> Étape après</button>
              <button className="btn btn--sm btn--danger" onClick={() => { onChange(removeDiagramNode(content, selected.id)); setSel(null); }} data-testid="dg-delete"><Trash2 /> Supprimer</button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
