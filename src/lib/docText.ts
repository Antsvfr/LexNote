/** Texte brut d'un document ProseMirror/TipTap sérialisé (blocs séparés par des sauts de ligne). */
export function docToPlainText(doc: unknown): string {
  const out: string[] = [];
  const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'legalBlock']);
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const node = n as { type?: string; text?: string; content?: unknown[] };
    if (typeof node.text === 'string') out.push(node.text);
    node.content?.forEach(walk);
    if (node.type && BLOCKS.has(node.type)) out.push('\n');
  };
  walk(doc);
  return out.join('').replace(/\n{2,}/g, '\n').trim();
}
