/**
 * Mises en page (pures, testables) des cartes mentales et des schémas.
 * Aucune bibliothèque de graphe : un arbre et un graphe en couches suffisent, restent légers (PWA) et exportables en SVG.
 */
import type { DiagramContent, MapOrientation, MindNode } from '@/domain/study';

export const NODE_W = 190, NODE_H = 44, GAP_X = 70, GAP_Y = 14;

export interface PlacedNode { node: MindNode; x: number; y: number; w: number; h: number; depth: number; hiddenChildren: number }
export interface MapLayout { nodes: PlacedNode[]; links: { from: string; to: string }[]; width: number; height: number }

const visibleChildren = (n: MindNode) => (n.collapsed ? [] : n.children);

/** Arbre : horizontal (gauche → droite), vertical (haut → bas) ou radial. Les branches repliées ne sont pas placées. */
export function layoutMindMap(root: MindNode, orientation: MapOrientation): MapLayout {
  const nodes: PlacedNode[] = [];
  const links: MapLayout['links'] = [];
  const leaves = (n: MindNode): number => { const k = visibleChildren(n); return k.length ? k.reduce((a, c) => a + leaves(c), 0) : 1; };

  if (orientation === 'radial') {
    const total = leaves(root);
    const place = (n: MindNode, depth: number, a0: number, a1: number, parent?: MindNode) => {
      const mid = (a0 + a1) / 2;
      const r = depth * 230;
      nodes.push({ node: n, x: Math.cos(mid) * r, y: Math.sin(mid) * r * 0.8, w: NODE_W, h: NODE_H, depth, hiddenChildren: n.collapsed ? n.children.length : 0 });
      if (parent) links.push({ from: parent.id, to: n.id });
      let a = a0;
      for (const c of visibleChildren(n)) { const span = ((a1 - a0) * leaves(c)) / Math.max(1, leaves(n)); place(c, depth + 1, a, a + span, n); a += span; }
    };
    place(root, 0, -Math.PI / 2 + 0.0001, (3 * Math.PI) / 2 - 0.0001);
    void total;
  } else {
    let cursor = 0;
    const vertical = orientation === 'vertical';
    const place = (n: MindNode, depth: number, parent?: MindNode): number => {
      const kids = visibleChildren(n);
      let pos: number;
      if (!kids.length) { pos = cursor; cursor += (vertical ? NODE_W + GAP_Y : NODE_H + GAP_Y); }
      else { const ps = kids.map((c) => place(c, depth + 1, n)); pos = (ps[0]! + ps[ps.length - 1]!) / 2; }
      nodes.push({
        node: n, depth, w: NODE_W, h: NODE_H, hiddenChildren: n.collapsed ? n.children.length : 0,
        x: vertical ? pos : depth * (NODE_W + GAP_X), y: vertical ? depth * (NODE_H + GAP_X) : pos,
      });
      if (parent) links.push({ from: parent.id, to: n.id });
      return pos;
    };
    place(root, 0);
  }
  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  nodes.forEach((n) => { n.x -= minX - 20; n.y -= minY - 20; });
  return { nodes, links, width: Math.max(...nodes.map((n) => n.x + n.w)) + 20, height: Math.max(...nodes.map((n) => n.y + n.h)) + 20 };
}

/* ---------------------------------------------------------------- schéma en couches */
export interface DiagramLayout { pos: Record<string, { x: number; y: number; w: number; h: number }>; width: number; height: number }
export const DNODE_W = 200, DNODE_H = 52;

/** Couches par plus long chemin ; les cycles sont tolérés (l'arête de retour est ignorée pour le placement). */
export function layoutDiagram(d: DiagramContent): DiagramLayout {
  const out = new Map<string, string[]>(d.nodes.map((n) => [n.id, []]));
  const indeg = new Map<string, number>(d.nodes.map((n) => [n.id, 0]));
  d.edges.forEach((e) => { out.get(e.from)?.push(e.to); });
  // DFS pour retirer les arêtes de retour
  const state = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  const dfs = (u: string) => {
    state.set(u, 1);
    for (const v of out.get(u) ?? []) {
      if (state.get(v) === 1) back.add(`${u}>${v}`);
      else if (!state.get(v)) dfs(v);
    }
    state.set(u, 2);
  };
  d.nodes.forEach((n) => { if (!state.get(n.id)) dfs(n.id); });
  const edges = d.edges.filter((e) => !back.has(`${e.from}>${e.to}`));
  edges.forEach((e) => indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1));
  const layer = new Map<string, number>(d.nodes.map((n) => [n.id, 0]));
  const queue = d.nodes.filter((n) => !indeg.get(n.id)).map((n) => n.id);
  const left = new Map(indeg);
  while (queue.length) {
    const u = queue.shift()!;
    for (const e of edges.filter((x) => x.from === u)) {
      layer.set(e.to, Math.max(layer.get(e.to) ?? 0, (layer.get(u) ?? 0) + 1));
      left.set(e.to, (left.get(e.to) ?? 1) - 1);
      if (!left.get(e.to)) queue.push(e.to);
    }
  }
  const byLayer = new Map<number, string[]>();
  d.nodes.forEach((n) => { const l = layer.get(n.id) ?? 0; byLayer.set(l, [...(byLayer.get(l) ?? []), n.id]); });
  const horizontal = d.direction === 'horizontal';
  const pos: DiagramLayout['pos'] = {};
  const widest = Math.max(...[...byLayer.values()].map((v) => v.length), 1);
  for (const [l, ids] of byLayer) {
    ids.forEach((id, k) => {
      const n = d.nodes.find((x) => x.id === id)!;
      const along = k * (DNODE_W + 40) + ((widest - ids.length) * (DNODE_W + 40)) / 2;
      const across = l * (DNODE_H + 56);
      pos[id] = { x: n.x ?? (horizontal ? across * 3 : along) + 20, y: n.y ?? (horizontal ? along / 3 : across) + 20, w: DNODE_W, h: DNODE_H };
    });
  }
  const vals = Object.values(pos);
  return { pos, width: Math.max(...vals.map((p) => p.x + p.w), 0) + 20, height: Math.max(...vals.map((p) => p.y + p.h), 0) + 20 };
}
