import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, FolderTree, Layers, FileText } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { searchService, type SearchHit } from '@/services/search';

const ICONS = { subject: FolderTree, module: Layers, session: FileText } as const;
const KIND_LABEL = { subject: 'Matière', module: 'Module', session: 'CM' } as const;

/** Met en évidence les mots recherchés (insensible à la casse, sans toucher aux accents). */
function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = query.trim().split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!tokens.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${tokens.join('|')})`, 'gi'));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get('q') ?? '';
  const [q, setQ] = useState(initial);
  const [debounced, setDebounced] = useState(initial);
  const { subjects, modules, sessions } = useLibrary();

  // La recherche est différée : elle ne se déclenche jamais pendant la frappe d'une note.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setParams(q ? { q } : {}, { replace: true });
    }, 150);
    return () => clearTimeout(t);
  }, [q, setParams]);

  const hits: SearchHit[] = useMemo(
    () => searchService.search(debounced, { subjects, modules, sessions }),
    [debounced, subjects, modules, sessions],
  );

  return (
    <div className="page page-enter">
      <header className="page__head"><div><h1>Recherche</h1><p className="page__sub">Matières, modules, titres de CM et contenu des notes.</p></div></header>
      <div className="searchbox searchbox--lg" role="search">
        <Search size={18} aria-hidden />
        <input aria-label="Recherche" placeholder="Ex. vices du consentement, 1128, Poussin…" value={q} autoFocus onChange={(e) => setQ(e.target.value)} data-testid="search-input" />
      </div>

      {debounced.trim() && (
        <p className="muted" style={{ margin: '16px 0 8px' }} aria-live="polite">{hits.length} résultat{hits.length > 1 ? 's' : ''}</p>
      )}
      {!debounced.trim() ? (
        <div className="empty"><strong>Tapez pour rechercher</strong>La recherche porte sur tout le contenu stocké sur cet appareil.</div>
      ) : hits.length === 0 ? (
        <div className="empty"><strong>Aucun résultat</strong>Essayez avec d’autres mots.</div>
      ) : (
        <ul className="list" data-testid="search-results">
          {hits.map((h) => {
            const Icon = ICONS[h.kind];
            return (
              <li key={`${h.kind}-${h.id}`} className="srow">
                <Link to={h.href} className="srow__main">
                  <span className="srow__icon"><Icon size={16} /></span>
                  <span className="srow__text">
                    <span className="srow__title"><Highlight text={h.title} query={debounced} /></span>
                    <span className="srow__meta">{h.context}</span>
                    {h.snippet && h.matchedIn === 'content' && <span className="srow__snippet"><Highlight text={h.snippet} query={debounced} /></span>}
                  </span>
                  <span className="tag">{KIND_LABEL[h.kind]}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
