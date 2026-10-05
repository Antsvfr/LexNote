import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { SessionRow } from './SessionRow';

export function SessionsPage() {
  const { sessions, subjects } = useLibrary();
  const openNewCm = useUI((s) => s.openNewCm);
  const [subjectId, setSubjectId] = useState('');
  const [status, setStatus] = useState<'' | 'in_progress' | 'completed'>('');

  const list = useMemo(
    () =>
      sessions
        .filter((s) => (!subjectId || s.subjectId === subjectId) && (!status || s.status === status))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [sessions, subjectId, status],
  );

  return (
    <div className="page page-enter">
      <header className="page__head">
        <div><h1>Mes CM</h1><p className="page__sub">{list.length} séance{list.length > 1 ? 's' : ''}</p></div>
        <button className="btn btn--primary" onClick={() => openNewCm()}><Plus /> Nouveau CM</button>
      </header>
      <div className="filters">
        <select className="select" aria-label="Filtrer par matière" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="">Toutes les matières</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="select" aria-label="Filtrer par statut" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">Tous les statuts</option>
          <option value="in_progress">En cours</option>
          <option value="completed">Terminés</option>
        </select>
      </div>
      {list.length === 0 ? <div className="empty"><strong>Aucun CM</strong>Aucune séance ne correspond.</div> : <ul className="list">{list.map((s) => <SessionRow key={s.id} session={s} />)}</ul>}
    </div>
  );
}
