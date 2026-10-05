import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FolderPlus, Plus } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { SubjectDot } from '@/components/SubjectDot';
import { promptText } from '@/components/confirm';
import { toast } from '@/store/toasts';

export function SubjectsPage() {
  const { subjects, modules, sessions, addSubject } = useLibrary();
  const openNewCm = useUI((s) => s.openNewCm);
  const sorted = useMemo(() => [...subjects].sort((a, b) => a.name.localeCompare(b.name, 'fr')), [subjects]);

  async function create() {
    const name = await promptText({ title: 'Nouvelle matière', label: 'Nom de la matière', placeholder: 'ex. Droit', confirmLabel: 'Créer' });
    if (!name) return;
    try { await addSubject(name); toast.success(`Matière « ${name} » créée.`); } catch { /* toast déjà affiché */ }
  }

  return (
    <div className="page page-enter">
      <header className="page__head">
        <div>
          <h1>Mes matières</h1>
          <p className="page__sub">Une matière regroupe des modules, qui regroupent vos CM.</p>
        </div>
        <button className="btn btn--primary" onClick={create} data-testid="new-subject"><FolderPlus /> Nouvelle matière</button>
      </header>

      {sorted.length === 0 ? (
        <div className="empty"><strong>Aucune matière</strong>Créez-en une pour organiser vos cours.</div>
      ) : (
        <ul className="list list--plain">
          {sorted.map((s) => {
            const mods = modules.filter((m) => m.subjectId === s.id);
            const cms = sessions.filter((x) => x.subjectId === s.id).length;
            return (
              <li key={s.id} className="subject-card">
                <Link to={`/subjects/${s.id}`} className="subject-card__head">
                  <SubjectDot color={s.color} />
                  <h2>{s.name}</h2>
                  <span className="muted">{mods.length} module{mods.length > 1 ? 's' : ''} · {cms} CM</span>
                </Link>
                <div className="chips">
                  {mods.map((m) => <Link key={m.id} to={`/modules/${m.id}`} className="chip">{m.name}</Link>)}
                  <button className="chip chip--add" onClick={() => openNewCm({ subjectId: s.id })}><Plus size={13} /> CM</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
