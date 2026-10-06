import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, FolderTree, Layers, FileText, Mic, PenLine } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { searchService, type SearchHit } from '@/services/search';
import { captureManager } from '@/services/capture/manager';
import type { TranscriptHit } from '@/services/search/transcriptSearch';
import { formatHMS } from '@/domain/capture';
import { sessionLabel } from '@/domain/session';

/** Met en évidence les mots recherchés (insensible à la casse, sans toucher aux accents). */
function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = query.trim().split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!tokens.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${tokens.join('|')})`, 'gi'));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>;
}

function Group({ id, title, icon, count, children, testId }: { id: string; title: string; icon: React.ReactNode; count: number; children: React.ReactNode; testId: string }) {
  if (!count) return null;
  return (
    <section aria-labelledby={id} className="sgroup">
      <h2 id={id} className="section-title">{icon} {title} <span className="tag">{count}</span></h2>
      <ul className="panel rows" data-testid={testId}>{children}</ul>
    </section>
  );
}

function HitRow({ h, query, icon }: { h: SearchHit; query: string; icon: React.ReactNode }) {
  return (
    <li className="srow">
      <Link to={h.href} className="srow__main">
        <span className="srow__icon">{icon}</span>
        <span className="srow__text">
          <span className="srow__title"><Highlight text={h.title} query={query} /></span>
          <span className="srow__meta">{h.context}</span>
          {h.snippet && h.matchedIn === 'content' && <span className="srow__snippet"><Highlight text={h.snippet} query={query} /></span>}
        </span>
      </Link>
    </li>
  );
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get('q') ?? '';
  const [q, setQ] = useState(initial);
  const [debounced, setDebounced] = useState(initial);
  const { subjects, modules, sessions } = useLibrary();

  // La recherche est différée : elle ne se déclenche jamais pendant la frappe d'une note.
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(q); setParams(q ? { q } : {}, { replace: true }); }, 150);
    return () => clearTimeout(t);
  }, [q, setParams]);
  // Arrivée depuis la barre du haut : la requête change avec l'URL.
  useEffect(() => { const u = params.get('q') ?? ''; if (u !== q && u !== debounced) { setQ(u); setDebounced(u); } }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const [tHits, setTHits] = useState<TranscriptHit[]>([]);
  useEffect(() => {
    let live = true;
    if (!debounced.trim()) { setTHits([]); return; }
    captureManager.searchTranscripts(debounced).then((h) => live && setTHits(h)).catch(() => live && setTHits([]));
    return () => { live = false; };
  }, [debounced]);

  const hits: SearchHit[] = useMemo(() => searchService.search(debounced, { subjects, modules, sessions }), [debounced, subjects, modules, sessions]);
  const groups = useMemo(() => ({
    subjects: hits.filter((h) => h.kind === 'subject' || h.kind === 'module'),
    cms: hits.filter((h) => h.kind === 'session' && h.matchedIn === 'title'),
    notes: hits.filter((h) => h.kind === 'session' && h.matchedIn === 'content'),
  }), [hits]);
  const total = hits.length + tHits.length;

  return (
    <div className="page page--narrow page-enter">
      <header className="page__head"><div><h1>Recherche</h1><p className="page__sub">Matières, modules, titres de CM, notes et transcriptions.</p></div></header>
      <div className="searchbox searchbox--lg" role="search" style={{ position: 'relative', zIndex: 1 }}>
        <Search size={18} aria-hidden />
        <input aria-label="Recherche" placeholder="Ex. vices du consentement, 1128, Poussin…" value={q} autoFocus onChange={(e) => setQ(e.target.value)} data-testid="search-input" />
      </div>

      <div style={{ position: 'relative', zIndex: 1 }}>
        {debounced.trim() && <p className="muted" style={{ margin: '16px 0 8px' }} aria-live="polite">{total} résultat{total > 1 ? 's' : ''}</p>}
        {!debounced.trim() ? (
          <div className="panel empty" style={{ marginTop: 16 }}><strong>Tapez pour rechercher</strong>La recherche porte sur tout le contenu stocké sur cet appareil.</div>
        ) : total === 0 ? (
          <div className="panel empty"><strong>Aucun résultat</strong>Essayez avec d’autres mots.</div>
        ) : (
          <>
            <Group id="g-subj" testId="search-results-subjects" title="Matières" icon={<FolderTree size={15} />} count={groups.subjects.length}>
              {groups.subjects.map((h) => <HitRow key={`${h.kind}-${h.id}`} h={h} query={debounced} icon={h.kind === 'module' ? <Layers size={16} /> : <FolderTree size={16} />} />)}
            </Group>
            <Group id="g-cm" testId="search-results-cm" title="CM" icon={<FileText size={15} />} count={groups.cms.length}>
              {groups.cms.map((h) => <HitRow key={`${h.kind}-${h.id}`} h={h} query={debounced} icon={<FileText size={16} />} />)}
            </Group>
            <Group id="g-notes" testId="search-results" title="Notes" icon={<PenLine size={15} />} count={groups.notes.length}>
              {groups.notes.map((h) => <HitRow key={`${h.kind}-${h.id}`} h={h} query={debounced} icon={<PenLine size={16} />} />)}
            </Group>
            <Group id="g-tr" testId="transcript-results" title="Transcriptions" icon={<Mic size={15} />} count={tHits.length}>
              {tHits.map((h) => {
                const cm = sessions.find((x) => x.id === h.sessionId);
                if (!cm) return null;
                const subj = subjects.find((x) => x.id === cm.subjectId);
                const href = `${cm.status === 'completed' ? `/session/${cm.id}/recap` : `/session/${cm.id}`}?t=${Math.round(h.startMs)}`;
                return (
                  <li key={h.segmentId} className="srow">
                    <Link to={href} className="srow__main" data-testid="transcript-hit">
                      <span className="srow__icon"><Mic size={16} /></span>
                      <span className="srow__text">
                        <span className="srow__title"><Highlight text={h.snippet} query={debounced} /></span>
                        <span className="srow__meta">{sessionLabel(cm)}{subj ? ` · ${subj.name}` : ''} · à {formatHMS(h.startMs)}</span>
                      </span>
                      <span className="tag">Transcription</span>
                    </Link>
                  </li>
                );
              })}
            </Group>
          </>
        )}
      </div>
    </div>
  );
}
