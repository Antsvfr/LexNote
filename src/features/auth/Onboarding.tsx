import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, GraduationCap, School, Library as LibraryIcon, Sparkles } from 'lucide-react';
import { LogoMark } from '@/components/Logo';
import { useAuth } from '@/store/auth';
import { useLibrary } from '@/store/library';
import { toast } from '@/store/toasts';
import { requestSync } from '@/services/workspace';

const USAGES = [
  { id: 'university', label: 'Université', icon: GraduationCap },
  { id: 'school', label: 'École', icon: School },
  { id: 'prepa', label: 'Prépa', icon: LibraryIcon },
  { id: 'other', label: 'Autre', icon: Sparkles },
] as const;

/** 3 écrans, moins d'une minute : bienvenue (prénom) → usage (facultatif) → première matière. Aucune donnée fictive créée. */
export function OnboardingPage() {
  const navigate = useNavigate();
  const { profile, updateProfile } = useAuth();
  const addSubject = useLibrary((s) => s.addSubject);
  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState(profile?.firstName ?? '');
  const [institution, setInstitution] = useState(profile?.institution ?? '');
  const [year, setYear] = useState(profile?.academicYear ?? '');
  const [usage, setUsage] = useState(profile?.usageType ?? '');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);

  async function finish(withSubject: boolean) {
    setBusy(true);
    try {
      if (withSubject && subject.trim()) await addSubject({ name: subject });
      await updateProfile({ firstName, institution, academicYear: year, usageType: usage, onboardingCompleted: true }).catch(() => toast.error('Profil enregistré sur cet appareil ; il sera envoyé dès que possible.'));
      requestSync(300);
      navigate('/', { replace: true });
    } finally { setBusy(false); }
  }

  return (
    <div className="authpage">
      <div className="authpage__col">
        <header className="authpage__brand"><LogoMark className="brand__mark" /><div className="brand__text"><strong>LexNote</strong><small>Notes · CM · Droit</small></div></header>
        <main className="authcard authcard--wide" aria-labelledby="ob-title" data-testid={`onboarding-step-${step}`}>
          <div className="stepper" aria-label={`Étape ${step} sur 3`}>{[1, 2, 3].map((n) => <span key={n} className={n <= step ? 'is-on' : ''} />)}</div>
          {step === 1 && (
            <>
              <h1 id="ob-title">Bienvenue sur LexNote.</h1>
              <p className="authcard__sub">Comment doit-on vous appeler ? Le reste est facultatif.</p>
              <form className="authform" onSubmit={(e) => { e.preventDefault(); setStep(2); }}>
                <div className="field"><label htmlFor="fn">Prénom</label><input id="fn" className="input input--lg" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus maxLength={60} data-testid="ob-firstname" /></div>
                <div className="row2">
                  <div className="field"><label htmlFor="inst">Établissement <span className="muted">(facultatif)</span></label><input id="inst" className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} maxLength={120} /></div>
                  <div className="field"><label htmlFor="yr">Année / niveau <span className="muted">(facultatif)</span></label><input id="yr" className="input" value={year} onChange={(e) => setYear(e.target.value)} maxLength={60} placeholder="ex. L2" /></div>
                </div>
                <button className="btn btn--primary btn--lg" type="submit" data-testid="ob-next">Continuer <ArrowRight /></button>
              </form>
            </>
          )}
          {step === 2 && (
            <>
              <h1 id="ob-title">Comment souhaitez-vous utiliser LexNote ?</h1>
              <p className="authcard__sub">Facultatif — cela nous aide à adapter les prochaines versions.</p>
              <div className="usegrid" role="radiogroup" aria-label="Usage">
                {USAGES.map(({ id, label, icon: Icon }) => (
                  <button key={id} type="button" role="radio" aria-checked={usage === id} className={`usecard${usage === id ? ' is-on' : ''}`} onClick={() => setUsage(id)} data-testid={`ob-usage-${id}`}><Icon size={22} aria-hidden />{label}</button>
                ))}
              </div>
              <div className="authform__row"><button className="btn btn--ghost" onClick={() => setStep(1)}>Retour</button><button className="btn btn--primary btn--lg" onClick={() => setStep(3)} data-testid="ob-next">{usage ? 'Continuer' : 'Passer'} <ArrowRight /></button></div>
            </>
          )}
          {step === 3 && (
            <>
              <h1 id="ob-title">Créez votre première matière</h1>
              <p className="authcard__sub">Par exemple « Droit des contrats ». Vous ajouterez vos CM, TD et TP ensuite.</p>
              <form className="authform" onSubmit={(e) => { e.preventDefault(); void finish(true); }}>
                <div className="field"><label htmlFor="subj">Nom de la matière</label><input id="subj" className="input input--lg" value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus maxLength={160} placeholder="ex. Droit" data-testid="ob-subject" /></div>
                <div className="authform__row">
                  <button type="button" className="btn btn--ghost" onClick={() => void finish(false)} disabled={busy} data-testid="ob-skip">Passer cette étape</button>
                  <button className="btn btn--primary btn--lg" type="submit" disabled={busy || !subject.trim()} data-testid="ob-finish">Créer et commencer</button>
                </div>
              </form>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
