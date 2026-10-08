import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { MailCheck, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { AuthLayout, FormError } from './AuthLayout';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message || 'Une erreur est survenue.'); } finally { setBusy(false); }
  }
  return { busy, error, setError, run };
}

function Unconfigured() {
  return (
    <div className="banner banner--warn" role="alert" data-testid="unconfigured">
      <TriangleAlert size={18} aria-hidden />
      <span><strong>LexNote n’est pas encore relié à un projet Supabase.</strong> Ajoutez <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_ANON_KEY</code> (voir <code>.env.example</code> et <code>SUPABASE_SETUP.md</code>) puis relancez.</span>
    </div>
  );
}

/** Redirige hors des pages publiques quand une session existe. */
function useAlreadyIn() {
  const { status } = useAuth();
  const { state } = useLocation();
  return status === 'authenticated' ? ((state as { from?: string } | null)?.from ?? '/') : null;
}

export function LoginPage() {
  const { signIn, status } = useAuth();
  const dest = useAlreadyIn();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const { busy, error, run } = useSubmit();
  if (dest) return <Navigate to={dest} replace />;
  const off = status === 'unconfigured';
  const submit = (e: FormEvent) => { e.preventDefault(); void run(async () => { await signIn(email, password); }); };
  return (
    <AuthLayout title="Content de vous revoir" subtitle="Connectez-vous pour retrouver vos matières et vos séances." footer={<>Pas encore de compte ? <Link to="/signup">Créer un compte</Link></>}>
      {off && <Unconfigured />}
      <form onSubmit={submit} className="authform" noValidate>
        <div className="field"><label htmlFor="email">E-mail</label><input id="email" type="email" autoComplete="email" className="input input--lg" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus data-testid="auth-email" disabled={off} /></div>
        <div className="field"><label htmlFor="password">Mot de passe</label><input id="password" type="password" autoComplete="current-password" className="input input--lg" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="auth-password" disabled={off} /></div>
        <FormError message={error} />
        <button className="btn btn--primary btn--lg" type="submit" disabled={busy || off || !email || !password} data-testid="auth-submit">{busy ? 'Connexion…' : 'Se connecter'}</button>
        <Link className="authform__link" to="/forgot-password">Mot de passe oublié ?</Link>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { signUp, status } = useAuth();
  const dest = useAlreadyIn();
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const { busy, error, setError, run } = useSubmit();
  const [confirm, setConfirm] = useState(false);
  if (dest) return <Navigate to={dest} replace />;
  const off = status === 'unconfigured';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setError('Saisissez une adresse e-mail valide.');
    if (pw.length < 8) return setError('Le mot de passe doit contenir au moins 8 caractères.');
    if (pw !== pw2) return setError('Les deux mots de passe ne correspondent pas.');
    void run(async () => { const r = await signUp(email, pw); if (r.needsConfirmation) setConfirm(true); });
  };
  if (confirm) {
    return (
      <AuthLayout title="Vérifiez vos e-mails" footer={<Link to="/login">Retour à la connexion</Link>}>
        <div className="authsent" data-testid="confirm-sent"><MailCheck size={28} aria-hidden /><p>Un lien de confirmation a été envoyé à <strong>{email}</strong>. Cliquez dessus, puis connectez-vous.</p></div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Créer votre compte" subtitle="Votre espace est strictement personnel." footer={<>Déjà un compte ? <Link to="/login">Se connecter</Link></>}>
      {off && <Unconfigured />}
      <form onSubmit={submit} className="authform" noValidate>
        <div className="field"><label htmlFor="email">E-mail</label><input id="email" type="email" autoComplete="email" className="input input--lg" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus data-testid="auth-email" disabled={off} /></div>
        <div className="field"><label htmlFor="pw">Mot de passe</label><input id="pw" type="password" autoComplete="new-password" className="input input--lg" value={pw} onChange={(e) => setPw(e.target.value)} required data-testid="auth-password" disabled={off} /><small className="muted">8 caractères minimum.</small></div>
        <div className="field"><label htmlFor="pw2">Confirmer le mot de passe</label><input id="pw2" type="password" autoComplete="new-password" className="input input--lg" value={pw2} onChange={(e) => setPw2(e.target.value)} required data-testid="auth-password2" disabled={off} /></div>
        <FormError message={error} />
        <button className="btn btn--primary btn--lg" type="submit" disabled={busy || off || !email || !pw || !pw2} data-testid="auth-submit">{busy ? 'Création…' : 'Créer mon compte'}</button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const { requestPasswordReset, status } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, error, setError, run } = useSubmit();
  const off = status === 'unconfigured';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setError('Saisissez une adresse e-mail valide.');
    void run(async () => { await requestPasswordReset(email); setSent(true); });
  };
  return (
    <AuthLayout title="Mot de passe oublié" subtitle="Nous vous envoyons un lien pour en choisir un nouveau." footer={<Link to="/login">Retour à la connexion</Link>}>
      {off && <Unconfigured />}
      {sent ? (
        // Message identique que l'adresse existe ou non : on ne révèle jamais quels comptes existent.
        <div className="authsent" data-testid="reset-sent"><MailCheck size={28} aria-hidden /><p>Si un compte existe pour <strong>{email}</strong>, un e-mail de réinitialisation vient d’être envoyé.</p></div>
      ) : (
        <form onSubmit={submit} className="authform" noValidate>
          <div className="field"><label htmlFor="email">E-mail</label><input id="email" type="email" autoComplete="email" className="input input--lg" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus data-testid="auth-email" disabled={off} /></div>
          <FormError message={error} />
          <button className="btn btn--primary btn--lg" type="submit" disabled={busy || off || !email} data-testid="auth-submit">{busy ? 'Envoi…' : 'Envoyer le lien'}</button>
        </form>
      )}
    </AuthLayout>
  );
}

/** Page ouverte depuis le lien reçu par e-mail : la session de récupération est déjà établie par le service d'authentification. */
export function ResetPasswordPage() {
  const { updatePassword, status, recovering } = useAuth();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const { busy, error, setError, run } = useSubmit();
  const navigate = useNavigate();
  if (status === 'loading') return null;
  if (status !== 'authenticated' && !recovering) {
    return <AuthLayout title="Lien expiré" footer={<Link to="/forgot-password">Demander un nouveau lien</Link>}><p className="authcard__sub">Ce lien de réinitialisation n’est plus valide.</p></AuthLayout>;
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setError('Le mot de passe doit contenir au moins 8 caractères.');
    if (pw !== pw2) return setError('Les deux mots de passe ne correspondent pas.');
    void run(async () => { await updatePassword(pw); navigate('/', { replace: true }); });
  };
  return (
    <AuthLayout title="Nouveau mot de passe">
      <form onSubmit={submit} className="authform" noValidate>
        <div className="field"><label htmlFor="pw">Nouveau mot de passe</label><input id="pw" type="password" autoComplete="new-password" className="input input--lg" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus data-testid="auth-password" /></div>
        <div className="field"><label htmlFor="pw2">Confirmer</label><input id="pw2" type="password" autoComplete="new-password" className="input input--lg" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="auth-password2" /></div>
        <FormError message={error} />
        <button className="btn btn--primary btn--lg" type="submit" disabled={busy || !pw || !pw2} data-testid="auth-submit">{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </form>
    </AuthLayout>
  );
}
