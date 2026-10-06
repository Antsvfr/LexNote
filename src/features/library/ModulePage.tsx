import { Link, Navigate, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { SessionRow } from './SessionRow';

export function ModulePage() {
  const { moduleId } = useParams();
  const { modules, subjects, sessions } = useLibrary();
  const openNewCm = useUI((s) => s.openNewCm);
  const mod = modules.find((m) => m.id === moduleId);
  if (!mod) return <Navigate to="/subjects" replace />;
  const subject = subjects.find((s) => s.id === mod.subjectId);
  const list = sessions.filter((s) => s.moduleId === mod.id).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

  return (
    <div className="page page-enter">
      <nav className="crumbs" aria-label="Fil d’Ariane">
        <Link to="/subjects">Mes matières</Link> › {subject && <Link to={`/subjects/${subject.id}`}>{subject.name}</Link>} ›
      </nav>
      <header className="page__head">
        <div><h1>{mod.name}</h1><p className="page__sub">{list.length} CM</p></div>
        <button className="btn btn--primary" onClick={() => openNewCm({ subjectId: mod.subjectId, moduleId: mod.id })}><Plus /> Nouveau CM</button>
      </header>
      {list.length === 0 ? <div className="panel empty"><strong>Aucun CM</strong>Créez la première séance de ce module.</div> : <ul className="panel rows">{list.map((s) => <SessionRow key={s.id} session={s} showContext={false} />)}</ul>}
    </div>
  );
}
