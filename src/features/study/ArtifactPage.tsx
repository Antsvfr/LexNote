import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Copy, Download, RefreshCw, Printer, Trash2, Undo2, TriangleAlert } from 'lucide-react';
import { useArtifacts } from '@/store/artifacts';
import { useEngine } from '@/store/engine';
import { useLibrary } from '@/store/library';
import { toast } from '@/store/toasts';
import { confirm } from '@/components/confirm';
import { Menu } from '@/components/Menu';
import { debounce } from '@/lib/debounce';
import { formatRelative } from '@/lib/dates';
import { ARTIFACT_LABELS, DIAGRAM_LABELS, type ArtifactContent, type DiagramContent, type FlashcardsContent, type MethodContent, type MindMapContent, type QuizContent, type SheetContent, type StudyArtifact, type TableContent, type TimelineContent } from '@/domain/study';
import { generateDraft, isStale, latestCourse } from '@/services/study/engine';
import { diagramToSvg, downloadBlob, fileSafe, mindMapToSvg, svgToPngBlob, toMarkdown } from '@/services/study/export';
import { SheetView } from './views/SheetView';
import { MindMapView } from './views/MindMapView';
import { DiagramView } from './views/DiagramView';
import { TableView } from './views/TableView';
import { FlashcardsView, MethodView, QuizView, TimelineView } from './views/ListViews';
import { SessionContext } from './views/Sources';

