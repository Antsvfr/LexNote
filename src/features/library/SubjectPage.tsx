import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { SESSION_TYPES } from '@/domain/sessionType';
import { TypeBadge } from '@/components/TypeBadge';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { SubjectDot } from '@/components/SubjectDot';
import { confirm, promptText } from '@/components/confirm';
import { SessionRow } from './SessionRow';
import { toast } from '@/store/toasts';

export function SubjectPage() {
  const { subjectId } = useParams();
  const navigate = useNavigate();
  const { subjects, modules, sessions, deleteSubject, addModule, renameModule, deleteModule } = useLibrary();
  const openNewSession = useUI((s) => s.openNewSession);
  const openSubjectDialog = useUI((s) => s.openSubjectDialog);
  const [view, setView] = useState<'type' | 'chrono' | 'module'>('type');
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) return <Navigate to="/subjects" replace />;
  const mine = sessions.filter((x) => x.subjectId === subject.id);
  const byDate = (a: { date: string; number: number | null }, b: { date: string; number: number | null }) => a.date.localeCompare(b.date) || (a.number ?? 0) - (b.number ?? 0);
  const mods = modules.filter((m) => m.subjectId === subject.id).sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  async function remove() {
    const n = sessions.filter((s) => s.subjectId === subject!.id).length;
    const ok = await confirm({
      title: `Supprimer « ${subject!.name} » ?`,
      message: `Cette matière, ses modules et ses ${n} séance${n > 1 ? 's' : ''} seront définitivement supprimés de cet appareil.`,
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
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}><SubjectDot color={subject.color} icon={subject.icon} /> {subject.name}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link className="btn btn--sm" to={`/supports?subject=${subject.id}`} data-testid="subject-supports">Supports</Link>
          <button className="btn btn--sm" onClick={() => openSubjectDialog(subject.id)} data-testid="edit-subject"><Pencil /> Modifier</button>
          <button className="btn btn--sm btn--danger" onClick={remove}><Trash2 /> Supprimer</button>
          <button className="btn btn--sm" onClick={newModule} data-testid="new-module"><Plus /> Module</button>
          <button className="btn btn--sm btn--primary" onClick={() => openNewSession({ subjectId: subject.id })} data-testid="subject-new-session"><Plus /> Séance</button>
        </div>
      </header>

      {mine.length === 0 && mods.length === 0 && <div className="panel empty" data-testid="subject-empty"><strong>Aucune séance</strong>Créez un CM, un TD, un TP… ou une séance libre pour cette matière.</div>}

      {(mine.length > 0 || mods.length > 0) && (
        <div className="tabs" role="tablist" aria-label="Affichage" style={{ marginBottom: 14 }}>
          {([['type', 'Par type'], ['chrono', 'Chronologique'], ['module', 'Par module']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'is-on' : ''} onClick={() => setView(id)} data-testid={`view-${id}`}>{label}</button>
          ))}
        </div>
      )}

      {view === 'type' && SESSION_TYPES.map((t) => {
        const list = mine.filter((x) => x.type === t.id).sort(byDate);
        if (!list.length) return null;
        return (
          <section key={t.id} className="module-block" aria-label={t.long} data-testid={`group-${t.id}`}>
            <div className="section-head"><h2 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><TypeBadge type={t.id} /> {t.long} <span className="muted">· {list.length}</span></h2></div>
            <ul className="panel rows">{list.map((x) => <SessionRow key={x.id} session={x} />)}</ul>
          </section>
        );
      })}

      {view === 'chrono' && mine.length > 0 && <ul className="panel rows">{[...mine].sort(byDate).map((x) => <SessionRow key={x.id} session={x} />)}</ul>}

      {view === 'module' && (
        <>
          {mods.length === 0 && <p className="muted">Aucun module : les modules sont facultatifs. Ajoutez-en pour regrouper vos séances.</p>}
          {mods.map((m) => {
            const list = mine.filter((x) => x.moduleId === m.id).sort(byDate);
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
                      const ok = await confirm({ title: `Supprimer « ${m.name} » ?`, message: `Le module sera supprimé ; ses ${list.length} séance(s) sont conservées, sans module.`, confirmLabel: 'Supprimer', danger: true });
                      if (ok) await deleteModule(m.id);
                    }}><Trash2 /></button>
                    <button className="btn btn--sm" onClick={() => openNewSession({ subjectId: subject.id, moduleId: m.id })}><Plus /> Séance</button>
                  </div>
                </div>
                {list.length === 0 ? <p className="muted" style={{ padding: '8px 0' }}>Aucune séance dans ce module.</p> : <ul className="panel rows">{list.map((x) => <SessionRow key={x.id} session={x} showContext={false} />)}</ul>}
              </section>
            );
          })}
          {mine.some((x) => !x.moduleId) && (
            <section className="module-block" aria-label="Sans module">
              <div className="section-head"><h2>Sans module</h2></div>
              <ul className="panel rows">{mine.filter((x) => !x.moduleId).sort(byDate).map((x) => <SessionRow key={x.id} session={x} />)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
