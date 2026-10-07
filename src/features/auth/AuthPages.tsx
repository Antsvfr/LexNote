import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, KeyRound, Mail, UserRound } from 'lucide-react';
import { LogoMark } from '@/components/Logo';
import { useAuth } from '@/store/auth';

type Mode = 'login' | 'signup' | 'forgot' | 'reset';

export function AuthPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (auth.status === 'authenticated' && mode !== 'reset') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }
  if (mode === 'reset' && auth.status !== 'authenticated') return <Navigate to="/login" replace />;

  const title = mode === 'login' ? 'Connexion' : mode === 'signup' ? 'Créer votre compte' : mode === 'forgot' ? 'Mot de passe oublié' : 'Nouveau mot de passe';
  const subtitle = mode === 'login'
    ? 'Retrouvez vos matières, séances et notes sur tous vos appareils.'
    : mode === 'signup'
      ? 'Créez votre espace LexNote personnel.'
      : mode === 'forgot'
        ? 'Nous vous enverrons un lien de réinitialisation.'
        : 'Choisissez un nouveau mot de passe sécurisé.';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    auth.clearMessages();
    if ((mode === 'signup' || mode === 'reset') && password.length < 8) return;
    if ((mode === 'signup' || mode === 'reset') && password !== confirmPassword) return;
    setBusy(true);
    try {
      if (mode === 'login') await auth.signIn(email, password);
      if (mode === 'signup') {
        const result = await auth.signUp(email, password, firstName);
        if (result === 'authenticated') navigate('/');
      }
      if (mode === 'forgot') await auth.sendReset(email);
      if (mode === 'reset') { await auth.updatePassword(password); navigate('/'); }
    } finally {
      setBusy(false);
    }
  }

  const mismatch = (mode === 'signup' || mode === 'reset') && Boolean(confirmPassword) && password !== confirmPassword;

  return (
    <div className="auth">
      <div className="auth__glow" aria-hidden />
      <div className="auth__card">
        <div className="auth__brand">
          <LogoMark className="auth__logo" />
          <div><strong>LexNote</strong><small>Votre espace de cours intelligent</small></div>
        </div>
        <div className="auth__head"><h1>{title}</h1><p>{subtitle}</p></div>

        <form className="auth__form" onSubmit={submit}>
          {mode === 'signup' && (
            <div className="field">
              <label htmlFor="firstName">Prénom</label>
              <div className="auth__input"><UserRound size={17} /><input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required autoComplete="given-name" placeholder="Votre prénom" /></div>
            </div>
          )}
          {mode !== 'reset' && (
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <div className="auth__input"><Mail size={17} /><input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="vous@exemple.fr" /></div>
            </div>
          )}
          {mode !== 'forgot' && (
            <div className="field">
              <label htmlFor="password">Mot de passe</label>
              <div className="auth__input"><KeyRound size={17} /><input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="8 caractères minimum" /></div>
            </div>
          )}
          {(mode === 'signup' || mode === 'reset') && (
            <div className="field">
              <label htmlFor="confirmPassword">Confirmer le mot de passe</label>
              <div className="auth__input"><KeyRound size={17} /><input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} autoComplete="new-password" placeholder="Répétez le mot de passe" /></div>
              {mismatch && <small className="auth__error">Les mots de passe ne correspondent pas.</small>}
            </div>
          )}

          {auth.error && <div className="banner banner--warn" role="alert">{auth.error}</div>}
          {auth.message && <div className="banner" role="status">{auth.message}</div>}

          <button className="btn btn--primary auth__submit" type="submit" disabled={busy || mismatch}>
            {busy ? 'Patientez…' : mode === 'login' ? 'Se connecter' : mode === 'signup' ? 'Créer mon compte' : mode === 'forgot' ? 'Envoyer le lien' : 'Mettre à jour'} {!busy && <ArrowRight size={17} />}
          </button>
        </form>

        <div className="auth__links">
          {mode === 'login' && <><Link to="/forgot-password">Mot de passe oublié ?</Link><span>Pas encore de compte ? <Link to="/signup">Créer un compte</Link></span></>}
          {mode === 'signup' && <span>Déjà un compte ? <Link to="/login">Se connecter</Link></span>}
          {mode === 'forgot' && <Link to="/login">← Retour à la connexion</Link>}
        </div>
        <p className="auth__privacy">Vos notes restent disponibles localement hors ligne. Le cloud sert à les synchroniser entre vos appareils.</p>
      </div>
    </div>
  );
}