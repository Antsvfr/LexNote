import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import { Layers, Pencil, Plus } from 'lucide-react';
import { useArtifacts } from '@/store/artifacts';
import { useUI } from '@/store/ui';
import { ARTIFACT_LABELS } from '@/domain/study';
import { useEngine } from '@/store/engine';
import { latestCourse, treeOf } from '@/services/study/engine';
import { suggestSupports } from '@/services/study/generators';
import { useLibrary } from '@/store/library';
import { useLookups } from '@/lib/useLookups';
import { formatDateLong, formatDuration } from '@/lib/dates';
import { sessionLabel } from '@/domain/session';
import { buildExtensions } from '@/features/editor/extensions';
import { SubjectDot } from '@/components/SubjectDot';
import { useCapture } from '@/store/capture';
import { captureManager } from '@/services/capture/manager';
import { formatHMS, segmentsWordCount, type NoteAnchor } from '@/domain/capture';
import { TranscriptPanel } from '@/features/capture/TranscriptPanel';
import { LiveTimeline } from '@/features/capture/Timeline';
import { MiniPlayer } from '@/features/capture/MiniPlayer';
import type { SelectionInfo } from '@/features/capture/TranscriptTools';
import { TranscriptActions } from '@/features/transcript/TranscriptActions';
import { ActionDialog, type ActionRequest } from '@/features/transcript/ActionDialog';
import { FlashcardDialog, type FlashcardRequest } from '@/features/transcript/FlashcardDialog';
import { actionById } from '@/services/transcript/actions';
import { buildTranscriptText } from '@/services/transcript/source';
import { sourceFromSegments } from '@/services/transcript/run';
import { ARTIFACT_ICONS } from '@/features/study/artifactMeta';
import { formatRelative } from '@/lib/dates';
import { typeInfo } from '@/domain/sessionType';

