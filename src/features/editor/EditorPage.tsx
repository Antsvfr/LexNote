import { typeLabel } from '@/domain/sessionType';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import { Command, Focus, Layers, Minimize2, CheckCheck } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { useEditorBridge } from '@/store/editorBridge';
import { useLookups } from '@/lib/useLookups';
import { debounce } from '@/lib/debounce';
import { LogoMark } from '@/components/Logo';
import { buildExtensions } from './extensions';
import { useAutosave } from './useAutosave';
import { useSaveStatus } from './saveStatus';
import { ActionBar, FormatBar } from './Toolbar';
import { SaveIndicator } from './SaveIndicator';
import { SyncIndicator } from '@/components/SyncIndicator';
import { SessionTimer } from './SessionTimer';
import { SidePanel } from './AssistantPanel';
import { RecControls, MarkerQuickChips, useStartCapture } from '@/features/capture/RecControls';
import { RecPopover } from '@/features/capture/RecPopover';
import { LiveTimeline } from '@/features/capture/Timeline';
import { useCaptureShortcuts } from '@/features/capture/useCaptureShortcuts';
import { useNoteAnchors } from '@/features/capture/useNoteAnchors';
import { useCapture } from '@/store/capture';
import { captureManager } from '@/services/capture/manager';
import { confirm } from '@/components/confirm';
import { modKeyLabel } from './commands';
import type { CourseSession } from '@/domain/types';

export function EditorPage() {
  const { sessionId } = useParams();
  const session = useLibrary((s) => s.sessions.find((x) => x.id === sessionId));
  const ready = useLibrary((s) => s.ready);
  const loadNotes = useLibrary((s) => s.loadNotes);
  const [initial, setInitial] = useState<{ id: string; content: unknown } | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    setInitial(null);
    loadNotes(sessionId)
      .then((content) => live && setInitial({ id: sessionId, content }))
      .catch(() => live && setLoadError(true));
    return () => { live = false; };
  }, [sessionId, loadNotes]);

  if (ready && !session) return <Navigate to="/" replace />;
  if (loadError) return <div className="page" role="alert"><h1>Impossible de charger ce CM</h1><p className="page__sub">Le stockage local est inaccessible.</p></div>;
  if (!session || !initial || initial.id !== sessionId) return <div className="editor-loading" aria-busy="true">Chargement du CM…</div>;
  // `key` : un autre CM = un éditeur neuf (pas d'état résiduel).
  return <Workspace key={session.id} sessionId={session.id} initialContent={initial.content} />;
}

