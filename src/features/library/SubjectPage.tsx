import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { SubjectDot } from '@/components/SubjectDot';
import { confirm, promptText } from '@/components/confirm';
import { SessionRow } from './SessionRow';
import { toast } from '@/store/toasts';

export function SubjectPage() {
  const { subjectId } = useParams();
  const navigate = useNavigate();
  const { subjects, modules, sessions, renameSubject, deleteSubject, addModule, renameModule, deleteModule } = useLibrary();
  const openNewCm = useUI((s) => s.openNewCm);
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) return <Navigate to="/subjects" replace />;
  const mods = modules.filter((m) => m.subjectId === subject.id).sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  async function rename() {
    const name = await promptText({ title: 'Renommer la matière', label: 'Nom', initial: subject!.name });
    if (name) await renameSubject(subject!.id, name);
  }
  async function remove() {
    const n = sessions.filter((s) => s.subjectId === subject!.id).length;
    const ok = await confirm({
      title: `Supprimer « ${subject!.name} » ?`,
      message: `Cette matière, ses modules et ses ${n} CM seront définitivement supprimés de cet appareil.`,
      confirmLabel: 'Supprimer', danger: true,
    });
    if (!ok) return;
    await deleteSubject(subject!.id);
    toast.success('Matière supprimée.');
    navigate('/subjects');
  }
  async function newModule() {
    const name = await promptText({ title: 'Nouveau module', label: 'Nom du module', placeholder: 'ex. Droit des contrats', confirmLabel: 'Créer' });
    if (name) await addModule(subject!.id, name);
  }

  return (
    <div className="page page-enter">
      <nav className="crumbs" aria-label="Fil d’Ariane"><Link to="/subjects">Mes matières</Link> ›</nav>
      <header className="page__head">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}><SubjectDot color={subject.color} /> {subject.name}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--sm" onClick={rename}><Pencil /> Renommer</button>
          <button className="btn btn--sm btn--danger" onClick={remove}><Trash2 /> Supprimer</button>
          <button className="btn btn--sm" onClick={newModule} data-testid="new-module"><Plus /> Module</button>
          <button className="btn btn--sm btn--primary" onClick={() => openNewCm({ subjectId: subject.id })}><Plus /> CM</button>
        </div>
      </header>

      {mods.length === 0 && <div className="panel empty"><strong>Aucun module</strong>Ajoutez un module (ex. « Droit des contrats »).</div>}
      {mods.map((m) => {
        const list = sessions.filter((s) => s.moduleId === m.id).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
        return (
          <section key={m.id} className="module-block" aria-labelledby={`m-${m.id}`}>
            <div className="section-head">
              <h2 id={`m-${m.id}`}><Link to={`/modules/${m.id}`}>{m.name}</Link></h2>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Renommer ${m.name}`} onClick={async () => {
                  const name = await promptText({ title: 'Renommer le module', label: 'Nom', initial: m.name });
                  if (name) await renameModule(m.id, name);
                }}><Pencil /></button>
                <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Supprimer ${m.name}`} onClick={async () => {
                  const ok = await confirm({ title: `Supprimer « ${m.name} » ?`, message: `Le module et ses ${list.length} CM seront supprimés de cet appareil.`, confirmLabel: 'Supprimer', danger: true });
                  if (ok) await deleteModule(m.id);
                }}><Trash2 /></button>
                <button className="btn btn--sm" onClick={() => openNewCm({ subjectId: subject.id, moduleId: m.id })}><Plus /> CM</button>
              </div>
            </div>
            {list.length === 0 ? <p className="muted" style={{ padding: '8px 0' }}>Aucun CM dans ce module.</p> : <ul className="panel rows">{list.map((s) => <SessionRow key={s.id} session={s} showContext={false} />)}</ul>}
          </section>
        );
      })}
    </div>
  );
}
