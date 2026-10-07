import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { todayISO } from '@/lib/dates';
import { nextSessionNumber, SESSION_TYPE_OPTIONS } from '@/domain/session';
import type { SessionType } from '@/domain/types';
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
  const [type, setType] = useState<SessionType>('CM');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [teacher, setTeacher] = useState('');
  const [room, setRoom] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const sid = preset?.subjectId ?? (subjects.length ? '' : NEW);
    setSubjectId(sid);
    setModuleId(preset?.moduleId ?? '');
    setSubjectName('');
    setModuleName('');
    setType('CM');
    setTitle('');
    setDate(todayISO());
    setStartTime('');
    setEndTime('');
    setTeacher('');
    setRoom('');
    setBusy(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const subjectModules = useMemo(() => modules.filter((m) => m.subjectId === subjectId), [modules, subjectId]);
  const creatingSubject = subjectId === NEW;
  const creatingModule = moduleId === NEW;
  const numbered = ['CM', 'TD', 'TP'].includes(type);
  const number = numbered ? nextSessionNumber(sessions, creatingModule ? undefined : moduleId || undefined, type) : null;

  const valid = (creatingSubject ? subjectName.trim() : subjectId) && date;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const sid = creatingSubject ? (await addSubject(subjectName)).id : subjectId;
      let mid = moduleId;
      if (creatingModule && moduleName.trim()) mid = (await addModule(sid, moduleName)).id;
      const s = await addSession({
        subjectId: sid,
        moduleId: mid || undefined,
        type,
        title,
        date,
        number,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        teacher: teacher || undefined,
        room: room || undefined,
      });
      close();
      navigate('/session/' + s.id);
    } catch {
      toast.error('Création impossible.');
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Nouvelle séance"
      description="Créez un CM, TD, TP ou une autre séance et commencez immédiatement à écrire."
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="btn" onClick={close}>Annuler</button>
          <button type="submit" className="btn btn--primary" disabled={!valid || busy} data-testid="create-cm">Commencer</button>
        </>
      }
    >
      <div className="field">
        <label>Type de séance</label>
        <div className="chips">
          {SESSION_TYPE_OPTIONS.map((o) => (
            <button type="button" key={o.id} className={'chip' + (type === o.id ? ' is-on' : '')} onClick={() => setType(o.id)}>{o.label}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="cm-subject">Matière</label>
        <select id="cm-subject" className="select" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setModuleId(''); }}>
          <option value="" disabled>Choisir…</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value={NEW}>+ Nouvelle matière…</option>
        </select>
        {creatingSubject && <input className="input" aria-label="Nom de la nouvelle matière" placeholder="ex. Droit" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} autoFocus />}
      </div>

      {!creatingSubject && subjectId && (
        <div className="field">
          <label htmlFor="cm-module">Module <span className="muted">· facultatif</span></label>
          <select id="cm-module" className="select" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
            <option value="">Sans module</option>
            {subjectModules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            <option value={NEW}>+ Nouveau module…</option>
          </select>
          {creatingModule && <input className="input" placeholder="ex. Droit des contrats" value={moduleName} onChange={(e) => setModuleName(e.target.value)} />}
        </div>
      )}

      <div className="field">
        <label htmlFor="cm-title">Titre {number != null && <span className="muted">· {type} {String(number).padStart(2, '0')}</span>}</label>
        <input id="cm-title" className="input" placeholder="ex. Vices du consentement" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="field"><label htmlFor="cm-date">Date</label><input id="cm-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div className="auth-grid">
        <div className="field"><label>Début <span className="muted">· facultatif</span></label><input type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
        <div className="field"><label>Fin <span className="muted">· facultatif</span></label><input type="time" className="input" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
      </div>
      <div className="auth-grid">
        <div className="field"><label>Enseignant <span className="muted">· facultatif</span></label><input className="input" value={teacher} onChange={(e) => setTeacher(e.target.value)} /></div>
        <div className="field"><label>Salle <span className="muted">· facultatif</span></label><input className="input" value={room} onChange={(e) => setRoom(e.target.value)} /></div>
      </div>
    </Modal>
  );
}
