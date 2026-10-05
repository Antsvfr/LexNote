import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { FileUp, PanelRight, Sparkles } from 'lucide-react';
import { getCommand, formatShortcut, type EditorCommand } from './commands';

function CmdButton({ editor, cmd, label, showLabel = true }: { editor: Editor; cmd: EditorCommand; label?: string; showLabel?: boolean }) {
  const active = useEditorState({ editor, selector: ({ editor: e }) => (cmd.isActive ? cmd.isActive(e) : false) });
  const Icon = cmd.icon;
  const text = label ?? cmd.label;
  const sc = formatShortcut(cmd.shortcut);
  return (
    <button
      type="button"
      className={`tb${active ? ' is-on' : ''}${cmd.id.startsWith('block.') ? ` tb--block tb--${cmd.id.slice(6)}` : ''}`}
      aria-pressed={cmd.isActive ? active : undefined}
      aria-label={text}
      title={sc ? `${text} (${sc})` : text}
      // mouseDown : on garde le focus et la sélection dans l'éditeur
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => cmd.run(editor)}
    >
      <Icon size={16} aria-hidden />
      {showLabel && <span className="tb__label">{text}</span>}
    </button>
  );
}

/** Barre d'actions LexNote : blocs juridiques et structure, en un clic. */
const ACTION_IDS: [string, string?][] = [
  ['block.important'], ['fmt.h1'], ['block.definition'], ['fmt.quote'], ['block.article'],
  ['block.caselaw'], ['block.example'], ['block.question'],
];
const FORMAT_GROUPS: string[][] = [
  ['fmt.bold', 'fmt.italic', 'fmt.underline'],
  ['fmt.h1', 'fmt.h2', 'fmt.h3'],
  ['fmt.bullets', 'fmt.numbers', 'fmt.quote', 'fmt.hr', 'fmt.link'],
  ['fmt.outdent', 'fmt.indent'],
  ['fmt.undo', 'fmt.redo'],
];

export function ActionBar({ editor, assistantOpen, onToggleAssistant }: { editor: Editor; assistantOpen: boolean; onToggleAssistant: () => void }) {
  return (
    <div className="actionbar" role="toolbar" aria-label="Actions LexNote">
      {ACTION_IDS.map(([id]) => {
        const cmd = getCommand(id);
        return cmd ? <CmdButton key={id} editor={editor} cmd={cmd} label={id === 'fmt.h1' ? 'Titre' : undefined} /> : null;
      })}
      <span className="actionbar__sep" aria-hidden />
      <button type="button" className="tb" aria-disabled="true" title="Import de documents — bientôt disponible" onClick={(e) => e.preventDefault()}>
        <FileUp size={16} aria-hidden /><span className="tb__label">Document</span><span className="tb__soon">bientôt</span>
      </button>
      <button type="button" className={`tb${assistantOpen ? ' is-on' : ''}`} aria-pressed={assistantOpen} onClick={onToggleAssistant} title="Afficher / masquer le panneau Assistant" data-testid="toggle-assistant">
        <Sparkles size={16} aria-hidden /><span className="tb__label">Assistant</span><PanelRight size={14} aria-hidden />
      </button>
    </div>
  );
}

export function FormatBar({ editor }: { editor: Editor }) {
  return (
    <div className="formatbar" role="toolbar" aria-label="Mise en forme">
      {FORMAT_GROUPS.map((g, i) => (
        <div className="formatbar__group" key={i}>
          {g.map((id) => {
            const cmd = getCommand(id);
            return cmd ? <CmdButton key={id} editor={editor} cmd={cmd} showLabel={false} /> : null;
          })}
        </div>
      ))}
    </div>
  );
}
