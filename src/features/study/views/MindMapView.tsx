import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Crosshair, Maximize2, Minimize2, Minus, Plus, Search, Trash2 } from 'lucide-react';
import { MAP_NODE_TYPES, type MindMapContent, type MindNodeType } from '@/domain/study';
import { layoutMindMap } from '@/services/study/layout';
import { addChild, addSibling, describeNode, expandTo, findNode, flatten, moveSibling, moveTo, parentOf, removeNode, renameNode, searchNodes, setAllCollapsed, setNodeType, toggleCollapse } from '@/services/study/edit';
import { wrap } from '@/services/study/export';
import { usePanZoom } from './panzoom';
import { Sources } from './Sources';

const TYPE_LABEL: Record<MindNodeType, string> = { root: 'Racine', section: 'Partie', concept: 'Notion', article: 'Article', caselaw: 'Jurisprudence', definition: 'Définition', example: 'Exemple', important: 'Point important', question: 'À vérifier' };
const COLORS: Record<string, { fill: string; stroke: string }> = {
  root: { fill: '#d4143a', stroke: '#a30f2c' }, section: { fill: '#e8eefc', stroke: '#3b63c9' }, concept: { fill: '#f4f6fb', stroke: '#8a94ad' },
  article: { fill: '#e9f7ef', stroke: '#2e9d64' }, caselaw: { fill: '#f3ecfb', stroke: '#7b4bc2' }, definition: { fill: '#fff4e5', stroke: '#d9822b' },
  example: { fill: '#e6f6fa', stroke: '#2a9bb5' }, important: { fill: '#fdebee', stroke: '#d4143a' }, question: { fill: '#fff9db', stroke: '#c9a400' },
};

interface P { content: MindMapContent; onChange(c: MindMapContent): void; showSources: boolean }

