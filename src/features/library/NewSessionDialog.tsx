import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { todayISO } from '@/lib/dates';
import { nextSessionNumber } from '@/domain/session';
import { SESSION_TYPES, typeLabel, type SessionType } from '@/domain/sessionType';
import { toast } from '@/store/toasts';

const NEW = '__new__';
const NONE = '';

/**
 * « + Nouvelle séance » : un seul moteur pour CM, TD, TP, cours, séminaire…
 * Seuls la matière et le type sont indispensables ; le module, l'heure, l'enseignant et la salle sont facultatifs.
 */
export function NewSessionDialog() {
  const preset = useUI((s) => s.newSession);
  const close = useUI((s) => s.closeNewSession);
  const open = preset !== null;
  const navigate = useNavigate();
  const { subjects, modules, sessions, addSubject, addModule, addSession } = useLibrary();

  const [type, setType] = useState<SessionType>('CM');
  const [subjectId, setSubjectId] = useState('');
  const [moduleId, setModuleId] = useState(NONE);
  const [subjectName, setSubjectName] = useState('');
  const [moduleName, setModuleName] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayISO());
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [teacher, setTeacher] = useState('');
  const [room, setRoom] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const sid = preset?.subjectId ?? (subjects.length === 1 ? subjects[0]!.id : subjects.length ? '' : NEW);
    setType(preset?.type ?? 'CM'); setSubjectId(sid); setModuleId(preset?.moduleId ?? NONE);
    setSubjectName(''); setModuleName(''); setTitle(''); setDate(todayISO()); setStartTime(''); setEndTime('');
    setTeacher(subjects.find((s) => s.id === sid)?.teacher ?? ''); setRoom(''); setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const subjectModules = useMemo(() => modules.filter((m) => m.subjectId === subjectId), [modules, subjectId]);
  const creatingSubject = subjectId === NEW;
  const creatingModule = moduleId === NEW;
  const number = !creatingSubject && subjectId ? nextSessionNumber(sessions, subjectId, type) : 1;
  const valid = !!(creatingSubject ? subjectName.trim() : subjectId) && !(creatingModule && !moduleName.trim()) && !!date;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const sid = creatingSubject ? (await addSubject({ name: subjectName })).id : subjectId;
      const mid = creatingModule ? (await addModule(sid, moduleName)).id : moduleId === NONE ? null : moduleId;
      const s = await addSession({ subjectId: sid, moduleId: mid, type, title, date, startTime, endTime, teacher, room });
      close();
      navigate(`/session/${s.id}`);
    } catch {
      toast.error('Création impossible.');
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open} onClose={close} title="Nouvelle séance" description="CM, TD, TP… choisissez le type puis l'endroit où la ranger." onSubmit={submit}
      footer={<><button type="button" className="btn" onClick={close}>Annuler</button><button type="submit" className="btn btn--primary" disabled={!valid || busy} data-testid="create-session">Commencer</button></>}
    >
      <div className="field">
        <span className="field-label">Type de séance</span>
        <div className="typechips" role="radiogroup" aria-label="Type de séance">
          {SESSION_TYPES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={type === t.id} className={`typechip${type === t.id ? ' is-on' : ''}`} onClick={() => setType(t.id)} data-testid={`type-${t.id}`} title={t.long}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="ns-subject">Matière</label>
        <select id="ns-subject" className="select" value={subjectId} autoFocus={!preset?.subjectId}
          onChange={(e) => { setSubjectId(e.target.value); setModuleId(NONE); setTeacher(subjects.find((s) => s.id === e.target.value)?.teacher ?? ''); }}>
          <option value="" disabled>Choisir…</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value={NEW}>+ Nouvelle matière…</option>
        </select>
        {creatingSubject && <input className="input" aria-label="Nom de la nouvelle matière" placeholder="ex. Droit des contrats" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} autoFocus />}
      </div>

      {subjectId !== '' && (
        <div className="field">
          <label htmlFor="ns-module">Module <span className="muted">(facultatif)</span></label>
          <select id="ns-module" className="select" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
            <option value={NONE}>Aucun module</option>
            {subjectModules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            <option value={NEW}>+ Nouveau module…</option>
          </select>
          {creatingModule && <input className="input" aria-label="Nom du nouveau module" placeholder="ex. Formation du contrat" value={moduleName} onChange={(e) => setModuleName(e.target.value)} autoFocus />}
        </div>
      )}

      <div className="field">
        <label htmlFor="ns-title">Titre {valid && <span className="muted">· {typeLabel(type)} {String(number).padStart(2, '0')}</span>}</label>
        <input id="ns-title" className="input" placeholder="ex. Formation du contrat (modifiable plus tard)" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="session-title" />
      </div>
      <div className="field"><label htmlFor="ns-date">Date</label><input id="ns-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></div>

      <details className="more">
        <summary>Heure, enseignant, salle (facultatif)</summary>
        <div className="more__body">
          <div className="row2">
            <div className="field"><label htmlFor="ns-start">Début</label><input id="ns-start" type="time" className="input" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
            <div className="field"><label htmlFor="ns-end">Fin</label><input id="ns-end" type="time" className="input" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
          </div>
          <div className="row2">
            <div className="field"><label htmlFor="ns-teacher">Enseignant</label><input id="ns-teacher" className="input" value={teacher} onChange={(e) => setTeacher(e.target.value)} /></div>
            <div className="field"><label htmlFor="ns-room">Salle</label><input id="ns-room" className="input" value={room} onChange={(e) => setRoom(e.target.value)} /></div>
          </div>
        </div>
      </details>
    </Modal>
  );
}
