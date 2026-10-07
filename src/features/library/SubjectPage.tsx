import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { SubjectDot } from '@/components/SubjectDot';
import { confirm, promptText } from '@/components/confirm';
import { SessionRow } from './SessionRow';
import { toast } from '@/store/toasts';
import type { CourseSession, SessionType } from '@/domain/types';

const TYPE_ORDER: Record<SessionType, number> = { CM: 0, TD: 1, TP: 2, COURSE: 3, SEMINAR: 4, WORKSHOP: 5, REVISION: 6, OTHER: 7 };

function sortSessions(a: CourseSession, b: CourseSession) {
  const ta = TYPE_ORDER[a.type ?? 'CM'];
  const tb = TYPE_ORDER[b.type ?? 'CM'];
  return ta - tb || (a.number ?? 999) - (b.number ?? 999) || b.date.localeCompare(a.date);
}

export function SubjectPage() {
  const { subjectId } = useParams();
  const navigate = useNavigate();
  const { subjects, modules, sessions, renameSubject, deleteSubject, addModule, renameModule, deleteModule } = useLibrary();
  const openNewCm = useUI((s) => s.openNewCm);
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) return <Navigate to="/subjects" replace />;

  const mods = modules.filter((m) => m.subjectId === subject.id).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const loose = sessions.filter((s) => s.subjectId === subject.id && !s.moduleId).sort(sortSessions);
  const total = sessions.filter((s) => s.subjectId === subject.id).length;

  async function rename() {
    const name = await promptText({ title: 'Renommer la matière', label: 'Nom', initial: subject!.name });
    if (name) await renameSubject(subject!.id, name);
  }

  async function remove() {
    const ok = await confirm({
      title: `Supprimer « ${subject!.name} » ?`,
      message: `Cette matière, ses modules et ses ${total} séance${total > 1 ? 's' : ''} seront supprimés de votre espace LexNote sur tous vos appareils.`,
      confirmLabel: 'Supprimer',
      danger: true,
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
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}><SubjectDot color={subject.color} /> {subject.name}</h1>
          <p className="page__sub">{mods.length} module{mods.length > 1 ? 's' : ''} · {total} séance{total > 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn--sm" onClick={rename}><Pencil /> Renommer</button>
          <button className="btn btn--sm btn--danger" onClick={remove}><Trash2 /> Supprimer</button>
          <button className="btn btn--sm" onClick={newModule} data-testid="new-module"><Plus /> Module</button>
          <button className="btn btn--sm btn--primary" onClick={() => openNewCm({ subjectId: subject.id })}><Plus /> Séance</button>
        </div>
      </header>

      {loose.length > 0 && (
        <section className="module-block" aria-labelledby="loose-sessions">
          <div className="section-head">
            <div><h2 id="loose-sessions">Séances sans module</h2><p className="muted">{loose.length} séance{loose.length > 1 ? 's' : ''}</p></div>
            <button className="btn btn--sm" onClick={() => openNewCm({ subjectId: subject.id })}><Plus /> Séance</button>
          </div>
          <ul className="panel rows">{loose.map((s) => <SessionRow key={s.id} session={s} showContext={false} />)}</ul>
        </section>
      )}

      {mods.length === 0 && loose.length === 0 && (
        <div className="panel empty">
          <strong>Votre matière est vide</strong>
          Créez directement un CM, TD ou TP, ou ajoutez d’abord un module.
          <button className="btn btn--primary" onClick={() => openNewCm({ subjectId: subject.id })}><Plus /> Première séance</button>
        </div>
      )}

      {mods.map((m) => {
        const list = sessions.filter((s) => s.moduleId === m.id).sort(sortSessions);
        return (
          <section key={m.id} className="module-block" aria-labelledby={`m-${m.id}`}>
            <div className="section-head">
              <div>
                <h2 id={`m-${m.id}`}><Link to={`/modules/${m.id}`}>{m.name}</Link></h2>
                <p className="muted">{list.length} séance{list.length > 1 ? 's' : ''}</p>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Renommer ${m.name}`} onClick={async () => {
                  const name = await promptText({ title: 'Renommer le module', label: 'Nom', initial: m.name });
                  if (name) await renameModule(m.id, name);
                }}><Pencil /></button>
                <button className="btn btn--ghost btn--sm btn--icon" aria-label={`Supprimer ${m.name}`} onClick={async () => {
                  const ok = await confirm({
                    title: `Supprimer « ${m.name} » ?`,
                    message: `Le module et ses ${list.length} séance${list.length > 1 ? 's' : ''} seront supprimés de votre espace synchronisé.`,
                    confirmLabel: 'Supprimer',
                    danger: true,
                  });
                  if (ok) await deleteModule(m.id);
                }}><Trash2 /></button>
                <button className="btn btn--sm" onClick={() => openNewCm({ subjectId: subject.id, moduleId: m.id })}><Plus /> Séance</button>
              </div>
            </div>
            {list.length === 0
              ? <p className="muted" style={{ padding: '8px 0' }}>Aucune séance dans ce module.</p>
              : <ul className="panel rows">{list.map((s) => <SessionRow key={s.id} session={s} showContext={false} />)}</ul>}
          </section>
        );
      })}
    </div>
  );
}
