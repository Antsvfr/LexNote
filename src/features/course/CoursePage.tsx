import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useEngine } from '@/store/engine';
import { useLookups } from '@/lib/useLookups';
import { sessionLabel } from '@/domain/session';
import { captureManager } from '@/services/capture/manager';
import { TranscriptPanel } from '@/features/capture/TranscriptPanel';
import { SubjectDot } from '@/components/SubjectDot';
import { NotesTab } from './NotesTab';
import { SourcesTab } from './SourcesTab';
import { ReconstructedTab } from './ReconstructedTab';

type Tab = 'notes' | 'transcript' | 'sources' | 'course';
const TABS: { id: Tab; label: string }[] = [{ id: 'notes', label: 'Notes' }, { id: 'transcript', label: 'Transcription' }, { id: 'sources', label: 'Sources' }, { id: 'course', label: 'Cours reconstruit' }];

/** « Cours » d'une séance : toutes les sources (notes, transcription, documents) et le cours reconstruit, au même endroit. */
export function CoursePage() {
  const { sessionId } = useParams();
  const [params, setParams] = useSearchParams();
  const session = useLibrary((s) => s.sessions.find((x) => x.id === sessionId));
  const ready = useLibrary((s) => s.ready);
  const { subjectById } = useLookups();
  const documents = useEngine((s) => s.documents);
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'course') as Tab;
  const t = params.get('t');
  const [opened, setOpened] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const focus = t !== null && Number.isFinite(Number(t)) ? Number(t) : null;
    void captureManager.open(sessionId, focus).then(() => setOpened(sessionId)).catch(() => setOpened(sessionId));
  }, [sessionId, t]);

  const docs = useMemo(() => documents.filter((d) => d.sessionId === sessionId), [documents, sessionId]);
  if (ready && !session) return <Navigate to="/" replace />;
  if (!session) return null;
  const subject = subjectById.get(session.subjectId);
  const select = (id: Tab) => { const next = new URLSearchParams(); next.set('tab', id); setParams(next, { replace: false }); };

  return (
    <div className="page page-enter coursepage" data-testid="course-page">
      <nav className="crumbs" aria-label="Fil d’Ariane">{subject && <><Link to={`/subjects/${subject.id}`}>{subject.name}</Link> ›</>}</nav>
      <header className="page__head">
        <div><span className="eyebrow">Cours</span><h1 data-testid="course-title">{sessionLabel(session)}</h1>
          <p className="page__sub">{subject && <SubjectDot color={subject.color} icon={subject.icon} />} {subject?.name} — vos sources, jamais modifiées, et le cours reconstruit à partir d’elles</p></div>
        <Link className="btn" to={`/session/${session.id}`}><Pencil /> Reprendre l’édition</Link>
      </header>
      <div className="tabs coursetabs" role="tablist" aria-label="Espace Cours">
        {TABS.map((x) => <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'is-on' : ''} onClick={() => select(x.id)} data-testid={`ctab-${x.id}`}>{x.label}{x.id === 'sources' && docs.length > 0 ? ` (${docs.length})` : ''}</button>)}
      </div>
      {tab === 'notes' && <NotesTab sessionId={session.id} quote={params.get('q')} />}
      {tab === 'transcript' && (opened === session.id ? <div data-testid="course-transcript"><TranscriptPanel sessionId={session.id} variant="review" /></div> : <p className="muted">Chargement…</p>)}
      {tab === 'sources' && <SourcesTab session={session} notesWords={session.wordCount} docId={params.get('doc')} unit={params.get('unit') ? Number(params.get('unit')) : null} quote={params.get('q')} />}
      {tab === 'course' && <ReconstructedTab session={session} documents={docs} />}
    </div>
  );
}
