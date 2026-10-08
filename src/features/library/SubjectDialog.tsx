import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { useLibrary } from '@/store/library';
import { useUI } from '@/store/ui';
import { SUBJECT_COLORS, nextSubjectColor } from '@/lib/palette';
import { SUBJECT_ICONS, SUBJECT_ICON_KEYS } from '@/lib/subjectIcons';
import { toast } from '@/store/toasts';

/** Création / modification d'une matière : un seul champ obligatoire (le nom), le reste est facultatif. */
export function SubjectDialog() {
  const dlg = useUI((s) => s.subjectDialog);
  const close = useUI((s) => s.closeSubjectDialog);
  const { subjects, addSubject, updateSubject } = useLibrary();
  const editing = dlg?.id ? subjects.find((s) => s.id === dlg.id) : undefined;
  const open = dlg !== null;

  const [name, setName] = useState('');
  const [color, setColor] = useState('indigo');
  const [icon, setIcon] = useState('');
  const [term, setTerm] = useState('');
  const [teacher, setTeacher] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? ''); setColor(editing?.color ?? nextSubjectColor(subjects.map((s) => s.color))); setIcon(editing?.icon ?? '');
    setTerm(editing?.term ?? ''); setTeacher(editing?.teacher ?? ''); setDescription(editing?.description ?? ''); setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dlg?.id]);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const patch = { name, color, icon: icon || undefined, term, teacher, description };
      if (editing) await updateSubject(editing.id, { ...patch, icon: icon || undefined });
      else await addSubject(patch);
      toast.success(editing ? 'Matière modifiée.' : `Matière « ${name.trim()} » créée.`);
      close();
    } catch { setBusy(false); }
  }

  return (
    <Modal
      open={open} onClose={close} title={editing ? 'Modifier la matière' : 'Nouvelle matière'} onSubmit={submit}
      footer={<><button type="button" className="btn" onClick={close}>Annuler</button><button type="submit" className="btn btn--primary" disabled={!name.trim() || busy} data-testid="subject-save">{editing ? 'Enregistrer' : 'Créer la matière'}</button></>}
    >
      <div className="field">
        <label htmlFor="sub-name">Nom de la matière *</label>
        <input id="sub-name" className="input" value={name} maxLength={160} autoFocus placeholder="ex. Droit des contrats" onChange={(e) => setName(e.target.value)} data-testid="subject-name" />
      </div>
      <div className="field">
        <span className="field-label">Couleur</span>
        <div className="swatches" role="radiogroup" aria-label="Couleur">
          {SUBJECT_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className={`swatch${color === c ? ' is-on' : ''}`} style={{ ['--sw' as string]: `var(--c-${c})` }} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Icône (facultatif)</span>
        <div className="swatches" role="radiogroup" aria-label="Icône">
          <button type="button" role="radio" aria-checked={!icon} className={`iconpick${!icon ? ' is-on' : ''}`} onClick={() => setIcon('')} aria-label="Aucune icône">·</button>
          {SUBJECT_ICON_KEYS.map((k) => { const I = SUBJECT_ICONS[k]!.Icon; return (
            <button key={k} type="button" role="radio" aria-checked={icon === k} aria-label={SUBJECT_ICONS[k]!.label} title={SUBJECT_ICONS[k]!.label} className={`iconpick${icon === k ? ' is-on' : ''}`} onClick={() => setIcon(k)}><I size={16} /></button>
          ); })}
        </div>
      </div>
      <details className="more" open={!!(editing?.term || editing?.teacher || editing?.description)}>
        <summary>Plus de détails (facultatif)</summary>
        <div className="more__body">
          <div className="field"><label htmlFor="sub-term">Année / semestre</label><input id="sub-term" className="input" value={term} placeholder="ex. L2 · S3" onChange={(e) => setTerm(e.target.value)} /></div>
          <div className="field"><label htmlFor="sub-teacher">Enseignant</label><input id="sub-teacher" className="input" value={teacher} onChange={(e) => setTeacher(e.target.value)} /></div>
          <div className="field"><label htmlFor="sub-desc">Description</label><input id="sub-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        </div>
      </details>
    </Modal>
  );
}
