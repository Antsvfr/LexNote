/** Mini-constructeur de documents TipTap, réservé aux données de démonstration. */
type Node = Record<string, unknown>;

export type Inline = string | { b: string } | { i: string };

const inline = (parts: Inline[] | Inline): Node[] =>
  (Array.isArray(parts) ? parts : [parts]).map((p) => {
    if (typeof p === 'string') return { type: 'text', text: p };
    if ('b' in p) return { type: 'text', text: p.b, marks: [{ type: 'bold' }] };
    return { type: 'text', text: p.i, marks: [{ type: 'italic' }] };
  });

export const p = (...parts: Inline[]): Node => ({ type: 'paragraph', content: inline(parts) });
export const h = (level: 1 | 2 | 3, text: string): Node => ({ type: 'heading', attrs: { level }, content: inline(text) });
export const ul = (...items: Inline[][]): Node => ({
  type: 'bulletList',
  content: items.map((it) => ({ type: 'listItem', content: [{ type: 'paragraph', content: inline(it) }] })),
});
export const ol = (...items: Inline[][]): Node => ({
  type: 'orderedList',
  content: items.map((it) => ({ type: 'listItem', content: [{ type: 'paragraph', content: inline(it) }] })),
});
export const hr = (): Node => ({ type: 'horizontalRule' });
export const quote = (text: string): Node => ({ type: 'blockquote', content: [p(text)] });
export const legal = (kind: string, ...children: Node[]): Node => ({
  type: 'legalBlock',
  attrs: { kind, provenance: 'USER_NOTE', verification: 'UNVERIFIED' },
  content: children,
});
export const doc = (...content: Node[]) => ({ type: 'doc', content });

/** Texte brut d'un document (pour compter les mots et indexer la recherche). */
export function plainTextOf(node: unknown): string {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (typeof n.text === 'string') out.push(n.text);
    const kids = n.content as Node[] | undefined;
    kids?.forEach(walk);
    if (['paragraph', 'heading', 'listItem', 'blockquote', 'legalBlock'].includes(n.type as string)) out.push('\n');
  };
  walk(node as Node);
  return out.join('').replace(/\n{2,}/g, '\n').trim();
}