function Workspace({ sessionId, initialContent }: { sessionId: string; initialContent: unknown }) {
  const navigate = useNavigate();
  // Snapshot du CM à l'ouverture : la frappe ne re-rend pas ce composant.
  const session = useLibrary((s) => s.sessions.find((x) => x.id === sessionId)) as CourseSession;
  const { subjectById, moduleById } = useLookups();
  const { focus, setFocus, assistantOpen, toggleAssistant, setPalette } = useUI();
  const setBridge = useEditorBridge((s) => s.setEditor);
  const secondsRef = useRef(session.durationSec);
  const [params] = useSearchParams();
  const tParam = params.get('t');
  const captureStatus = useCapture((s) => s.status);
  const wasRecording = useRef(false);

  // La capture est un système indépendant : son chargement ne bloque ni n'influence l'éditeur.
  useEffect(() => {
    const focusMs = tParam !== null && Number.isFinite(Number(tParam)) ? Number(tParam) : null;
    void captureManager.open(sessionId, focusMs).catch((e) => console.warn('[LexNote] capture non chargée', e));
    if (focusMs !== null || params.get('panel') === 'transcript') { useUI.getState().setSideTab('transcript'); if (!useUI.getState().assistantOpen) useUI.getState().toggleAssistant(); }
  }, [sessionId, tParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // À l'activation de la transcription, le panneau s'ouvre sur l'onglet Transcription.
  useEffect(() => {
    if (captureStatus === 'RECORDING' && !wasRecording.current) useUI.getState().openTranscript();
    wasRecording.current = captureStatus === 'RECORDING';
  }, [captureStatus]);

  const extensions = useMemo(() => buildExtensions({ placeholder: `Commencez à prendre vos notes…  (${modKeyLabel}K pour les commandes)` }), []);
  const editor = useEditor({
    extensions,
    content: (initialContent as object | undefined) ?? undefined,
    autofocus: 'end',
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'note-prose', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Notes du CM', spellcheck: 'true', lang: 'fr' },
    },
  });

  const { flushNow } = useAutosave(editor, sessionId, () => secondsRef.current);
  useNoteAnchors(editor, sessionId);
  const { request: requestRecord, dialog: consentDialog } = useStartCapture(sessionId);
  useCaptureShortcuts(sessionId, requestRecord);

  useEffect(() => {
    setBridge(editor);
    return () => setBridge(null);
  }, [editor, setBridge]);

  // Mode Focus : Échap pour quitter ; remis à zéro en quittant l'éditeur.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && useUI.getState().focus && !useUI.getState().paletteOpen) setFocus(false); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); setFocus(false); };
  }, [setFocus]);

  const subject = subjectById.get(session.subjectId);
  const mod = (session.moduleId ? moduleById.get(session.moduleId) : undefined);
  useEffect(() => {
    document.title = `${session.title || typeLabel(session.type)} — LexNote`;
    return () => { document.title = 'LexNote'; };
  }, [session.title]);

  async function finish() {
    try {
      // Notes d'abord : elles sont enregistrées avant toute autre opération.
      await flushNow();
      const cap = useCapture.getState().status;
      if (cap !== 'INACTIVE' && cap !== 'COMPLETED') {
        const ok = await confirm({
          title: 'Terminer la transcription ?',
          message: cap === 'PAUSED' || cap === 'ERROR'
            ? 'La transcription de ce CM n’est pas terminée. Elle sera clôturée avec le CM ; tout ce qui a été capturé est conservé.'
            : 'Un enregistrement est en cours. Il va être arrêté proprement (finalisation de la transcription) avant de terminer le CM.',
          confirmLabel: 'Arrêter et terminer le CM',
        });
        if (!ok) return;
        await captureManager.stop(sessionId); // ne lève jamais : une panne ici ne doit pas empêcher de terminer
      }
      const st = useLibrary.getState();
      await st.setDuration(sessionId, secondsRef.current);
      await st.setStatus(sessionId, 'completed');
      navigate(`/session/${sessionId}/recap`);
    } catch { /* toast déjà affiché : on reste sur l'éditeur pour ne rien perdre */ }
  }

  if (!editor) return <div className="editor-loading">Chargement…</div>;

  return (
    <div className={`workspace${focus ? ' is-focus' : ''}${assistantOpen && !focus ? ' has-panel' : ''}`}>
      <header className="topbar">
        <Link to={session.moduleId ? `/modules/${session.moduleId}` : `/subjects/${session.subjectId}`} className="topbar__brand" aria-label="Quitter l’éditeur" title="Quitter l’éditeur">
          <LogoMark className="brand__mark" />
          <span className="topbar__name">LexNote</span>
        </Link>

        <nav className="topbar__crumbs" aria-label="Emplacement">
          {subject && <Link to={`/subjects/${subject.id}`}>{subject.name}</Link>}
          {mod && <><span aria-hidden>/</span><Link to={`/modules/${mod.id}`}>{mod.name}</Link></>}
          <span className="topbar__sep" aria-hidden />
        </nav>

        <TitleField sessionId={sessionId} />

        <div className="topbar__right">
          <SessionTimer sessionId={sessionId} initialSeconds={session.durationSec} secondsRef={secondsRef} />
          <SaveIndicator />
          <SyncIndicator compact />
          <RecControls sessionId={sessionId} />
          <button className="btn btn--ghost btn--icon btn--sm" onClick={() => setPalette(true)} aria-label="Palette de commandes" title={`Commandes (${modKeyLabel}K)`}><Command /></button>
          <Link className="btn btn--sm topbar__btn" to={`/session/${sessionId}/course`} data-testid="editor-open-course" aria-label="Ouvrir le Cours (sources et cours reconstruit)" title="Cours : sources et cours reconstruit"><Layers /> <span className="lbl">Cours</span></Link>
          <button className="btn btn--sm topbar__btn" onClick={() => setFocus(!focus)} aria-pressed={focus} data-testid="focus-toggle" aria-label={focus ? "Quitter le mode Focus" : "Mode Focus"} title="Mode Focus (Échap pour quitter)">
            {focus ? <><Minimize2 /> <span className="lbl">Quitter Focus</span></> : <><Focus /> <span className="lbl">Focus</span></>}
          </button>
          <button className="btn btn--sm btn--primary topbar__btn" onClick={finish} data-testid="finish-cm" aria-label="Terminer la séance"><CheckCheck /> <span className="lbl">Terminer</span></button>
        </div>
      </header>

      <div className="toolrows">
        <ActionBar editor={editor} assistantOpen={assistantOpen} onToggleAssistant={toggleAssistant} />
        {!focus && <FormatBar editor={editor} />}
        {!focus && <div className="timelinebar"><LiveTimeline size="slim" /></div>}
      </div>

      {!focus && <div className="chips-float"><MarkerQuickChips sessionId={sessionId} /></div>}
      {focus && <RecPopover sessionId={sessionId} />}
      {consentDialog}

      <div className="workspace__body">
        <div className="note-scroll" onClick={(e) => { if (e.target === e.currentTarget) editor.commands.focus('end'); }}>
          <EditorContent editor={editor} className="note-editor" data-testid="editor" />
        </div>
        {assistantOpen && !focus && <SidePanel editor={editor} sessionId={sessionId} />}
      </div>
    </div>
  );
}

/** Titre du CM : édition directe, sauvegarde différée, indicateur partagé. */
function TitleField({ sessionId }: { sessionId: string }) {
  const session = useLibrary((s) => s.sessions.find((x) => x.id === sessionId)) as CourseSession;
  const [value, setValue] = useState(session.title);
  const prefix = session.number != null ? `${typeLabel(session.type)} ${String(session.number).padStart(2, '0')} —` : typeLabel(session.type);

  const save = useMemo(
    () => debounce((title: string) => {
      useSaveStatus.getState().set('saving');
      useLibrary.getState().updateSession(sessionId, { title })
        .then(() => useSaveStatus.getState().set('saved'))
        .catch(() => useSaveStatus.getState().set('error'));
    }, 400, 3000),
    [sessionId],
  );
  useEffect(() => () => save.flush(), [save]);

  return (
    <div className="titlefield">
      {prefix && <span className="titlefield__num">{prefix}</span>}
      <input
        className="titlefield__input"
        value={value}
        placeholder="Titre de la séance"
        aria-label="Titre de la séance"
        data-testid="title-input"
        onChange={(e) => { setValue(e.target.value); save(e.target.value); }}
        onBlur={() => save.flush()}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </div>
  );
}
