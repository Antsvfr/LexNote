import { useState } from 'react';
import { ArrowRight, BookOpen, GraduationCap } from 'lucide-react';
import { LogoMark } from '@/components/Logo';
import { useAuth } from '@/store/auth';
import { useLibrary } from '@/store/library';

export function OnboardingPage() {
  const profile = useAuth((s) => s.profile)!;
  const updateProfile = useAuth((s) => s.updateProfile);
  const addSubject = useLibrary((s) => s.addSubject);
  const [firstName, setFirstName] = useState(profile.firstName);
  const [institution, setInstitution] = useState(profile.institution);
  const [academicYear, setAcademicYear] = useState(profile.academicYear);
  const [subject, setSubject] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);

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