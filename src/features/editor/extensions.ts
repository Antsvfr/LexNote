import { Extension, Node, mergeAttributes, type AnyExtension, type Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { NOTE_BLOCKS, NOTE_BLOCK_KINDS, type NoteBlockKind } from '@/domain/legal';
import { BLOCK_SHORTCUT_KEYS } from './shortcuts';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    legalBlock: {
      toggleLegalBlock: (kind: NoteBlockKind) => ReturnType;
    };
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
  }
}

/**
 * Bloc juridique (Article, Jurisprudence, Définition…).
 * Porte dès maintenant `provenance` et `verification` : ce que l'étudiant écrit est
 * 'USER_NOTE'/'UNVERIFIED' ; une future IA ne pourra y ajouter que du 'AI'/'UNVERIFIED'.
 * Rendu en HTML statique (pas de NodeView React) pour garder la frappe fluide.
 */
export const LegalBlock = Node.create({
  name: 'legalBlock',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: 'important',
        parseHTML: (el) => el.getAttribute('data-kind'),
      },
      provenance: { default: 'USER_NOTE', parseHTML: (el) => el.getAttribute('data-provenance') ?? 'USER_NOTE' },
      verification: { default: 'UNVERIFIED', parseHTML: (el) => el.getAttribute('data-verification') ?? 'UNVERIFIED' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-legal-block]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const kind = node.attrs.kind as NoteBlockKind;
    const def = NOTE_BLOCKS[kind];
    return [
      'div',
      mergeAttributes(
        {
          'data-legal-block': '',
          'data-kind': kind,
          'data-provenance': node.attrs.provenance,
          'data-verification': node.attrs.verification,
          'data-label': def ? `${def.emoji}  ${def.label}` : '',
          role: 'group',
          'aria-label': def?.label ?? 'Bloc',
        },
        { class: HTMLAttributes.class },
      ),
      0,
    ];
  },

  addCommands() {
    return {
      toggleLegalBlock:
        (kind) =>
        ({ editor, commands }) => {
          if (editor.isActive('legalBlock', { kind })) return commands.lift('legalBlock');
          if (editor.isActive('legalBlock')) return commands.updateAttributes('legalBlock', { kind });
          return commands.wrapIn('legalBlock', { kind });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // Entrée sur une ligne vide à la fin d'un bloc : on en sort (sinon impossible de "fermer" un bloc au clavier).
      Enter: () => {
        const { $from, empty } = this.editor.state.selection;
        if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size > 0) return false;
        if ($from.depth < 2 || $from.node($from.depth - 1).type.name !== 'legalBlock') return false;
        const block = $from.node($from.depth - 1);
        if ($from.index($from.depth - 1) !== block.childCount - 1) return false;
        return this.editor.commands.liftEmptyBlock();
      },
      ...Object.fromEntries(
      NOTE_BLOCK_KINDS.map((k) => [`Mod-Alt-${BLOCK_SHORTCUT_KEYS[k].toLowerCase()}`, () => this.editor.commands.toggleLegalBlock(k)]),
      ),
    };
  },
});

const MAX_INDENT = 5;

/** Retrait des paragraphes/titres (Tab / Maj+Tab). Dans une liste, Tab imbrique l'élément. */
export const Indent = Extension.create({
  name: 'indent',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Number(el.getAttribute('data-indent')) || 0,
            renderHTML: (attrs) => (attrs.indent ? { 'data-indent': String(attrs.indent) } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    const shift = (delta: number) => () => ({ state, tr, dispatch }: { state: Editor['state']; tr: Editor['state']['tr']; dispatch?: (tr: Editor['state']['tr']) => void }) => {
      let changed = false;
      state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
        if (node.type.name === 'paragraph' || node.type.name === 'heading') {
          const next = Math.max(0, Math.min(MAX_INDENT, ((node.attrs.indent as number) || 0) + delta));
          if (next !== node.attrs.indent) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
            changed = true;
          }
          return false;
        }
        return true;
      });
      if (changed && dispatch) dispatch(tr);
      return changed;
    };
    return { indent: shift(1), outdent: shift(-1) };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive('listItem')) return false; // laissé à l'extension de liste
        this.editor.commands.indent();
        return true; // on garde le focus dans l'éditeur
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('listItem')) return false;
        this.editor.commands.outdent();
        return true;
      },
    };
  },
});

export function buildExtensions(opts: { placeholder?: string } = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } },
    }),
    Placeholder.configure({ placeholder: opts.placeholder ?? 'Commencez à prendre vos notes…' }),
    LegalBlock,
    Indent,
  ];
}
