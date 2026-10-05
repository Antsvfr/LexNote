import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { todayISO } from '@/lib/dates';
import { nextSessionNumber } from '@/domain/session';
import { toast } from '@/store/toasts';

const NEW = '__new__';

export function NewCmDialog() {
  const preset = useUI((s) => s.newCm);
  const close = useUI((s) => s.closeNewCm);
  const open = preset !== null;
  const navigate = useNavigate();
  const { subjects, modules, sessions, addSubject, addModule, addSession } = useLibrary();

  const [subjectId, setSubjectId] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [subjectName, setSubjectName] = useState('');
  const [moduleName, setModuleName] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  // Réinitialise le formulaire à chaque ouverture (avec présélection éventuelle).
  useEffect(() => {
    if (!open) return;
    const sid = preset?.subjectId ?? (subjects.length ? '' : NEW);
    setSubjectId(sid);
    setModuleId(preset?.moduleId ?? '');
    setSubjectName(''); setModuleName(''); setTitle(''); setDate(todayISO()); setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const subjectModules = useMemo(() => modules.filter((m) => m.subjectId === subjectId), [modules, subjectId]);
  const creatingSubject = subjectId === NEW;
  const creatingModule = creatingSubject || moduleId === NEW || (subjectId !== '' && subjectModules.length === 0);

  const effectiveModuleId = creatingModule ? NEW : moduleId;
  const number = effectiveModuleId && effectiveModuleId !== NEW ? nextSessionNumber(sessions, effectiveModuleId) : 1;

  const valid =
    (creatingSubject ? subjectName.trim() : subjectId) &&
    (creatingModule ? moduleName.trim() : moduleId) &&
    date;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const sid = creatingSubject ? (await addSubject(subjectName)).id : subjectId;
      const mid = creatingModule ? (await addModule(sid, moduleName)).id : moduleId;
      const s = await addSession({ subjectId: sid, moduleId: mid, title, date });
      close();
      navigate(`/session/${s.id}`);
    } catch {
      toast.error('Création impossible.');
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Nouveau CM"
      description="Choisissez où ranger cette séance, puis commencez à écrire."
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn--primary" disabled={!valid || busy} data-testid="create-cm">Commencer</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="cm-subject">Matière</label>
        <select id="cm-subject" className="select" value={subjectId} autoFocus={!preset?.subjectId}
          onChange={(e) => { setSubjectId(e.target.value); setModuleId(''); }}>
          <option value="" disabled>Choisir…</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value={NEW}>+ Nouvelle matière…</option>
        </select>
        {creatingSubject && (
          <input className="input" aria-label="Nom de la nouvelle matière" placeholder="ex. Droit" value={subjectName}
            onChange={(e) => setSubjectName(e.target.value)} autoFocus />
        )}
      </div>

      {subjectId !== '' && (
        <div className="field">
          <label htmlFor="cm-module">Module / cours</label>
          {!creatingSubject && subjectModules.length > 0 && (
            <select id="cm-module" className="select" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
              <option value="" disabled>Choisir…</option>
              {subjectModules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              <option value={NEW}>+ Nouveau module…</option>
            </select>
          )}
          {creatingModule && (
            <input id="cm-module" className="input" aria-label="Nom du nouveau module" placeholder="ex. Droit des contrats"
              value={moduleName} onChange={(e) => setModuleName(e.target.value)} />
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor="cm-title">Titre {valid && <span className="muted">· CM {String(number).padStart(2, '0')}</span>}</label>
        <input id="cm-title" className="input" placeholder="ex. Formation du contrat (modifiable plus tard)" value={title}
          onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="cm-date">Date</label>
        <input id="cm-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
    </Modal>
  );
}
