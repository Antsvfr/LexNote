import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { normalize } from '@/lib/text';
import { MAIN_TYPES } from '@/domain/sessionType';
import { SessionRow } from './SessionRow';

type StatusFilter = '' | 'in_progress' | 'completed';
type TypeFilter = '' | 'CM' | 'TD' | 'TP' | 'others';
type Sort = 'updated' | 'date' | 'title';
const TYPE_TABS: { id: TypeFilter; label: string }[] = [{ id: '', label: 'Toutes' }, { id: 'CM', label: 'CM' }, { id: 'TD', label: 'TD' }, { id: 'TP', label: 'TP' }, { id: 'others', label: 'Autres' }];
const STATUS: { id: StatusFilter; label: string }[] = [{ id: '', label: 'Tous les états' }, { id: 'in_progress', label: 'En cours' }, { id: 'completed', label: 'Terminées' }];

export function SessionsPage() {
  const { sessions, subjects } = useLibrary();
  const openNewSession = useUI((s) => s.openNewSession);
  const [type, setType] = useState<TypeFilter>('');
  const [subjectId, setSubjectId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<Sort>('updated');
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const tokens = normalize(q).split(/\s+/).filter(Boolean);
    const byType = (t: string) => !type || (type === 'others' ? !MAIN_TYPES.includes(t as never) : t === type);
    return sessions
      .filter((s) => byType(s.type) && (!subjectId || s.subjectId === subjectId) && (!status || s.status === status))
      .filter((s) => (!from || s.date >= from) && (!to || s.date <= to))
      .filter((s) => !tokens.length || tokens.every((t) => normalize(`${s.title} ${s.type} ${s.number ?? ''}`).includes(t)))
      .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'fr') : sort === 'date' ? b.date.localeCompare(a.date) : b.updatedAt.localeCompare(a.updatedAt));
  }, [sessions, type, subjectId, status, from, to, sort, q]);

  return (
    <div className="page page-enter">
      <header className="page__head">
        <div><h1>Mes séances</h1><p className="page__sub">{list.length} séance{list.length > 1 ? 's' : ''}</p></div>
        <button className="btn btn--primary" onClick={() => openNewSession()} data-testid="sessions-new"><Plus /> Nouvelle séance</button>
      </header>
      <div className="filters">
        <div className="tabs" role="tablist" aria-label="Type de séance">
          {TYPE_TABS.map((t) => <button key={t.id} role="tab" aria-selected={type === t.id} className={type === t.id ? 'is-on' : ''} onClick={() => setType(t.id)} data-testid={`tab-${t.id || 'all'}`}>{t.label}</button>)}
        </div>
        <select className="select" aria-label="Filtrer par matière" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="">Toutes les matières</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="select" aria-label="Filtrer par état" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} data-testid="status-filter">
          {STATUS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <input className="select" type="date" aria-label="Depuis le" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="select" type="date" aria-label="Jusqu’au" value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="select" aria-label="Trier" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="updated">Modifiées récemment</option><option value="date">Par date</option><option value="title">Par titre</option>
        </select>
        <label className="searchbox"><Search size={16} aria-hidden /><input aria-label="Filtrer par titre" placeholder="Filtrer par titre…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      {list.length === 0
        ? <div className="panel empty"><strong>Aucune séance</strong>{sessions.length ? 'Aucune séance ne correspond à ces filtres.' : 'Créez votre première séance pour commencer à prendre des notes.'}</div>
        : <ul className="panel rows" style={{ position: 'relative', zIndex: 1 }}>{list.map((s) => <SessionRow key={s.id} session={s} />)}</ul>}
    </div>
  );
}
