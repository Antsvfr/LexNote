import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import { BookMarked, FileText, Layers, ListChecks, Pencil, Scale, Sparkles, HelpCircle, Layers3 } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useLookups } from '@/lib/useLookups';
import { formatDateLong, formatDuration } from '@/lib/dates';
import { sessionLabel } from '@/domain/session';
import { buildExtensions } from '@/features/editor/extensions';
import { SubjectDot } from '@/components/SubjectDot';
import { useState } from 'react';

const FUTURE = [
  { icon: Layers, label: 'Cours restructuré', hint: 'Notes, transcription et supports fusionnés en un plan clair' },
  { icon: FileText, label: 'Résumé', hint: 'L’essentiel du CM en quelques lignes' },
  { icon: ListChecks, label: 'Fiche de révision', hint: 'Notions à retenir, prêtes à réviser' },
  { icon: Scale, label: 'Articles', hint: 'Textes cités, avec provenance et statut' },
  { icon: BookMarked, label: 'Jurisprudences', hint: 'Arrêts cités, jamais inventés' },
  { icon: Layers3, label: 'Flashcards', hint: 'Cartes de révision générées depuis le cours' },
  { icon: HelpCircle, label: 'Questions', hint: 'Entraînement sur les notions du CM' },
];

export function RecapPage() {
  const { sessionId } = useParams();
  const session = useLibrary((s) => s.sessions.find((x) => x.id === sessionId));
  const ready = useLibrary((s) => s.ready);
  const loadNotes = useLibrary((s) => s.loadNotes);
  const { subjectById, moduleById } = useLookups();
  const [content, setContent] = useState<unknown>(undefined);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    loadNotes(sessionId).then((c) => { setContent(c); setLoaded(true); }).catch(() => setLoaded(true));
  }, [sessionId, loadNotes]);

  const editor = useEditor({ extensions: buildExtensions(), editable: false, content: undefined }, []);
  useEffect(() => {
    if (editor && loaded) editor.commands.setContent((content as object) ?? '', { emitUpdate: false });
  }, [editor, loaded, content]);

  if (ready && !session) return <Navigate to="/" replace />;
  if (!session) return null;
  const subject = subjectById.get(session.subjectId);
  const mod = moduleById.get(session.moduleId);

  return (
    <div className="page page-enter">
      <nav className="crumbs" aria-label="Fil d’Ariane">
        {subject && <><Link to={`/subjects/${subject.id}`}>{subject.name}</Link> ›</>} {mod && <Link to={`/modules/${mod.id}`}>{mod.name}</Link>}
      </nav>
      <header className="page__head">
        <div>
          <span className="eyebrow">{session.status === 'completed' ? 'CM terminé' : 'CM en cours'}</span>
          <h1 data-testid="recap-title">{sessionLabel(session)}</h1>
        </div>
        <Link className="btn" to={`/session/${session.id}`} onClick={() => { if (session.status === 'completed') void useLibrary.getState().setStatus(session.id, 'in_progress'); }}>
          <Pencil /> Reprendre l’édition
        </Link>
      </header>

      <dl className="figures figures--recap" aria-label="Récapitulatif">
        <div><dt>Matière</dt><dd className="figures__text">{subject && <SubjectDot color={subject.color} />} {subject?.name ?? '—'}</dd></div>
        <div><dt>Date</dt><dd className="figures__text">{formatDateLong(session.date)}</dd></div>
        <div><dt>Durée</dt><dd data-testid="recap-duration">{formatDuration(session.durationSec)}</dd></div>
        <div><dt>Mots</dt><dd data-testid="recap-words">{session.wordCount.toLocaleString('fr-FR')}</dd></div>
      </dl>

      <div className="recap-grid">
        <section aria-labelledby="notes-h">
          <h2 id="notes-h" className="section-title">Notes</h2>
          <div className="note-editor note-editor--readonly">
            {session.wordCount === 0 ? <p className="muted">Aucune note pour ce CM.</p> : <EditorContent editor={editor} />}
          </div>
        </section>

        <aside aria-labelledby="next-h">
          <h2 id="next-h" className="section-title">Étapes suivantes <span className="tag tag--soon">Bientôt</span></h2>
          <p className="muted" style={{ marginBottom: 8, fontSize: 13.5 }}>
            Ces outils ne sont pas encore disponibles. Aucun contenu n’est généré à votre place.
          </p>
          <ul className="future">
            {FUTURE.map(({ icon: Icon, label, hint }) => (
              <li key={label} aria-disabled="true">
                <Icon size={16} aria-hidden />
                <span><strong>{label}</strong><small>{hint}</small></span>
                <Sparkles size={13} aria-hidden className="future__lock" />
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
