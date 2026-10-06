import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, ChevronRight, Clock, FileText, FileUp, Mic, Pencil, Plus, Sparkles, TrendingUp } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { useProfile, greeting } from '@/store/profile';
import { useCapture } from '@/store/capture';
import { useLookups } from '@/lib/useLookups';
import { formatDateLong } from '@/lib/dates';
import { sessionLabel } from '@/domain/session';
import { hasDemoData } from '@/domain/demo';
import { computeDashboardStats, moduleProgress, pickResumeSession, type StatCard } from '@/lib/stats';
import { THUMBS, thumbFor } from '@/lib/thumbs';
import { SessionRow } from '@/features/library/SessionRow';
import { SubjectDot } from '@/components/SubjectDot';
import { confirm } from '@/components/confirm';
import { toast } from '@/store/toasts';
import heroArt from '@/assets/art/hero-courthouse.svg';
import booksArt from '@/assets/art/books.svg';

function Stat({ tone, icon, label, card }: { tone: 'blue' | 'red' | 'orange' | 'green'; icon: React.ReactNode; label: string; card: StatCard }) {
  return (
    <div className={`stat stat--${tone}`} data-testid={`stat-${label}`}>
      <span className="stat__icon" aria-hidden>{icon}</span>
      <div className="stat__body">
        <span className="stat__label">{label}</span>
        <strong className="stat__value">{card.value}</strong>
        <span className="stat__note">{card.note}</span>
      </div>
      {card.up && <TrendingUp className="stat__trend" size={22} aria-hidden />}
    </div>
  );
}

function ToolCard({ tone, icon, title, text, soon, onClick, testId }: { tone: string; icon: React.ReactNode; title: string; text: string; soon?: boolean; onClick?: () => void; testId: string }) {
  const body = (
    <>
      {soon && <span className="tag tag--soon tool__badge">Bientôt</span>}
      <span className={`tool__icon tool__icon--${tone}`} aria-hidden>{icon}</span>
      <strong>{title}</strong>
      <small>{text}</small>
    </>
  );
  return soon
    ? <div className="tool is-soon" aria-disabled="true" data-testid={testId}>{body}</div>
    : <button className="tool" onClick={onClick} data-testid={testId}>{body}</button>;
}

