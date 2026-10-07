import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart3, BookOpen, Brain, CalendarClock, FileText, HelpCircle, Network, Plus, Search, type LucideIcon } from 'lucide-react';
import { useArtifacts } from '@/store/artifacts';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { SubjectDot } from '@/components/SubjectDot';
import { formatRelative } from '@/lib/dates';
import { normalize } from '@/lib/text';
import { ARTIFACT_LABELS, type ArtifactType } from '@/domain/study';

const ICONS: Record<ArtifactType, LucideIcon> = { COURSE_SHEET: FileText, MIND_MAP: Brain, DIAGRAM: Network, COMPARISON_TABLE: BarChart3, TIMELINE: CalendarClock, FLASHCARDS: BookOpen, QUIZ: HelpCircle };
const TABS: { id: '' | ArtifactType; label: string }[] = [
  { id: '', label: 'Tous' }, { id: 'COURSE_SHEET', label: 'Fiches' }, { id: 'MIND_MAP', label: 'Cartes mentales' }, { id: 'DIAGRAM', label: 'Schémas' },
  { id: 'COMPARISON_TABLE', label: 'Tableaux' }, { id: 'TIMELINE', label: 'Chronologies' }, { id: 'FLASHCARDS', label: 'Flashcards' }, { id: 'QUIZ', label: 'Quiz' },
];

export function SupportsPage() {
  const [params] = useSearchParams();
  const items = useArtifacts((s) => s.items);
  const { subjects, sessions } = useLibrary();
  const open = useUI((s) => s.openSupportDialog);
  const [type, setType] = useState<'' | ArtifactType>('');
  const [subjectId, setSubjectId] = useState(params.get('subject') ?? '');
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const t = normalize(q);
    return items.filter((a) => (!type || a.type === type) && (!subjectId || a.subjectId === subjectId) && (!t || normalize(a.title).includes(t)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [items, type, subjectId, q]);

  return (
    <div className="page page-enter">
      <header className="page__head">
        <div><h1>Mes supports</h1><p className="page__sub">{list.length} support{list.length > 1 ? 's' : ''} · fiches, cartes mentales, schémas… dérivés de vos cours</p></div>
        <button className="btn btn--primary" onClick={() => open()} data-testid="supports-new"><Plus /> Créer un support</button>
      </header>
      <div className="filters">
        <div className="tabs" role="tablist" aria-label="Type de support">
          {TABS.map((t) => <button key={t.id || 'all'} role="tab" aria-selected={type === t.id} className={type === t.id ? 'is-on' : ''} onClick={() => setType(t.id)} data-testid={`stab-${t.id || 'all'}`}>{t.label}</button>)}
        </div>
        <select className="select" aria-label="Filtrer par matière" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="">Toutes les matières</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label className="searchbox"><Search size={16} aria-hidden /><input aria-label="Filtrer par titre" placeholder="Filtrer par titre…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      {list.length === 0 ? (
        <div className="panel empty" data-testid="supports-empty"><strong>{items.length ? 'Aucun support ne correspond.' : 'Aucun support pour l’instant.'}</strong>{items.length ? '' : 'Ouvrez un cours puis « Créer un support » : fiche, carte mentale, schéma, tableau comparatif…'}</div>
      ) : (
        <ul className="panel rows" style={{ position: 'relative', zIndex: 1 }}>
          {list.map((a) => {
            const Icon = ICONS[a.type]; const sub = subjects.find((s) => s.id === a.subjectId); const ses = sessions.find((s) => s.id === a.sourceSessionIds[0]);
            return (
              <li key={a.id} data-testid="support-row">
                <Link to={`/supports/${a.id}`} className="row supportrow">
                  <span className="supportrow__icon"><Icon size={20} aria-hidden /></span>
                  <span className="row__main"><strong className="truncate">{a.title}</strong>
                    <span className="muted truncate">{sub && <><SubjectDot color={sub.color} icon={sub.icon} /> {sub.name} · </>}{ses ? (ses.title || 'Séance') : 'séance supprimée'}</span></span>
                  <span className="tag">{ARTIFACT_LABELS[a.type]}</span>
                  <span className="muted supportrow__date">{a.userEdited ? 'modifié ' : 'créé '}{formatRelative(a.updatedAt)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
