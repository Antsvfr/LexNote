import { useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { BarChart3, BookOpen, Brain, CalendarClock, FileText, HelpCircle, ListOrdered, Network, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useArtifacts } from '@/store/artifacts';
import { useEngine } from '@/store/engine';
import { useUI } from '@/store/ui';
import { useLookups } from '@/lib/useLookups';
import { SessionSpaces } from '@/components/SessionSpaces';
import { SubjectDot } from '@/components/SubjectDot';
import { sessionLabel } from '@/domain/session';
import { formatRelative } from '@/lib/dates';
import { ARTIFACT_LABELS, ARTIFACT_TYPES, type ArtifactType } from '@/domain/study';
import { isStale, latestCourse, treeOf } from '@/services/study/engine';
import { suggestSupports } from '@/services/study/generators';

const ICONS: Record<ArtifactType, LucideIcon> = { COURSE_SHEET: FileText, MIND_MAP: Brain, DIAGRAM: Network, COMPARISON_TABLE: BarChart3, TIMELINE: CalendarClock, METHOD: ListOrdered, FLASHCARDS: BookOpen, QUIZ: HelpCircle };
const CREATE: Record<ArtifactType, string> = {
  COURSE_SHEET: 'Créer une fiche', MIND_MAP: 'Créer une carte mentale', DIAGRAM: 'Créer un schéma', COMPARISON_TABLE: 'Créer un tableau',
  TIMELINE: 'Créer une chronologie', METHOD: 'Créer une méthode', FLASHCARDS: 'Créer des flashcards', QUIZ: 'Créer un quiz',
};
const PLURAL: Record<ArtifactType, string> = { COURSE_SHEET: 'Fiches', MIND_MAP: 'Cartes mentales', DIAGRAM: 'Schémas', COMPARISON_TABLE: 'Tableaux comparatifs', TIMELINE: 'Chronologies', METHOD: 'Méthodes', FLASHCARDS: 'Flashcards', QUIZ: 'Quiz' };

/** « Réviser » : la bibliothèque de supports dérivés du cours reconstruit de cette séance. */
export function ReviewPage() {
  const { sessionId = '' } = useParams();
  const session = useLibrary((s) => s.sessions.find((x) => x.id === sessionId));
  const ready = useLibrary((s) => s.ready);
  const { subjectById } = useLookups();
  const items = useArtifacts((s) => s.items);
  const courses = useEngine((s) => s.courses);
  const open = useUI((s) => s.openSupportDialog);
  const course = useMemo(() => latestCourse(courses, sessionId), [courses, sessionId]);
  const mine = useMemo(() => items.filter((a) => a.sourceSessionIds.includes(sessionId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [items, sessionId]);
  const suggestions = useMemo(() => (course ? suggestSupports(treeOf(course)) : []), [course]);
  if (ready && !session) return <Navigate to="/" replace />;
  if (!session) return null;
  const subject = subjectById.get(session.subjectId);
  const groups = ARTIFACT_TYPES.map((t) => ({ t, list: mine.filter((a) => a.type === t) })).filter((g) => g.list.length);

  return (
    <div className="page page-enter coursepage" data-testid="review-page">
      <nav className="crumbs" aria-label="Fil d’Ariane">{subject && <><Link to={`/subjects/${subject.id}`}>{subject.name}</Link> ›</>}</nav>
      <SessionSpaces sessionId={session.id} />
      <header className="page__head">
        <div><span className="eyebrow">Réviser</span><h1>{sessionLabel(session)}</h1>
          <p className="page__sub">{subject && <SubjectDot color={subject.color} icon={subject.icon} />} {subject?.name} — supports de révision générés à partir du cours reconstruit, avec leurs sources</p></div>
      </header>

      {!course ? (
        <div className="panel empty" data-testid="review-nocourse">
          <strong>Le cours n’a pas encore été reconstruit.</strong>
          Les supports de révision se génèrent à partir du cours reconstruit : <Link to={`/session/${session.id}/course`} className="link">ouvrez l’espace « Cours »</Link> pour le produire.
        </div>
      ) : (
        <section className="panel rv" aria-label="Créer un support">
          <div className="rv__make" role="group" aria-label="Créer un support">
            {ARTIFACT_TYPES.map((t) => { const Icon = ICONS[t]; return (
              <button key={t} className="btn btn--sm" onClick={() => open({ sessionId: session.id, type: t })} data-testid={`review-create-${t}`}><Icon size={14} aria-hidden /> {CREATE[t]}</button>
            ); })}
          </div>
          {suggestions.length > 0 && <ul className="supporthints muted" data-testid="review-hints">{suggestions.map((x) => <li key={x.type + x.text}>{ARTIFACT_LABELS[x.type]} — {x.text}</li>)}</ul>}
          <p className="muted">Cours reconstruit v{course.courseVersion} · généré {formatRelative(course.generatedAt)}. Un support n’ajoute rien à ce cours : s’il manque de matière, LexNote vous l’explique au lieu de générer du contenu approximatif.</p>
        </section>
      )}

      {mine.length === 0 ? (
        course && <div className="panel empty" data-testid="review-empty"><strong>Aucun support pour ce cours.</strong>Choisissez un type ci-dessus pour créer le premier.</div>
      ) : (
        <div className="rv" data-testid="review-library">
          {groups.map(({ t, list }) => (
            <section key={t} className="rv__group" data-testid={`review-group-${t}`}>
              <h2>{PLURAL[t]} · {list.length}</h2>
              <ul className="panel rows">
                {list.map((a) => { const Icon = ICONS[a.type]; const stale = isStale(a, course); return (
                  <li key={a.id} data-testid="support-row">
                    <Link to={`/supports/${a.id}`} className="row supportrow">
                      <span className="supportrow__icon"><Icon size={18} aria-hidden /></span>
                      <span className="row__main"><strong className="truncate">{a.title}</strong>
                        <span className="muted truncate">{a.scope?.sectionTitle ?? 'Cours entier'} · cours v{a.courseVersion}{a.generation > 1 ? ` · génération ${a.generation}` : ''}</span></span>
                      {stale && <span className="rv__stale" data-testid="stale-tag"><TriangleAlert size={12} aria-hidden /> cours mis à jour</span>}
                      {a.userEdited && <span className="tag tag--live">Modifié</span>}
                      <span className="muted supportrow__date">{formatRelative(a.updatedAt)}</span>
                    </Link>
                  </li>
                ); })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="muted"><Link to="/supports" className="link">Tous mes supports</Link></p>
    </div>
  );
}
