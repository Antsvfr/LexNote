import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, FolderTree, Library, Search, Settings, Plus, Moon, Sun, Focus, FileText, type LucideIcon } from 'lucide-react';
import { useUI } from '@/store/ui';
import { useEditorBridge } from '@/store/editorBridge';
import { useLibrary } from '@/store/library';
import { EDITOR_COMMANDS, formatShortcut, modKeyLabel } from '@/features/editor/commands';
import { searchService } from '@/services/search';
import { normalize } from '@/lib/text';

interface Item {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  keywords?: string;
  shortcut?: string;
  disabled?: boolean;
  note?: string;
  run: () => void;
}

/** Palette de commandes (Cmd/Ctrl + K) : navigation, blocs juridiques, mise en forme. Les commandes IA sont listées mais désactivées. */
export function CommandPalette() {
  const { paletteOpen, setPalette, openNewCm, theme, setTheme, focus, setFocus } = useUI();
  const editor = useEditorBridge((s) => s.editor);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const lib = useLibrary();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Raccourci global
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(!useUI.getState().paletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPalette]);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (paletteOpen && !d.open) { setQuery(''); setActive(0); d.showModal(); }
    if (!paletteOpen && d.open) d.close();
  }, [paletteOpen]);

  const close = () => setPalette(false);
  const inEditor = pathname.startsWith('/session/') && !pathname.endsWith('/recap') && !!editor;

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => navigate(to);
    const nav: Item[] = [
      { id: 'nav.new', label: 'Nouveau CM', group: 'Aller à', icon: Plus, run: () => openNewCm() },
      { id: 'nav.home', label: 'Accueil', group: 'Aller à', icon: Home, run: go('/') },
      { id: 'nav.subjects', label: 'Mes matières', group: 'Aller à', icon: FolderTree, run: go('/subjects') },
      { id: 'nav.sessions', label: 'Mes CM', group: 'Aller à', icon: Library, run: go('/sessions') },
      { id: 'nav.search', label: 'Recherche', group: 'Aller à', icon: Search, run: go('/search') },
      { id: 'nav.settings', label: 'Réglages', group: 'Aller à', icon: Settings, run: go('/settings') },
      { id: 'app.theme', label: theme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre', group: 'Affichage', icon: theme === 'dark' ? Sun : Moon, keywords: 'theme mode sombre clair', run: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
    ];
    const ed: Item[] = inEditor && editor
      ? [
          { id: 'app.focus', label: focus ? 'Quitter le mode Focus' : 'Activer le mode Focus', group: 'Affichage', icon: Focus, keywords: 'focus concentration', run: () => setFocus(!focus) },
          ...EDITOR_COMMANDS.map<Item>((c) => ({
            id: c.id, label: c.label, group: c.group, icon: c.icon, keywords: c.keywords.join(' '),
            shortcut: formatShortcut(c.shortcut), disabled: !c.available, note: c.note,
            run: () => c.run(editor),
          })),
        ]
      : [];
    return [...ed, ...nav];
  }, [inEditor, editor, focus, theme, navigate, openNewCm, setTheme, setFocus]);

  const results = useMemo<Item[]>(() => {
    const tokens = normalize(query).split(/\s+/).filter(Boolean);
    const matched = tokens.length
      ? items.filter((i) => { const hay = normalize(`${i.label} ${i.keywords ?? ''}`); return tokens.every((t) => hay.includes(t)); })
      : items;
    const sessions: Item[] = query.trim().length >= 2
      ? searchService.search(query, lib).filter((h) => h.kind === 'session').slice(0, 5).map((h) => ({
          id: `hit.${h.id}`, label: h.title, group: 'CM', icon: FileText, keywords: h.context, run: () => navigate(h.href),
        }))
      : [];
    return [...matched, ...sessions];
  }, [items, query, lib, navigate]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  function exec(item: Item | undefined) {
    if (!item || item.disabled) return;
    close();
    // Après fermeture de la modale, le focus revient à l'éditeur avant d'appliquer la commande.
    setTimeout(item.run, 0);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); exec(results[active]); }
  }

  let lastGroup = '';
  return (
    <dialog ref={dialogRef} className="palette" aria-label="Palette de commandes" onClose={close} onClick={(e) => e.target === dialogRef.current && close()}>
      {paletteOpen && (
        <div onKeyDown={onKeyDown}>
          <div className="palette__input">
            <Search size={16} aria-hidden />
            <input
              autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={inEditor ? 'Insérer un bloc, mettre en forme, naviguer…' : 'Aller à…'}
              role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={results[active] ? `pal-${results[active]!.id}` : undefined}
              aria-label="Rechercher une commande" data-testid="palette-input"
            />
            <kbd>Échap</kbd>
          </div>
          <ul id="palette-list" role="listbox" className="palette__list" ref={listRef}>
            {results.length === 0 && <li className="palette__empty">Aucune commande trouvée.</li>}
            {results.map((it, idx) => {
              const header = it.group !== lastGroup ? it.group : null;
              lastGroup = it.group;
              const Icon = it.icon;
              return (
                <li key={it.id} role="presentation">
                  {header && <div className="palette__group">{header}</div>}
                  <div
                    id={`pal-${it.id}`} role="option" aria-selected={idx === active} aria-disabled={it.disabled || undefined}
                    className={`palette__item${idx === active ? ' is-active' : ''}${it.disabled ? ' is-disabled' : ''}`}
                    onMouseMove={() => setActive(idx)} onClick={() => exec(it)}
                  >
                    <Icon size={16} aria-hidden />
                    <span className="truncate">{it.label}</span>
                    {it.note && <span className="tag tag--soon">{it.note}</span>}
                    {it.shortcut && <kbd>{it.shortcut}</kbd>}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="palette__foot"><span><kbd>↑↓</kbd> naviguer</span><span><kbd>↵</kbd> choisir</span><span>{modKeyLabel} K</span></div>
        </div>
      )}
    </dialog>
  );
}