export function RecapPage() {
  const { sessionId } = useParams();
  const session = useLibrary((s) => s.sessions.find((x) => x.id === sessionId));
  const ready = useLibrary((s) => s.ready);
  const loadNotes = useLibrary((s) => s.loadNotes);
  const { subjectById, moduleById } = useLookups();
  const [content, setContent] = useState<unknown>(undefined);
  const allArtifacts = useArtifacts((s) => s.items);
  const mine = useMemo(() => allArtifacts.filter((a) => a.sourceSessionIds.includes(sessionId ?? '')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [allArtifacts, sessionId]);
  const courses = useEngine((s) => s.courses);
  const suggestions = useMemo(() => { const c = session ? latestCourse(courses, session.id) : undefined; return c ? suggestSupports(treeOf(c)) : []; }, [session, courses]);
  const [loaded, setLoaded] = useState(false);
  const [params] = useSearchParams();
  const tParam = params.get('t');
  const [tab, setTab] = useState<'notes' | 'transcript' | 'timeline'>(tParam !== null ? 'transcript' : 'notes');
  const segments = useCapture((c) => c.segments);
  const markers = useCapture((c) => c.markers);
  const interruptions = useCapture((c) => c.interruptions);
  const chunks = useCapture((c) => c.chunks);
  const captureLoaded = useCapture((c) => c.loaded);
  const [anchors, setAnchors] = useState<NoteAnchor[]>([]);
  const [seek, setSeek] = useState<{ ms: number | null; nonce: number }>({ ms: null, nonce: 0 });
  const [selReq, setSelReq] = useState<ActionRequest | null>(null);
  const [cardReq, setCardReq] = useState<FlashcardRequest | null>(null);
  const viewSessionId = useCapture((c) => c.viewSessionId);
  // Transcription de CETTE séance (les segments du magasin de capture appartiennent à la séance affichée).
  const mySegments = viewSessionId === sessionId ? segments : [];
  const source = useMemo(() => sourceFromSegments(mySegments), [mySegments]);

  useEffect(() => {
    if (!sessionId) return;
    const focusMs = tParam !== null && Number.isFinite(Number(tParam)) ? Number(tParam) : null;
    void captureManager.open(sessionId, focusMs).then(() => captureManager.getStorage().listAnchors(sessionId)).then(setAnchors).catch(() => undefined);
  }, [sessionId, tParam]);

  useEffect(() => {
    if (!sessionId) return;
    loadNotes(sessionId).then((c) => { setContent(c); setLoaded(true); }).catch(() => setLoaded(true));
  }, [sessionId, loadNotes]);

  const editor = useEditor({ extensions: buildExtensions(), editable: false, content: undefined }, []);
  useEffect(() => {
    if (editor && loaded) editor.commands.setContent((content as object) ?? '', { emitUpdate: false });
  }, [editor, loaded, content]);

  const audioMs = useMemo(() => {
    const live = chunks.filter((c) => c.status === 'stored').reduce((n, c) => n + c.durationMs, 0);
    return live || (session?.captureSummary?.audioMs ?? 0);
  }, [chunks, session?.captureSummary]);
  const tWords = useMemo(() => (mySegments.length ? segmentsWordCount(mySegments) : session?.captureSummary?.transcriptWords ?? 0), [mySegments, session?.captureSummary]);

  if (ready && !session) return <Navigate to="/" replace />;
  if (!session) return null;
  const subject = subjectById.get(session.subjectId);
  const mod = (session.moduleId ? moduleById.get(session.moduleId) : undefined);
  const onSelection = (actionId: string, sel: SelectionInfo) => {
    const t = buildTranscriptText(mySegments, { range: sel.range });
    if (actionId === 'flashcard') { setCardReq({ sessionId: session.id, text: sel.text, range: sel.range, version: t.version }); return; }
    const action = actionById(actionId);
    if (action) setSelReq({ action, sessionId: session.id, transcript: sourceFromSegments(mySegments, sel.range) });
  };

  return (
    <div className="page page-enter">
      <nav className="crumbs" aria-label="Fil d’Ariane">
        {subject && <><Link to={`/subjects/${subject.id}`}>{subject.name}</Link> ›</>} {mod && <Link to={`/modules/${mod.id}`}>{mod.name}</Link>}
      </nav>
      <header className="page__head recap-head">
        <div>
          <span className="eyebrow">{session.status === 'completed' ? 'Séance terminée' : 'Séance en cours'} · {typeInfo(session.type).long}</span>
          <h1 data-testid="recap-title">{sessionLabel(session)}</h1>
          <p className="recap-meta">{subject && <SubjectDot color={subject.color} />} {subject?.name ?? '—'} · {formatDateLong(session.date)}</p>
        </div>
        <div className="row-actions">
          <Link className="btn" to={`/session/${session.id}`} onClick={() => { if (session.status === 'completed') void useLibrary.getState().setStatus(session.id, 'in_progress'); }} data-testid="recap-resume">
            <Pencil /> Reprendre l’édition
          </Link>
          <Link className="btn btn--primary" to={`/session/${session.id}/course`} data-testid="open-course"><Layers /> Ouvrir le cours</Link>
        </div>
      </header>

      <dl className="figures figures--recap" aria-label="Récapitulatif">
        <div><dt>Séance</dt><dd data-testid="recap-duration">{formatDuration(session.durationSec)}</dd></div>
        <div><dt>Audio</dt><dd data-testid="recap-audio">{audioMs > 0 ? formatDuration(audioMs / 1000) : '—'}</dd></div>
        <div><dt>Transcription</dt><dd data-testid="recap-twords">{tWords > 0 ? tWords.toLocaleString('fr-FR') : '—'}{tWords > 0 && <small> mots</small>}</dd></div>
        <div><dt>Notes</dt><dd data-testid="recap-words">{session.wordCount.toLocaleString('fr-FR')}<small> mots</small></dd></div>
        <div><dt>Marqueurs</dt><dd data-testid="recap-markers">{markers.length}</dd></div>
        <div><dt>Interruptions</dt><dd data-testid="recap-interruptions">{interruptions.length}</dd></div>
      </dl>

      {captureLoaded && <TranscriptActions sessionId={session.id} source={source} onOpenTranscript={() => setTab('transcript')} />}

      <section aria-label="Contenu de la séance" className="recap-content">
        <div className="seg recap-tabs" role="tablist">
          {([['notes', 'Notes'], ['transcript', 'Transcription'], ['timeline', 'Timeline']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)} data-testid={`recap-tab-${id}`}>{label}</button>
          ))}
        </div>

        {tab === 'notes' && (
          <div className="note-editor note-editor--readonly">
            {session.wordCount === 0 ? <p className="muted">Aucune note pour cette séance.</p> : <EditorContent editor={editor} />}
          </div>
        )}

        {tab === 'transcript' && (
          <div className="recap-transcript">
            {captureLoaded && segments.length === 0 && !chunks.length
              ? <p className="muted">Cette séance n’a pas de transcription.</p>
              : <TranscriptPanel sessionId={session.id} variant="review" sessionTitle={sessionLabel(session)} onSelectionAction={onSelection} />}
          </div>
        )}

        {tab === 'timeline' && (
          <div className="recap-timeline">
            <LiveTimeline size="full" withAnchors={anchors} onSeek={(ms) => setSeek((p) => ({ ms, nonce: p.nonce + 1 }))} />
            {markers.length + interruptions.length === 0 && <p className="muted">Aucun marqueur ni interruption.</p>}
            {markers.length > 0 && (
              <>
                <h3 className="section-title" style={{ marginTop: 20 }}>Marqueurs</h3>
                <ul className="list">{markers.map((m) => (
                  <li key={m.id} className="srow"><button className="srow__main" onClick={() => { setTab('transcript'); useCapture.setState({ focusMs: m.atMs }); }}>
                    <span className="srow__icon">⭐</span><span className="srow__text"><span className="srow__title">{formatHMS(m.atMs)}</span>
                      <span className="srow__meta">{m.reasons.join(' · ') || 'sans motif'}{m.note ? ` — ${m.note}` : ''}</span></span></button></li>
                ))}</ul>
              </>
            )}
            {interruptions.length > 0 && (
              <>
                <h3 className="section-title" style={{ marginTop: 20 }}>Interruptions</h3>
                <ul className="list">{interruptions.map((i) => (
                  <li key={i.id} className="srow"><div className="srow__main"><span className="srow__icon">⚠️</span><span className="srow__text">
                    <span className="srow__title">{formatHMS(i.atMs)} · {i.kind}</span><span className="srow__meta">{i.message}{i.resolvedAtMs !== undefined ? ' — reprise' : ''}</span></span></div></li>
                ))}</ul>
              </>
            )}
            {chunks.some((c) => c.status === 'stored') && <MiniPlayer sessionId={session.id} startAtMs={seek.ms} nonce={seek.nonce} chunkCount={chunks.length} />}
          </div>
        )}
      </section>

      <section className="recap-supports" aria-labelledby="supports-h">
        <header className="recap-supports__head">
          <div>
            <h2 id="supports-h" className="section-title">Supports générés</h2>
            <p className="muted">Résumés, traductions, fiches, flashcards, quiz… chacun garde la trace de sa source.</p>
          </div>
          <button className="btn" onClick={() => useUI.getState().openSupportDialog({ sessionId: session.id })} data-testid="recap-create-support"><Plus /> Créer un support</button>
        </header>
        {suggestions.length > 0 && <ul className="supporthints muted" data-testid="support-hints">{suggestions.map((x) => <li key={x.type + x.text}>{ARTIFACT_LABELS[x.type]} — {x.text}</li>)}</ul>}
        {mine.length === 0
          ? <p className="muted recap-supports__empty" data-testid="session-supports-empty">Aucun support pour cette séance. Utilisez « Exploiter la transcription » ou « Créer un support ».</p>
          : (
            <ul className="sgrid" data-testid="session-supports">
              {mine.map((a) => { const Icon = ARTIFACT_ICONS[a.type]; return (
                <li key={a.id}>
                  <Link to={`/supports/${a.id}`} className="scard" data-testid="session-support">
                    <span className="scard__icon"><Icon size={18} aria-hidden /></span>
                    <span className="scard__txt"><strong>{a.title}</strong><small>{ARTIFACT_LABELS[a.type]}{a.generator && !a.generator.local ? ' · IA' : ''}{a.userEdited ? ' · modifié' : ''} · {formatRelative(a.updatedAt)}</small></span>
                  </Link>
                </li>
              ); })}
            </ul>
          )}
      </section>
      <ActionDialog request={selReq} onClose={() => setSelReq(null)} />
      <FlashcardDialog request={cardReq} onClose={() => setCardReq(null)} />
    </div>
  );
}
