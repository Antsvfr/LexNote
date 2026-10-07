import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FolderPlus, Plus } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { useCreateSubject } from './useCreateSubject';
import { SubjectDot } from '@/components/SubjectDot';
import { sessionLabel } from '@/domain/session';
import { THUMBS, thumbFor } from '@/lib/thumbs';
import { formatRelative } from '@/lib/dates';

export function SubjectsPage() {
  const { subjects, modules, sessions } = useLibrary();
  const openNewCm = useUI((s) => s.openNewCm);
  const createSubject = useCreateSubject();
  const sorted = useMemo(() => [...subjects].sort((a, b) => a.name.localeCompare(b.name, 'fr')), [subjects]);

  return (
    <div className="page page-enter">
      <header className="page__head">
        <div>
          <h1>Mes matières</h1>
          <p className="page__sub">Une matière regroupe des modules, qui regroupent vos séances.</p>
        </div>
        <button className="btn btn--primary" onClick={() => void createSubject()} data-testid="new-subject"><FolderPlus /> Nouvelle matière</button>
      </header>

      {sorted.length === 0 ? (
        <div className="panel empty"><strong>Aucune matière</strong>Créez-en une pour organiser vos cours.</div>
      ) : (
        <ul className="subjgrid">
          {sorted.map((s) => {
            const mods = modules.filter((m) => m.subjectId === s.id);
            const cms = sessions.filter((x) => x.subjectId === s.id);
            const done = cms.filter((c) => c.status === 'completed').length;
            const pct = cms.length ? Math.round((done / cms.length) * 100) : 0;
            const last = [...cms].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
            return (
              <li key={s.id} className="subjcard" data-color={s.color} data-testid="subject-card">
                <Link to={`/subjects/${s.id}`} className="subjcard__head" aria-label={`Ouvrir ${s.name}`}>
                  <SubjectDot color={s.color} />
                  <h2>{s.name}</h2>
                  <ArrowRight size={18} className="muted" style={{ marginLeft: 'auto' }} aria-hidden />
                </Link>
                <div className="subjcard__figs">
                  <div><strong>{mods.length}</strong><span>module{mods.length > 1 ? 's' : ''}</span></div>
                  <div><strong>{cms.length}</strong><span>CM</span></div>
                  <div><strong>{done}</strong><span>terminé{done > 1 ? 's' : ''}</span></div>
                </div>
                {cms.length > 0 && (
                  <div className="progress" title="Séance terminés / séance de la matière">
                    <div className="progress__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Avancement de ${s.name}`}><span style={{ width: `${pct}%` }} /></div>
                    <span className="progress__label">{pct} %</span>
                  </div>
                )}
                {last && (
                  <Link to={last.status === 'completed' ? `/session/${last.id}/recap` : `/session/${last.id}`} className="subjcard__last">
                    <img src={THUMBS[thumbFor(last, s)].src} alt="" />
                    <span className="truncate"><strong className="truncate">{sessionLabel(last)}</strong>Dernier séance · modifié {formatRelative(last.updatedAt)}</span>
                  </Link>
                )}
                <div className="chips">
                  {mods.map((m) => <Link key={m.id} to={`/modules/${m.id}`} className="chip">{m.name}</Link>)}
                  <button className="chip chip--add" onClick={() => openNewCm({ subjectId: s.id })}><Plus size={13} /> séance</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