export function MindMapView({ content, onChange, showSources }: P) {
  const box = useRef<HTMLDivElement>(null);
  const pz = usePanZoom(box);
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [full, setFull] = useState(false);
  const layout = useMemo(() => layoutMindMap(content.root, content.orientation), [content.root, content.orientation]);
  const by = useMemo(() => new Map(layout.nodes.map((n) => [n.node.id, n])), [layout]);
  const matches = useMemo(() => new Set(searchNodes(content.root, q).map((n) => n.id)), [content.root, q]);
  const fitted = useRef(false);
  const selected = sel ? findNode(content.root, sel) : undefined;
  const setRoot = (root: MindMapContent['root']) => onChange({ ...content, root });

  useEffect(() => { if (!fitted.current && layout.nodes.length) { pz.fit(layout.width, layout.height); fitted.current = true; } }, [layout, pz]);
  useEffect(() => { fitted.current = false; }, [content.orientation]);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === box.current?.parentElement);
    document.addEventListener('fullscreenchange', on); return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const goTo = (id: string) => {
    const root = expandTo(content.root, id);
    if (JSON.stringify(root) !== JSON.stringify(content.root)) setRoot(root);
    setSel(id);
    const l = layoutMindMap(root, content.orientation); const n = l.nodes.find((x) => x.node.id === id);
    if (n) pz.centerOn(n.x + n.w / 2, n.y + n.h / 2);
  };
  const onSearch = (v: string) => { setQ(v); const f = searchNodes(content.root, v)[0]; if (f && v.trim().length > 1) goTo(f.id); };
  const toggleFull = async () => { const el = box.current?.parentElement; if (!el) return; if (document.fullscreenElement) await document.exitFullscreen(); else await el.requestFullscreen?.(); };

  return (
    <div className={`mm${full ? ' is-full' : ''}`} data-testid="mindmap">
      <div className="mm__bar no-print" role="toolbar" aria-label="Carte mentale">
        <label className="searchbox"><Search size={15} aria-hidden /><input aria-label="Rechercher un nœud" placeholder="Rechercher un nœud…" value={q} onChange={(e) => onSearch(e.target.value)} data-testid="mm-search" /></label>
        {q && <span className="muted mm__count" data-testid="mm-count">{matches.size} résultat{matches.size > 1 ? 's' : ''}</span>}
        <span className="spacer" />
        <button className="iconbtn" onClick={pz.zoomOut} aria-label="Dézoomer"><Minus size={16} /></button>
        <button className="iconbtn" onClick={pz.zoomIn} aria-label="Zoomer" data-testid="mm-zoom-in"><Plus size={16} /></button>
        <button className="iconbtn" onClick={() => pz.fit(layout.width, layout.height)} aria-label="Centrer la carte" data-testid="mm-center"><Crosshair size={16} /></button>
        <button className="iconbtn" onClick={() => setRoot(setAllCollapsed(content.root, true, 1))} aria-label="Tout replier" title="Tout replier"><ChevronsDownUp size={16} /></button>
        <button className="iconbtn" onClick={() => setRoot(setAllCollapsed(content.root, false))} aria-label="Tout déplier" title="Tout déplier"><ChevronsUpDown size={16} /></button>
        <button className="iconbtn" onClick={toggleFull} aria-label={full ? 'Quitter le plein écran' : 'Plein écran'} data-testid="mm-full">{full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      </div>
      <div className="mm__stage">
        <div ref={box} className="mm__canvas paper" {...pz.handlers} data-testid="mm-canvas" aria-label="Carte mentale interactive : glisser pour déplacer, molette ou pincement pour zoomer">
          <svg width="100%" height="100%" role="img" aria-label={content.root.title}>
            <g transform={`translate(${pz.view.x} ${pz.view.y}) scale(${pz.view.k})`} data-zoom={pz.view.k.toFixed(2)}>
              {layout.links.map((k) => {
                const a = by.get(k.from)!, b = by.get(k.to)!, h = content.orientation === 'horizontal';
                if (content.orientation === 'radial') return <line key={k.to} x1={a.x + a.w / 2} y1={a.y + a.h / 2} x2={b.x + b.w / 2} y2={b.y + b.h / 2} stroke="#9aa5c1" strokeWidth={1.6} />;
                const x1 = h ? a.x + a.w : a.x + a.w / 2, y1 = h ? a.y + a.h / 2 : a.y + a.h, x2 = h ? b.x : b.x + b.w / 2, y2 = h ? b.y + b.h / 2 : b.y;
                return <path key={k.to} d={`M${x1},${y1} C${h ? (x1 + x2) / 2 : x1},${h ? y1 : (y1 + y2) / 2} ${h ? (x1 + x2) / 2 : x2},${h ? y2 : (y1 + y2) / 2} ${x2},${y2}`} stroke="#9aa5c1" strokeWidth={1.6} fill="none" />;
              })}
              {layout.nodes.map((n) => {
                const st = COLORS[n.node.type] ?? COLORS.concept!;
                const isSel = sel === n.node.id, hit = matches.has(n.node.id);
                return (
                  <g key={n.node.id} data-testid="mm-node" data-id={n.node.id} data-title={n.node.title} className={`mm__node${isSel ? ' is-sel' : ''}`} tabIndex={0} role="button" aria-label={`${n.node.title}${n.node.children.length ? (n.node.collapsed ? ', replié' : ', déplié') : ''}`}
                    onClick={(e) => { e.stopPropagation(); if (!pz.wasDrag()) setSel(n.node.id); }} onDoubleClick={() => setRoot(toggleCollapse(content.root, n.node.id))}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSel(n.node.id); if (e.key === ' ') { e.preventDefault(); setRoot(toggleCollapse(content.root, n.node.id)); } }}>
                    <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={12} fill={st.fill} stroke={isSel ? '#ff3b5c' : hit ? '#f5a524' : st.stroke} strokeWidth={isSel || hit ? 3 : 1.6} strokeDasharray={n.node.uncertain ? '5 3' : undefined} />
                    {wrap(n.node.title, 26).map((l, k, arr) => <text key={k} x={n.x + n.w / 2} y={n.y + n.h / 2 + (k - (arr.length - 1) / 2) * 16 + 4} textAnchor="middle" fontSize={13} fontWeight={500} fill={n.node.type === 'root' ? '#fff' : '#1b2233'}>{l}</text>)}
                    {n.node.children.length > 0 && (
                      <g onClick={(e) => { e.stopPropagation(); setRoot(toggleCollapse(content.root, n.node.id)); }} data-testid="mm-toggle" role="button" aria-label={n.node.collapsed ? 'Déplier la branche' : 'Replier la branche'}>
                        <circle cx={content.orientation === 'vertical' ? n.x + n.w / 2 : n.x + n.w} cy={content.orientation === 'vertical' ? n.y + n.h : n.y + n.h / 2} r={10} fill="#1b2233" />
                        <text x={content.orientation === 'vertical' ? n.x + n.w / 2 : n.x + n.w} y={(content.orientation === 'vertical' ? n.y + n.h : n.y + n.h / 2) + 4} textAnchor="middle" fontSize={11} fill="#fff">{n.node.collapsed ? `+${n.hiddenChildren}` : '−'}</text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
        {selected && (
          <aside className="mm__panel no-print" aria-label="Détail du nœud" data-testid="mm-panel">
            <div className="field"><label htmlFor="mm-title">Titre</label><input id="mm-title" className="input" value={selected.title} onChange={(e) => setRoot(renameNode(content.root, selected.id, e.target.value || selected.title))} data-testid="mm-title" /></div>
            <div className="field"><label htmlFor="mm-desc">Explication</label><textarea id="mm-desc" className="input" rows={4} value={selected.description ?? ''} onChange={(e) => setRoot(describeNode(content.root, selected.id, e.target.value))} /></div>
            {selected.type !== 'root' && (
              <div className="field"><label htmlFor="mm-type">Type</label>
                <select id="mm-type" className="select" value={selected.type} onChange={(e) => setRoot(setNodeType(content.root, selected.id, e.target.value as MindNodeType))}>{MAP_NODE_TYPES.filter((t) => t !== 'root').map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select>
              </div>
            )}
            {selected.uncertain && <p className="banner banner--warn">Élément non retrouvé dans le cours : à vérifier.</p>}
            {showSources && <><strong>Sources</strong><Sources sources={selected.sources} /></>}
            <div className="row-actions">
              <button className="btn btn--sm" onClick={() => { const r = addChild(content.root, selected.id); setRoot(r.root); setSel(r.id); }} data-testid="mm-add-child"><Plus /> Sous-branche</button>
              {selected.type !== 'root' && <button className="btn btn--sm" onClick={() => { const r = addSibling(content.root, selected.id); setRoot(r.root); setSel(r.id); }}><Plus /> Voisine</button>}
            </div>
            {selected.type !== 'root' && (
              <>
                <div className="row-actions">
                  <button className="btn btn--sm" onClick={() => setRoot(moveSibling(content.root, selected.id, -1))}>↑ Monter</button>
                  <button className="btn btn--sm" onClick={() => setRoot(moveSibling(content.root, selected.id, 1))}>↓ Descendre</button>
                  <button className="btn btn--sm btn--danger" onClick={() => { setRoot(removeNode(content.root, selected.id)); setSel(null); }} data-testid="mm-delete"><Trash2 /> Supprimer</button>
                </div>
                <div className="field"><label htmlFor="mm-move">Déplacer sous…</label>
                  <select id="mm-move" className="select" value="" onChange={(e) => { if (e.target.value) setRoot(moveTo(content.root, selected.id, e.target.value)); }}>
                    <option value="">Choisir un nœud</option>
                    {flatten(content.root).filter((n) => n.id !== selected.id && !findNode(selected, n.id) && parentOf(content.root, selected.id)?.id !== n.id).map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
                  </select>
                </div>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
