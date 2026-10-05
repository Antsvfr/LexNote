import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Mic, Plus, Search, Sparkles, FileUp } from 'lucide-react';
import { useLibrary, selectLastSession } from '@/store/library';
import { useUI } from '@/store/ui';
import { useLookups } from '@/lib/useLookups';
import { formatDateLong, formatDuration, formatRelative } from '@/lib/dates';
import { sessionLabel } from '@/domain/session';
import { hasDemoData } from '@/domain/demo';
import { SessionRow } from '@/features/library/SessionRow';
import { SubjectDot } from '@/components/SubjectDot';
import { confirm } from '@/components/confirm';
import { toast } from '@/store/toasts';

export function Dashboard() {
  const navigate = useNavigate();
  const { subjects, modules, sessions, removeDemoData } = useLibrary();
  const openNewCm = useUI((s) => s.openNewCm);
  const { subjectById, moduleById } = useLookups();
  const [q, setQ] = useState('');

  const last = useMemo(() => selectLastSession(sessions), [sessions]);
  const recent = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6),
    [sessions],
  );
  const stats = useMemo(() => ({
    cm: sessions.length,
    words: sessions.reduce((n, s) => n + s.wordCount, 0),
    sec: sessions.reduce((n, s) => n + s.durationSec, 0),
  }), [sessions]);
  const demo = hasDemoData({ subjects, modules, sessions });

  async function clearDemo() {
    const ok = await confirm({
      title: 'Supprimer les données de démonstration ?',
      message: 'Les matières, modules et CM d’exemple seront retirés. Ce que vous avez écrit vous-même est conservé.',
      confirmLabel: 'Supprimer la démo', danger: true,
    });
    if (ok) { await removeDemoData(); toast.success('Données de démonstration supprimées.'); }
  }

  const lastSubject = last ? subjectById.get(last.subjectId) : undefined;
  const lastModule = last ? moduleById.get(last.moduleId) : undefined;

  return (
    <div className="page page-enter">
      <header className="page__head">
        <div>
          <p className="crumbs" style={{ textTransform: 'capitalize' }}>{formatDateLong(new Date().toISOString().slice(0, 10))}</p>
          <h1>Bon cours.</h1>
        </div>
        <form className="searchbox" role="search" onSubmit={(e) => { e.preventDefault(); navigate(`/search?q=${encodeURIComponent(q)}`); }}>
          <Search size={16} aria-hidden />
          <input aria-label="Rechercher dans mes notes" placeholder="Rechercher une notion, un article, un CM…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      </header>

      {demo && (
        <div className="banner" style={{ marginBottom: 'var(--sp-5)' }}>
          <Sparkles size={16} aria-hidden />
          <span>Vous explorez avec des <strong>données de démonstration</strong>.</span>
          <span className="spacer" />
          <button className="btn btn--sm" onClick={clearDemo}>Supprimer la démo</button>
        </div>
      )}

      {/* Reprendre */}
      <section className="resume" aria-label="Continuer">
        {last ? (
          <>
            <div className="resume__body">
              <span className="eyebrow">{last.status === 'completed' ? 'Dernier CM' : 'Reprendre'}</span>
              <h2 className="resume__title">{sessionLabel(last)}</h2>
              <p className="resume__meta">
                {lastSubject && <SubjectDot color={lastSubject.color} />} {lastSubject?.name} › {lastModule?.name} · modifié {formatRelative(last.updatedAt)}
              </p>
              {last.excerpt && <p className="resume__excerpt">{last.excerpt}</p>}
            </div>
            <div className="resume__actions">
              <Link className="btn btn--primary" to={`/session/${last.id}`} data-testid="continue-last">
                Continuer <ArrowRight />
              </Link>
              <button className="btn" onClick={() => openNewCm({ subjectId: last.subjectId, moduleId: last.moduleId })}>
                <Plus /> CM suivant
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="resume__body">
              <span className="eyebrow">Bienvenue</span>
              <h2 className="resume__title">Prêt pour votre premier CM ?</h2>
              <p className="resume__meta">Créez une matière, un module, puis commencez à écrire. Tout reste sur votre appareil.</p>
            </div>
            <div className="resume__actions">
              <button className="btn btn--primary" onClick={() => openNewCm()}><Plus /> Nouveau CM</button>
            </div>
          </>
        )}
      </section>

      {/* Chiffres */}
      <dl className="figures" aria-label="Statistiques">
        <div><dt>CM</dt><dd>{stats.cm}</dd></div>
        <div><dt>Matières</dt><dd>{subjects.length}</dd></div>
        <div><dt>Mots écrits</dt><dd>{stats.words.toLocaleString('fr-FR')}</dd></div>
        <div><dt>Temps de notes</dt><dd>{formatDuration(stats.sec)}</dd></div>
      </dl>

      <div className="split">
        <section aria-labelledby="recent-h">
          <div className="section-head">
            <h2 id="recent-h">Cours récents</h2>
            <Link to="/sessions" className="link">Tout voir</Link>
          </div>
          {recent.length === 0 ? (
            <div className="empty"><strong>Aucun CM pour le moment</strong>Vos séances apparaîtront ici.</div>
          ) : (
            <ul className="list">{recent.map((s) => <SessionRow key={s.id} session={s} />)}</ul>
          )}
        </section>

        <section aria-labelledby="subj-h">
          <div className="section-head">
            <h2 id="subj-h">Mes matières</h2>
            <Link to="/subjects" className="link">Gérer</Link>
          </div>
          {subjects.length === 0 ? (
            <div className="empty"><strong>Aucune matière</strong>Elles se créent avec votre premier CM.</div>
          ) : (
            <ul className="list list--plain">
              {subjects.map((s) => {
                const mods = modules.filter((m) => m.subjectId === s.id).length;
                const cms = sessions.filter((x) => x.subjectId === s.id).length;
                return (
                  <li key={s.id}>
                    <Link to={`/subjects/${s.id}`} className="subrow">
                      <SubjectDot color={s.color} />
                      <span className="truncate">{s.name}</span>
                      <span className="muted subrow__count">{mods} module{mods > 1 ? 's' : ''} · {cms} CM</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="soon" aria-label="Bientôt disponible">
            <span className="tag tag--soon">Bientôt</span>
            <Mic size={13} aria-hidden /> Transcription <span aria-hidden>·</span> <FileUp size={13} aria-hidden /> Documents <span aria-hidden>·</span> <Sparkles size={13} aria-hidden /> Assistant
          </p>
        </section>
      </div>
    </div>
  );
}
