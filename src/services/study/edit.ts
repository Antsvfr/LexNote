/** Opérations d'édition (pures) sur les supports : l'utilisateur n'est jamais bloqué dans une sortie figée. */
import { newId } from '@/lib/ids';
import type { DiagramContent, MindNode, MindNodeType } from '@/domain/study';

/* ------------------------------------------------------------ carte mentale */
const clone = <T,>(v: T): T => structuredClone(v);
export const findNode = (root: MindNode, id: string): MindNode | undefined => {
  if (root.id === id) return root;
  for (const c of root.children) { const f = findNode(c, id); if (f) return f; }
  return undefined;
};
export const parentOf = (root: MindNode, id: string): MindNode | undefined => {
  for (const c of root.children) { if (c.id === id) return root; const p = parentOf(c, id); if (p) return p; }
  return undefined;
};
export const pathTo = (root: MindNode, id: string): MindNode[] => {
  if (root.id === id) return [root];
  for (const c of root.children) { const p = pathTo(c, id); if (p.length) return [root, ...p]; }
  return [];
};
export const flatten = (n: MindNode): MindNode[] => [n, ...n.children.flatMap(flatten)];

function mutate(root: MindNode, fn: (r: MindNode) => void): MindNode { const r = clone(root); fn(r); return r; }

export const renameNode = (root: MindNode, id: string, title: string) => mutate(root, (r) => { const n = findNode(r, id); if (n && title.trim()) n.title = title.trim(); });
export const describeNode = (root: MindNode, id: string, description: string) => mutate(root, (r) => { const n = findNode(r, id); if (n) n.description = description || undefined; });
export const setNodeType = (root: MindNode, id: string, type: MindNodeType) => mutate(root, (r) => { const n = findNode(r, id); if (n && n.type !== 'root') n.type = type; });
export const toggleCollapse = (root: MindNode, id: string) => mutate(root, (r) => { const n = findNode(r, id); if (n && n.children.length) n.collapsed = !n.collapsed; });
export const setAllCollapsed = (root: MindNode, collapsed: boolean, fromDepth = 1) => mutate(root, (r) => {
  const walk = (n: MindNode, d: number) => { n.collapsed = collapsed && d >= fromDepth && n.children.length ? true : undefined; n.children.forEach((c) => walk(c, d + 1)); };
  walk(r, 0);
});
/** Ouvre toutes les branches menant à `id` (recherche, sélection). */
export const expandTo = (root: MindNode, id: string) => mutate(root, (r) => { pathTo(r, id).slice(0, -1).forEach((n) => { n.collapsed = undefined; }); });

export function addChild(root: MindNode, parentId: string, title = 'Nouvelle branche'): { root: MindNode; id: string } {
  const id = newId();
  return { id, root: mutate(root, (r) => { const p = findNode(r, parentId); if (p) { p.collapsed = undefined; p.children.push({ id, title, type: 'concept', sources: [], children: [] }); } }) };
}
export function addSibling(root: MindNode, id: string, title = 'Nouvelle branche'): { root: MindNode; id: string } {
  const nid = newId();
  return { id: nid, root: mutate(root, (r) => { const p = parentOf(r, id); if (!p) return; const k = p.children.findIndex((c) => c.id === id); p.children.splice(k + 1, 0, { id: nid, title, type: 'concept', sources: [], children: [] }); }) };
}
export const removeNode = (root: MindNode, id: string) => mutate(root, (r) => { const p = parentOf(r, id); if (p) p.children = p.children.filter((c) => c.id !== id); });
export const moveSibling = (root: MindNode, id: string, dir: -1 | 1) => mutate(root, (r) => {
  const p = parentOf(r, id); if (!p) return;
  const k = p.children.findIndex((c) => c.id === id), j = k + dir;
  if (j < 0 || j >= p.children.length) return;
  [p.children[k], p.children[j]] = [p.children[j]!, p.children[k]!];
});
/** Réorganisation : déplace une branche sous un autre nœud (jamais sous elle-même). */
export function moveTo(root: MindNode, id: string, newParentId: string): MindNode {
  const node = findNode(root, id);
  if (!node || id === root.id || (node && findNode(node, newParentId))) return root;
  return mutate(root, (r) => {
    const p = parentOf(r, id)!, n = findNode(r, id)!, np = findNode(r, newParentId)!;
    p.children = p.children.filter((c) => c.id !== id); np.children.push(n); np.collapsed = undefined;
  });
}
export const searchNodes = (root: MindNode, q: string): MindNode[] => {
  const t = q.trim().toLowerCase();
  return t ? flatten(root).filter((n) => n.title.toLowerCase().includes(t) || (n.description ?? '').toLowerCase().includes(t)) : [];
};

/* ------------------------------------------------------------ schéma */
const mutD = (d: DiagramContent, fn: (x: DiagramContent) => void): DiagramContent => { const x = clone(d); fn(x); return x; };
export const relabelDiagramNode = (d: DiagramContent, id: string, label: string) => mutD(d, (x) => { const n = x.nodes.find((n) => n.id === id); if (n && label.trim()) n.label = label.trim(); });
export const moveDiagramNode = (d: DiagramContent, id: string, xx: number, yy: number) => mutD(d, (x) => { const n = x.nodes.find((n) => n.id === id); if (n) { n.x = Math.round(xx); n.y = Math.round(yy); } });
export function addDiagramStepAfter(d: DiagramContent, afterId: string | null, label = 'Nouvelle étape', kind: DiagramContent['nodes'][number]['kind'] = 'step'): { content: DiagramContent; id: string } {
  const id = newId();
  return { id, content: mutD(d, (x) => {
    x.nodes.push({ id, label, kind, sources: [] });
    if (afterId) {
      const outs = x.edges.filter((e) => e.from === afterId);
      // Insertion dans une chaîne : A → B devient A → nouveau → B (l'ordre reste celui voulu par l'utilisateur).
      if (outs.length === 1) { const e = outs[0]!; x.edges.push({ id: newId(), from: id, to: e.to, basis: 'stated' }); e.to = id; }
      else x.edges.push({ id: newId(), from: afterId, to: id, basis: 'stated' });
    }
  }) };
}
export const removeDiagramNode = (d: DiagramContent, id: string) => mutD(d, (x) => {
  const ins = x.edges.filter((e) => e.to === id), outs = x.edges.filter((e) => e.from === id);
  x.nodes = x.nodes.filter((n) => n.id !== id);
  x.edges = x.edges.filter((e) => e.from !== id && e.to !== id);
  if (ins.length === 1 && outs.length === 1) x.edges.push({ id: newId(), from: ins[0]!.from, to: outs[0]!.to, basis: 'stated' }); // on referme la chaîne
});
export const setEdgeLabel = (d: DiagramContent, id: string, label: string) => mutD(d, (x) => { const e = x.edges.find((e) => e.id === id); if (e) e.label = label || undefined; });
export const addDiagramEdge = (d: DiagramContent, from: string, to: string, label?: string) => mutD(d, (x) => {
  if (from === to || x.edges.some((e) => e.from === from && e.to === to)) return;
  x.edges.push({ id: newId(), from, to, basis: 'stated', ...(label ? { label } : {}) }); // créée par l'utilisateur : « dit »
});
export const removeDiagramEdge = (d: DiagramContent, id: string) => mutD(d, (x) => { x.edges = x.edges.filter((e) => e.id !== id); });
