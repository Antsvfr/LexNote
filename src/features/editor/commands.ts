import type { Editor } from '@tiptap/core';
import type { LucideIcon } from 'lucide-react';
import {
  Bold, Italic, Underline, Heading1, Heading2, Heading3, List, ListOrdered, Quote, Minus, Link2,
  Undo2, Redo2, IndentIncrease, IndentDecrease, Scale, BookMarked, Lightbulb, Star, GraduationCap, HelpCircle,
  Sparkles, Wand2, MessageSquareText, FileText, Pencil, SpellCheck, ShieldCheck,
} from 'lucide-react';
import { NOTE_BLOCKS, type NoteBlockKind } from '@/domain/legal';
import { AI_COMMANDS, type AICommandId } from '@/services/ai';
import { BLOCK_SHORTCUT_KEYS } from './shortcuts';

export type CommandGroup = 'Blocs' | 'Mise en forme' | 'Assistant';

export interface EditorCommand {
  id: string;
  label: string;
  keywords: string[];
  group: CommandGroup;
  icon: LucideIcon;
  /** Raccourci affiché, en notation `Mod+Alt+A`. */
  shortcut?: string;
  run: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
  /** Faux = affichée mais désactivée ("bientôt") — jamais simulée. */
  available: boolean;
  note?: string;
}

const BLOCK_ICONS: Record<NoteBlockKind, LucideIcon> = {
  article: Scale, caselaw: BookMarked, definition: Lightbulb, important: Star, example: GraduationCap, question: HelpCircle,
};

const blockCommands: EditorCommand[] = (Object.keys(NOTE_BLOCKS) as NoteBlockKind[]).map((kind) => ({
  id: `block.${kind}`,
  label: NOTE_BLOCKS[kind].label,
  keywords: [kind, NOTE_BLOCKS[kind].hint],
  group: 'Blocs',
  icon: BLOCK_ICONS[kind],
  shortcut: `Mod+Alt+${BLOCK_SHORTCUT_KEYS[kind]}`,
  run: (e) => e.chain().focus().toggleLegalBlock(kind).run(),
  isActive: (e) => e.isActive('legalBlock', { kind }),
  available: true,
}));

const setLink = (e: Editor) => {
  const prev = (e.getAttributes('link').href as string | undefined) ?? '';
  const url = window.prompt('Adresse du lien (laisser vide pour retirer)', prev);
  if (url === null) return;
  const href = url.trim();
  if (!href) return void e.chain().focus().extendMarkRange('link').unsetLink().run();
  const safe = /^(https?:|mailto:)/i.test(href) ? href : `https://${href}`;
  e.chain().focus().extendMarkRange('link').setLink({ href: safe }).run();
};