export function Dashboard() {
  const navigate = useNavigate();
  const { subjects, modules, sessions, removeDemoData } = useLibrary();
  const openNewCm = useUI((s) => s.openNewCm);
  const { firstName, quote } = useProfile();
  const { subjectById, moduleById } = useLookups();
  const activeCapture = useCapture((s) => s.active);

  const now = new Date();
  const dateLabel = useMemo(() => { const d = formatDateLong(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`); return d.charAt(0).toUpperCase() + d.slice(1); }, [now.getDate()]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useMemo(() => computeDashboardStats(sessions, subjects, modules), [sessions, subjects, modules]);
  const last = useMemo(() => pickResumeSession(sessions), [sessions]);
  const recent = useMemo(() => [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5), [sessions]);
  const demo = hasDemoData({ subjects, modules, sessions });

  const lastSubject = last ? subjectById.get(last.subjectId) : undefined;
  const lastModule = last ? moduleById.get(last.moduleId) : undefined;
  const progress = last ? moduleProgress(sessions, last.moduleId) : null;

  async function clearDemo() {
    const ok = await confirm({
      title: 'Supprimer les données de démonstration ?',
      message: 'Les matières, modules et CM d’exemple seront retirés. Ce que vous avez écrit vous-même est conservé.',
      confirmLabel: 'Supprimer la démo', danger: true,
    });
    if (ok) { await removeDemoData(); toast.success('Données de démonstration supprimées.'); }
  }

  /** Transcription : reprend la capture en cours, sinon ouvre le CM à reprendre sur l'onglet Transcription. */
  function goTranscription() {
    if (activeCapture) return navigate(`/session/${activeCapture.sessionId}`);
    if (last) return navigate(`/session/${last.id}?panel=transcript`);
    openNewCm();
  }

  return (
    <div className="page dash page-enter">
      <div className="hero-art" aria-hidden>
        <img src={heroArt} alt="" />
      </div>

      <section className="hero" aria-label="Bienvenue">
        <div>
          <p className="hero__date">{dateLabel}</p>
          <h1 className="hero__title">{greeting(firstName)}</h1>
          <p className="hero__sub">Retrouvez vos notes, continuez vos CM et progressez.</p>
        </div>
        <p className="hero__quote">« {quote.replace(/^«\s*|\s*»$/g, '')} »</p>
      </section>

      <div className="stats" role="group" aria-label="Statistiques">
        <Stat tone="blue" icon={<BookOpen size={24} />} label="CM" card={stats.cm} />
        <Stat tone="red" icon={<FileText size={24} />} label="Matières" card={stats.subjects} />
        <Stat tone="orange" icon={<Pencil size={24} />} label="Mots écrits" card={stats.words} />
        <Stat tone="green" icon={<Clock size={24} />} label="Temps de notes" card={stats.time} />
        <button className="newcm" onClick={() => openNewCm()} data-testid="dash-new-cm"><Plus size={22} /> Nouveau CM</button>
      </div>

      {/* Reprendre votre cours */}
      <section className="resume" aria-label="Reprendre votre cours">
        <img className="resume__books" src={booksArt} alt="" aria-hidden />
        {last ? (
          <>
            <div className="resume__thumb">
              <img src={THUMBS[thumbFor(last, lastSubject)].src} alt="" />
              <span className="tag tag--live resume__badge">{last.status === 'completed' ? 'Terminé' : 'En cours'}</span>
            </div>
            <div className="resume__body">
              <span className="eyebrow">{last.status === 'completed' ? 'Dernier cours' : 'Reprendre votre cours'}</span>
              <h2 className="resume__title">{sessionLabel(last)}</h2>
              <p className="resume__meta">{lastSubject && <SubjectDot color={lastSubject.color} />} {lastSubject?.name}{lastModule ? ` · ${lastModule.name}` : ''}</p>
              {progress && progress.total > 0 && (
                <div className="progress" title="Avancement du module : CM terminés / CM du module">
                  <div className="progress__bar" role="progressbar" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Avancement du module">
                    <span style={{ width: `${progress.pct}%` }} />
                  </div>
                  <span className="progress__label">Module · {progress.done}/{progress.total} CM terminés · {progress.pct} %</span>
                </div>
              )}
            </div>
            <div className="resume__actions">
              <Link className="btn btn--light resume__go" to={`/session/${last.id}`} data-testid="continue-last">Continuer <ArrowRight /></Link>
              <button className="btn resume__next" onClick={() => openNewCm({ subjectId: last.subjectId, moduleId: last.moduleId })} data-testid="next-cm"><Plus /> CM suivant</button>
            </div>
          </>
        ) : (
          <>
            <div className="resume__body resume__body--empty">
              <span className="eyebrow">Bienvenue</span>
              <h2 className="resume__title">Prêt pour votre premier CM ?</h2>
              <p className="resume__meta">Créez une matière, un module, puis commencez à écrire. Tout reste sur votre appareil.</p>
            </div>
            <div className="resume__actions"><button className="btn btn--primary resume__go" onClick={() => openNewCm()}><Plus /> Nouveau CM</button></div>
          </>
        )}
      </section>

      <div className="dash__grid">
        <section aria-labelledby="recent-h">
          <div className="section-head"><h2 id="recent-h">Mes derniers cours</h2><Link to="/sessions" className="link">Tout voir <ArrowRight size={15} /></Link></div>
          {recent.length === 0
            ? <div className="panel empty"><strong>Aucun CM pour le moment</strong>Vos séances apparaîtront ici.</div>
            : <ul className="panel rows">{recent.map((s) => <SessionRow key={s.id} session={s} />)}</ul>}
        </section>

        <aside className="dash__side">
          <section className="panel" aria-labelledby="subj-h">
            <div className="section-head section-head--inset"><h2 id="subj-h">Mes matières</h2><Link to="/subjects" className="link">Gérer <ChevronRight size={15} /></Link></div>
            {subjects.length === 0 ? (
              <div className="empty"><strong>Aucune matière</strong>Elles se créent avec votre premier CM.</div>
            ) : (
              <ul className="subjlist">
                {subjects.map((s) => {
                  const mods = modules.filter((m) => m.subjectId === s.id).length;
                  const cms = sessions.filter((x) => x.subjectId === s.id).length;
                  return (
                    <li key={s.id}>
                      <Link to={`/subjects/${s.id}`} className="subjlist__row">
                        <SubjectDot color={s.color} />
                        <strong className="truncate">{s.name}</strong>
                        <span className="subjlist__count">{mods} module{mods > 1 ? 's' : ''} · {cms} CM</span>
                        <ChevronRight size={16} aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="tools" role="group" aria-label="Outils">
            <ToolCard testId="tool-transcription" tone="red" icon={<Mic size={22} />} title="Transcription" text="Enregistrer et transcrire vos cours" onClick={goTranscription} />
            <ToolCard testId="tool-documents" tone="blue" icon={<FileUp size={22} />} title="Documents" text="Ajouter vos supports (PDF, PPT, etc.)" soon />
            <ToolCard testId="tool-assistant" tone="purple" icon={<Sparkles size={22} />} title="Assistant" text="Analyser, résumer, expliquer" soon />
          </div>
        </aside>
      </div>
      {demo && (
        <div className="banner dash__demo">
          <Sparkles size={16} aria-hidden />
          <span>Vous explorez avec des <strong>données de démonstration</strong>.</span>
          <span className="spacer" />
          <button className="btn btn--sm" onClick={clearDemo}>Supprimer la démo</button>
        </div>
      )}

    </div>
  );
}
