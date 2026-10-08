/**
 * Plan structuré d'une séance, extrait du document de notes (TipTap/ProseMirror).
 * C'est la SEULE porte d'entrée des générateurs : tout ce qu'un support affiche vient d'ici (donc du cours réel).
 */
import type { NoteBlockKind } from '@/domain/legal';

export type BlockKind = NoteBlockKind | 'paragraph' | 'list' | 'step';

export interface OutlineBlock {
  id: string;
  kind: BlockKind;
  text: string;
  headingPath: string[];
}
export interface OutlineSection {
  id: string;
  title: string;
  level: number;
  path: string[];
  blocks: OutlineBlock[];
  children: OutlineSection[];
}
export interface Outline {
  sessionId: string;
  title: string;
  root: OutlineSection;
  /** Toutes les sections (hors racine), dans l'ordre du cours. */
  sections: OutlineSection[];
  text: string;
  wordCount: number;
}

/** Empreinte FNV-1a (suffisante pour détecter un changement de texte, pas cryptographique). */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

type PMNode = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: PMNode[] };
const BLOCK_KINDS = ['article', 'caselaw', 'definition', 'important', 'example', 'question'];

function inlineText(n: PMNode | undefined): string {
  if (!n) return '';
  if (typeof n.text === 'string') return n.text;
  if (n.type === 'hardBreak') return ' ';
  const parts = (n.content ?? []).map(inlineText);
  const blockish = (n.content ?? []).some((c) => ['paragraph', 'heading', 'listItem', 'bulletList', 'orderedList', 'blockquote'].includes(c.type ?? ''));
  return parts.join(blockish ? '\n' : '').replace(/\s+\n/g, '\n').trim();
}
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function buildOutline(sessionId: string, sessionTitle: string, doc: unknown): Outline {
  const used = new Map<string, number>();
  const uniq = (base: string) => { const n = (used.get(base) ?? 0) + 1; used.set(base, n); return n === 1 ? base : `${base}-${n}`; };

  const root: OutlineSection = { id: 'root', title: sessionTitle || 'Cours', level: 0, path: [], blocks: [], children: [] };
  const sections: OutlineSection[] = [];
  const stack: OutlineSection[] = [root];
  const fullText: string[] = [];

  const addBlock = (kind: BlockKind, text: string) => {
    const t = clean(text);
    if (!t) return;
    const cur = stack[stack.length - 1]!;
    cur.blocks.push({ id: uniq(`b-${hashText(`${cur.id}|${kind}|${t}`)}`), kind, text: t, headingPath: cur.path });
    fullText.push(t);
  };

  const walk = (n: PMNode, ordered = false) => {
    switch (n.type) {
      case 'heading': {
        const title = clean(inlineText(n));
        if (!title) return;
        const level = Math.min(6, Math.max(1, Number(n.attrs?.level ?? 1)));
        while (stack.length > 1 && stack[stack.length - 1]!.level >= level) stack.pop();
        const parent = stack[stack.length - 1]!;
        const path = [...parent.path, title];
        const sec: OutlineSection = { id: uniq(`s-${hashText(path.join('>'))}`), title, level, path, blocks: [], children: [] };
        parent.children.push(sec); sections.push(sec); stack.push(sec);
        fullText.push(title);
        return;
      }
      case 'paragraph': addBlock('paragraph', inlineText(n)); return;
      case 'legalBlock': {
        const k = String(n.attrs?.kind ?? 'important');
        addBlock((BLOCK_KINDS.includes(k) ? k : 'important') as BlockKind, inlineText(n));
        return;
      }
      case 'orderedList': case 'bulletList':
        (n.content ?? []).forEach((li) => {
          const nested = (li.content ?? []).filter((c) => c.type === 'bulletList' || c.type === 'orderedList');
          const own = { ...li, content: (li.content ?? []).filter((c) => c !== nested[0] && !nested.includes(c)) };
          addBlock(n.type === 'orderedList' ? 'step' : 'list', inlineText(own));
          nested.forEach((x) => walk(x, n.type === 'orderedList'));
        });
        return;
      case 'blockquote': addBlock('paragraph', inlineText(n)); return;
      default: (n.content ?? []).forEach((c) => walk(c, ordered));
    }
  };
  walk((doc ?? {}) as PMNode);

  const text = fullText.join('\n');
  return { sessionId, title: root.title, root, sections, text, wordCount: text ? text.split(/\s+/).length : 0 };
}

/** Section demandée (et ses descendantes) — ou le cours entier. */
export function scopeSection(outline: Outline, sectionId?: string): OutlineSection {
  if (!sectionId) return outline.root;
  return outline.sections.find((s) => s.id === sectionId) ?? outline.root;
}

export function allBlocks(sec: OutlineSection): OutlineBlock[] {
  return [...sec.blocks, ...sec.children.flatMap(allBlocks)];
}
export function allSections(sec: OutlineSection): OutlineSection[] {
  return sec.children.flatMap((c) => [c, ...allSections(c)]);
}
/** Texte d'une portée (titres + blocs) : sert à l'empreinte « le cours a changé ». */
export function scopeText(sec: OutlineSection): string {
  return [sec.title, ...sec.blocks.map((b) => b.text), ...sec.children.map(scopeText)].join('\n');
}
export const scopeHash = (sec: OutlineSection) => hashText(scopeText(sec));