const formatCommands: EditorCommand[] = [
  { id: 'fmt.h1', label: 'Titre', keywords: ['h1', 'titre', 'heading'], group: 'Mise en forme', icon: Heading1, shortcut: 'Mod+Alt+1', run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), isActive: (e) => e.isActive('heading', { level: 1 }), available: true },
  { id: 'fmt.h2', label: 'Sous-titre', keywords: ['h2', 'sous-titre', 'heading'], group: 'Mise en forme', icon: Heading2, shortcut: 'Mod+Alt+2', run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), isActive: (e) => e.isActive('heading', { level: 2 }), available: true },
  { id: 'fmt.h3', label: 'Titre 3', keywords: ['h3', 'heading', 'sous-sous-titre'], group: 'Mise en forme', icon: Heading3, shortcut: 'Mod+Alt+3', run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), isActive: (e) => e.isActive('heading', { level: 3 }), available: true },
  { id: 'fmt.bold', label: 'Gras', keywords: ['bold', 'gras'], group: 'Mise en forme', icon: Bold, shortcut: 'Mod+B', run: (e) => e.chain().focus().toggleBold().run(), isActive: (e) => e.isActive('bold'), available: true },
  { id: 'fmt.italic', label: 'Italique', keywords: ['italic', 'italique'], group: 'Mise en forme', icon: Italic, shortcut: 'Mod+I', run: (e) => e.chain().focus().toggleItalic().run(), isActive: (e) => e.isActive('italic'), available: true },
  { id: 'fmt.underline', label: 'Souligné', keywords: ['underline', 'souligne'], group: 'Mise en forme', icon: Underline, shortcut: 'Mod+U', run: (e) => e.chain().focus().toggleUnderline().run(), isActive: (e) => e.isActive('underline'), available: true },
  { id: 'fmt.bullets', label: 'Liste à puces', keywords: ['liste', 'puces', 'bullet'], group: 'Mise en forme', icon: List, shortcut: 'Mod+Shift+8', run: (e) => e.chain().focus().toggleBulletList().run(), isActive: (e) => e.isActive('bulletList'), available: true },
  { id: 'fmt.numbers', label: 'Liste numérotée', keywords: ['liste', 'numero', 'ordered'], group: 'Mise en forme', icon: ListOrdered, shortcut: 'Mod+Shift+7', run: (e) => e.chain().focus().toggleOrderedList().run(), isActive: (e) => e.isActive('orderedList'), available: true },
  { id: 'fmt.quote', label: 'Citation', keywords: ['citation', 'quote', 'blockquote'], group: 'Mise en forme', icon: Quote, shortcut: 'Mod+Shift+B', run: (e) => e.chain().focus().toggleBlockquote().run(), isActive: (e) => e.isActive('blockquote'), available: true },
  { id: 'fmt.hr', label: 'Séparateur', keywords: ['separateur', 'ligne', 'hr'], group: 'Mise en forme', icon: Minus, run: (e) => e.chain().focus().setHorizontalRule().run(), available: true },
  { id: 'fmt.link', label: 'Lien', keywords: ['lien', 'url', 'link'], group: 'Mise en forme', icon: Link2, run: setLink, isActive: (e) => e.isActive('link'), available: true },
  { id: 'fmt.indent', label: 'Augmenter le retrait', keywords: ['indent', 'retrait', 'tab'], group: 'Mise en forme', icon: IndentIncrease, shortcut: 'Tab', run: (e) => e.chain().focus().indent().run(), available: true },
  { id: 'fmt.outdent', label: 'Diminuer le retrait', keywords: ['outdent', 'retrait'], group: 'Mise en forme', icon: IndentDecrease, shortcut: 'Shift+Tab', run: (e) => e.chain().focus().outdent().run(), available: true },
  { id: 'fmt.undo', label: 'Annuler', keywords: ['undo', 'annuler'], group: 'Mise en forme', icon: Undo2, shortcut: 'Mod+Z', run: (e) => e.chain().focus().undo().run(), available: true },
  { id: 'fmt.redo', label: 'Rétablir', keywords: ['redo', 'retablir'], group: 'Mise en forme', icon: Redo2, shortcut: 'Mod+Shift+Z', run: (e) => e.chain().focus().redo().run(), available: true },
];

const AI_ICONS: Record<AICommandId, LucideIcon> = {
  rephrase: Pencil, explain: MessageSquareText, summarize: FileText, expand: Wand2, correct: SpellCheck, 'verify-legal': ShieldCheck,
};

/** Commandes IA prévues : listées pour fixer l'architecture, volontairement non exécutables en V1. */
const aiCommands: EditorCommand[] = AI_COMMANDS.map((c) => ({
  id: `ai.${c.id}`,
  label: c.label,
  keywords: [c.description],
  group: 'Assistant',
  icon: AI_ICONS[c.id] ?? Sparkles,
  run: () => undefined,
  available: false,
  note: 'Bientôt',
}));

export const EDITOR_COMMANDS: EditorCommand[] = [...blockCommands, ...formatCommands, ...aiCommands];
export const getCommand = (id: string) => EDITOR_COMMANDS.find((c) => c.id === id);

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** `Mod+Alt+A` → `⌘⌥A` (Mac) ou `Ctrl+Alt+A`. */
export function formatShortcut(s?: string): string {
  if (!s) return '';
  const parts = s.split('+');
  if (isMac) {
    const map: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧', Ctrl: '⌃' };
    return parts.map((p) => map[p] ?? p).join('');
  }
  return parts.map((p) => (p === 'Mod' ? 'Ctrl' : p)).join('+');
}
export const modKeyLabel = isMac ? '⌘' : 'Ctrl';
