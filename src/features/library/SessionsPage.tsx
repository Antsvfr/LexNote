import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { normalize } from '@/lib/text';
import { SessionRow } from './SessionRow';

type StatusFilter = '' | 'in_progress' | 'completed';
const TABS: { id: StatusFilter; label: string }[] = [{ id: '', label: 'Tous' }, { id: 'in_progress', label: 'En cours' }, { id: 'completed', label: 'Terminés' }];

export function SessionsPage() {
  const { sessions, subjects } = useLibrary();
  const openNewCm = useUI((s) => s.openNewCm);
  const [subjectId, setSubjectId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const tokens = normalize(q).split(/\s+/).filter(Boolean);
    return sessions
      .filter((s) => (!subjectId || s.subjectId === subjectId) && (!status || s.status === status))
      .filter((s) => !tokens.length || tokens.every((t) => normalize(`${s.title} ${s.number ?? ''}`).includes(t)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [sessions, subjectId, status, q]);

  return (
    <div className="page page-enter">
      <header className="page__head">
        <div><h1>Mes séances</h1><p className="page__sub">{list.length} séance{list.length > 1 ? 's' : ''}</p></div>
        <button className="btn btn--primary" onClick={() => openNewCm()}><Plus /> Nouvelle séance</button>
      </header>
      <div className="filters">
        <div className="tabs" role="tablist" aria-label="Statut">
          {TABS.map((t) => <button key={t.id} role="tab" aria-selected={status === t.id} className={status === t.id ? 'is-on' : ''} onClick={() => setStatus(t.id)} data-testid={`tab-${t.id || 'all'}`}>{t.label}</button>)}
        </div>
        <select className="select" aria-label="Filtrer par matière" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="">Toutes les matières</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="searchbox"><Search size={16} aria-hidden /><input aria-label="Filtrer par titre" placeholder="Filtrer par titre…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      {list.length === 0
        ? <div className="panel empty"><strong>Aucune séance</strong>Aucune séance ne correspond.</div>
        : <ul className="panel rows" style={{ position: 'relative', zIndex: 1 }}>{list.map((s) => <SessionRow key={s.id} session={s} />)}</ul>}
    </div>
  );
}