export function ArtifactPage() {
  const { artifactId } = useParams();
  const navigate = useNavigate();
  const { items, ready, edit, rename, restoreGenerated, replaceGenerated, duplicate, remove } = useArtifacts();
  const { sessions } = useLibrary();
  const courses = useEngine((x) => x.courses);
  const art = items.find((x) => x.id === artifactId);
  const [draft, setDraft] = useState<ArtifactContent | null>(null);
  const [showSources, setShowSources] = useState(true);
  const [title, setTitle] = useState('');
  const saver = useRef<ReturnType<typeof debounce<[string, ArtifactContent]>> | null>(null);
  const session = art ? sessions.find((s) => s.id === art.sourceSessionIds[0]) : undefined;

  useEffect(() => { saver.current = debounce((id: string, c: ArtifactContent) => { void edit(id, c); }, 500, 3000); return () => saver.current?.flush(); }, [edit]);
  // Recharge la version affichée quand on change de support, ou quand le contenu stocké change ailleurs (restauration, mise à jour, synchro).
  useEffect(() => { if (art && !saver.current?.pending()) { setDraft(art.content); setTitle(art.title); setShowSources(art.settings.showSources !== false); } }, [art?.id, art?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const latest = useMemo(() => (art ? latestCourse(courses, art.sourceSessionIds[0]!) : undefined), [art, courses]);
  const stale = useMemo(() => (art ? isStale(art, latest) : false), [art, latest]);
  if (ready && !art) return <Navigate to="/supports" replace />;
  if (!art || !draft) return null;

  const change = (c: ArtifactContent) => { setDraft(c); saver.current?.(art.id, c); };
  const fresh = (a: StudyArtifact) => {
    if (!latest) throw new Error('Le cours reconstruit de cette séance n’est plus disponible : reconstruisez-le dans l’espace « Cours ».');
    return generateDraft(latest, { type: a.type, scope: a.scope?.sectionId ? { sectionId: a.scope.sectionId } : undefined, settings: a.settings });
  };
  /** Régénère depuis la dernière version du cours. Un support modifié à la main n'est JAMAIS écrasé : on crée une copie. */
  async function regenerate() {
    try {
      const d = fresh(art!);
      if (!art!.userEdited) { await replaceGenerated(art!.id, d); toast.success('Support régénéré depuis le cours.'); return; }
      const copy = await duplicate(art!.id, `${art!.title} (régénéré)`);
      if (copy) { await replaceGenerated(copy.id, { ...d, title: `${art!.title} (régénéré)` }); toast.success('Une copie régénérée a été créée ; votre version modifiée est conservée.'); navigate(`/supports/${copy.id}`); }
    } catch (e) { toast.error((e as Error).message); }
  }
  async function replaceAnyway() {
    const ok = await confirm({ title: 'Remplacer vos modifications ?', message: 'Le support sera régénéré depuis le cours actuel. Vos modifications manuelles seront perdues (vous pouvez d’abord dupliquer).', confirmLabel: 'Remplacer', danger: true });
    if (!ok) return;
    try { saver.current?.cancel(); await replaceGenerated(art!.id, fresh(art!)); toast.success('Support régénéré.'); } catch (e) { toast.error((e as Error).message); }
  }
  const current: StudyArtifact = { ...art, content: draft };
  const base = fileSafe(art.title);
  const svg = art.type === 'MIND_MAP' ? mindMapToSvg(draft as MindMapContent, art.title) : art.type === 'DIAGRAM' ? diagramToSvg(draft as DiagramContent, art.title) : null;

  return (
    <SessionContext.Provider value={art.sourceSessionIds[0] ?? ''}>
    <div className="page page-enter artifact" data-testid="artifact-page">
      <nav className="crumbs no-print" aria-label="Fil d’Ariane"><Link to={session ? `/session/${session.id}/review` : '/supports'}>Réviser</Link> › <Link to="/supports">Mes supports</Link> ›</nav>
      <header className="page__head no-print">
        <div style={{ flex: 1, minWidth: 0 }}>
          <input className="artifact__title" aria-label="Titre du support" value={title} data-testid="artifact-title"
            onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== art.title && void rename(art.id, title)} />
          <p className="page__sub">
            <span className="tag">{ARTIFACT_LABELS[art.type]}{art.type === 'DIAGRAM' ? ` · ${DIAGRAM_LABELS[(draft as DiagramContent).type]}` : ''}</span>{' '}
            {art.userEdited ? <span className="tag tag--live" data-testid="artifact-edited">Modifié par vous</span> : <span className="tag" data-testid="artifact-generated">Version générée</span>}{' '}
            {session ? <>depuis <Link to={`/session/${session.id}`} className="link">{session.title || 'la séance'}</Link>{art.scope?.sectionTitle ? ` › ${art.scope.sectionTitle}` : ''}</> : 'séance source supprimée'} · généré à partir du cours v{art.courseVersion} · modifié {formatRelative(art.updatedAt)}
          </p>
        </div>
        <div className="row-actions">
          <label className="checks"><input type="checkbox" checked={showSources} onChange={(e) => setShowSources(e.target.checked)} /> Sources</label>
          <Menu trigger={(p) => <button className="btn" {...p} data-testid="export-menu"><Download /> Exporter</button>}>
            {(close) => (
              <>
                <button className="menu__item" role="menuitem" onClick={() => { close(); downloadBlob(`${base}.md`, new Blob([toMarkdown(current, { sources: showSources })], { type: 'text/markdown;charset=utf-8' })); }} data-testid="export-md">Markdown (.md)</button>
                {svg && <button className="menu__item" role="menuitem" onClick={() => { close(); downloadBlob(`${base}.svg`, new Blob([svg], { type: 'image/svg+xml' })); }} data-testid="export-svg">Image vectorielle (.svg)</button>}
                {svg && <button className="menu__item" role="menuitem" onClick={() => { close(); void svgToPngBlob(svg, 3).then((b) => downloadBlob(`${base}.png`, b)).catch((e: Error) => toast.error(e.message)); }} data-testid="export-png">Image haute résolution (.png)</button>}
                <button className="menu__item" role="menuitem" onClick={() => { close(); setTimeout(() => window.print(), 50); }} data-testid="export-print"><Printer />Imprimer / PDF</button>
              </>
            )}
          </Menu>
          <button className="btn" onClick={() => void regenerate()} disabled={!latest} aria-label="Régénérer" title="Régénérer depuis le cours" data-testid="artifact-regenerate"><RefreshCw /></button>
          <button className="btn" onClick={async () => { const c = await duplicate(art.id); if (c) { toast.success('Support dupliqué.'); navigate(`/supports/${c.id}`); } }} aria-label="Dupliquer"><Copy /></button>
          <button className="btn btn--danger" aria-label="Supprimer" data-testid="artifact-delete" onClick={async () => { if (await confirm({ title: 'Supprimer ce support ?', message: 'Votre cours n’est pas modifié.', confirmLabel: 'Supprimer', danger: true })) { await remove(art.id); navigate('/supports'); } }}><Trash2 /></button>
        </div>
      </header>

      {stale && (
        <div className="banner banner--warn no-print" role="status" data-testid="stale-banner">
          <TriangleAlert size={18} aria-hidden /><span><strong>Le cours a été mis à jour (v{latest?.courseVersion}).</strong> {art.userEdited ? 'Vous avez modifié ce support : il ne sera pas écrasé.' : ''}</span><span className="spacer" />
          <button className="btn btn--sm btn--primary" onClick={() => void regenerate()} data-testid="stale-update"><RefreshCw /> {art.userEdited ? 'Créer une copie mise à jour' : 'Mettre à jour ce support'}</button>
          {art.userEdited && <button className="btn btn--sm" onClick={replaceAnyway}>Remplacer par une nouvelle version</button>}
        </div>
      )}
      {art.userEdited && art.generatedContent && (
        <div className="no-print" style={{ marginBottom: 10 }}>
          <button className="btn btn--sm btn--ghost" data-testid="restore-generated" onClick={async () => { if (await confirm({ title: 'Revenir à la version générée ?', message: 'Vos modifications seront perdues.', confirmLabel: 'Revenir', danger: true })) { saver.current?.cancel(); await restoreGenerated(art.id); } }}><Undo2 /> Revenir à la version générée</button>
        </div>
      )}

      <p className="artifact__prov muted no-print" data-testid="artifact-provenance">
        Généré à partir du cours — version {art.courseVersion}{stale ? ' (une version plus récente existe)' : ''} · {art.provenance.sources.map((x) => x.label).join(' · ') || 'sources du cours'}
      </p>

      <div className="print-area">
        <h1 className="print-only">{art.title}</h1>
        {art.type === 'COURSE_SHEET' && <SheetView content={draft as SheetContent} onChange={change} showSources={showSources} />}
        {art.type === 'MIND_MAP' && <MindMapView content={draft as MindMapContent} onChange={change} showSources={showSources} />}
        {art.type === 'DIAGRAM' && <DiagramView content={draft as DiagramContent} onChange={change} showSources={showSources} />}
        {art.type === 'COMPARISON_TABLE' && <TableView content={draft as TableContent} onChange={change} showSources={showSources} />}
        {art.type === 'TIMELINE' && <TimelineView content={draft as TimelineContent} onChange={change} showSources={showSources} />}
        {art.type === 'METHOD' && <MethodView content={draft as MethodContent} onChange={change} showSources={showSources} />}
        {art.type === 'FLASHCARDS' && <FlashcardsView content={draft as FlashcardsContent} onChange={change} showSources={showSources} />}
        {art.type === 'QUIZ' && <QuizView content={draft as QuizContent} onChange={change} showSources={showSources} />}
        {svg && <div className="print-only print-svg" dangerouslySetInnerHTML={{ __html: svg }} />}
        <p className="print-only print-foot">Support généré par LexNote à partir du cours reconstruit — à vérifier avant tout usage juridique.</p>
      </div>
    </div>
    </SessionContext.Provider>
  );
}
