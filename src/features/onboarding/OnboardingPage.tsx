import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Download, GraduationCap } from 'lucide-react';
import { LogoMark } from '@/components/Logo';
import { useAuth } from '@/store/auth';
import { useLibrary } from '@/store/library';
import { getStorage } from '@/bootstrap';
import {
  getLegacyImportPreview,
  ignoreLegacyData,
  importLegacyData,
  type LegacyImportPreview,
} from '@/services/migration/legacy';

export function OnboardingPage() {
  const session = useAuth((s) => s.session)!;
  const profile = useAuth((s) => s.profile)!;
  const updateProfile = useAuth((s) => s.updateProfile);
  const addSubject = useLibrary((s) => s.addSubject);
  const reload = useLibrary((s) => s.reload);
  const [firstName, setFirstName] = useState(profile.firstName);
  const [institution, setInstitution] = useState(profile.institution);
  const [academicYear, setAcademicYear] = useState(profile.academicYear);
  const [subject, setSubject] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [legacy, setLegacy] = useState<LegacyImportPreview | null>(null);

  useEffect(() => {
    let live = true;
    void getLegacyImportPreview(session.user.id)
      .then((preview) => { if (live) setLegacy(preview); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [session.user.id]);

  async function next() {
    if (!firstName.trim()) return;
    await updateProfile({ firstName, institution, academicYear });
    setStep(2);
  }

  async function finish() {
    if (!subject.trim() || busy) return;
    setBusy(true);
    try {
      await addSubject(subject);
      await updateProfile({ onboardingCompleted: true });
    } finally {
      setBusy(false);
    }
  }

  async function importOld() {
    if (busy) return;
    setBusy(true);
    try {
      await importLegacyData(session.user.id, getStorage());
      await reload();
      await updateProfile({ onboardingCompleted: true });
    } finally {
      setBusy(false);
    }
  }

  async function ignoreOld() {
    await ignoreLegacyData(session.user.id);
    setLegacy(null);
  }

  return (
    <div className="auth onboarding">
      <div className="auth__glow" aria-hidden />
      <div className="auth__card auth__card--wide">
        <div className="auth__brand"><LogoMark className="auth__logo" /><div><strong>LexNote</strong><small>Configuration de votre espace</small></div></div>
        <div className="onboarding__steps"><span className="is-on">1</span><i /><span className={step === 2 ? 'is-on' : ''}>2</span></div>

        {step === 1 ? (
          <>
            <div className="auth__head"><h1>Bienvenue sur LexNote</h1><p>Quelques informations suffisent pour personnaliser votre espace.</p></div>
            <div className="auth__form">
              <div className="field"><label>Prénom</label><input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus /></div>
              <div className="field"><label>Établissement <span className="muted">· facultatif</span></label><div className="auth__input"><GraduationCap size={17} /><input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="ex. emlyon business school" /></div></div>
              <div className="field"><label>Année / niveau <span className="muted">· facultatif</span></label><input className="input" value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} placeholder="ex. BBA 1" /></div>
              <button className="btn btn--primary auth__submit" onClick={() => void next()} disabled={!firstName.trim()}>Continuer <ArrowRight size={17} /></button>
            </div>
          </>
        ) : legacy ? (
          <>
            <div className="auth__head"><h1>Anciennes notes détectées</h1><p>LexNote a trouvé des données créées avant l’arrivée des comptes. Elles ne seront jamais attribuées à votre compte sans votre accord.</p></div>
            <div className="onboarding__subject">
              <Download size={24} />
              <div>
                <strong>{legacy.sessions} séance{legacy.sessions > 1 ? 's' : ''} à importer</strong>
                <small>{legacy.subjects} matière{legacy.subjects > 1 ? 's' : ''} · {legacy.notes} note{legacy.notes > 1 ? 's' : ''}. Les données de démonstration pures sont exclues.</small>
              </div>
            </div>
            <div className="auth__form" style={{ marginTop: 16 }}>
              <button className="btn btn--primary auth__submit" onClick={() => void importOld()} disabled={busy}>{busy ? 'Import…' : 'Importer dans mon compte'} {!busy && <ArrowRight size={17} />}</button>
              <button className="btn" onClick={() => void ignoreOld()} disabled={busy}>Ignorer et repartir de zéro</button>
            </div>
          </>
        ) : (
          <>
            <div className="auth__head"><h1>Créez votre première matière</h1><p>Votre tableau de bord part de zéro : aucune donnée de démonstration n’est ajoutée.</p></div>
            <div className="auth__form">
              <div className="onboarding__subject"><BookOpen size={24} /><div><strong>Première matière</strong><small>Vous pourrez en créer autant que nécessaire ensuite.</small></div></div>
              <div className="field"><label>Nom de la matière</label><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus placeholder="ex. Droit, Finance, Marketing…" /></div>
              <button className="btn btn--primary auth__submit" onClick={() => void finish()} disabled={!subject.trim() || busy}>{busy ? 'Création…' : 'Entrer dans LexNote'} {!busy && <ArrowRight size={17} />}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
