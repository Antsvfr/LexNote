import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Link2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { getBackend } from '@/services/backend';
import type { IntegrationFailureBody } from '@/services/integration/types';
import { useAuth } from '@/store/auth';
import { readDevice, setRemember } from '@/services/auth/device';
import { errorCodeLabel, errorText } from './useConnection';
import { clearPending, readPending } from './pending';

/** Erreurs qui ne consomment PAS la demande : le nonce reste utilisable (reconnexion, réseau, panne passagère). */
const KEEP_PENDING = new Set(['SESSION_REQUIRED', 'OFFLINE', 'UNAVAILABLE', 'TIMEOUT', 'PEER_AUTH_FAILED', 'RATE_LIMITED']);

const safeReturn = (u: string | undefined): string | null => {
  try { const x = new URL(u ?? ''); return x.protocol === 'https:' || (x.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(x.hostname)) ? x.toString() : null; } catch { return null; }
};

/** Page d'autorisation (derrière la connexion LexNote) : « REV-EM souhaite être connecté à votre compte LexNote. » */
export function AuthorizeRevem() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const intent = params.get('intent') ?? '';
  const pending = useMemo(() => readPending(intent), [intent]);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<IntegrationFailureBody | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ returnUrl: string | null; autoLogin: boolean } | null>(null);
  // Choix EXPLICITES de l'étudiant : relier (obligatoire pour autoriser), rester connecté, connexion automatique (jamais cochée d'office).
  const [linkAccounts, setLinkAccounts] = useState(true);
  const [stay, setStay] = useState(() => readDevice().remember);
  const [autoLogin, setAutoLogin] = useState(false);
  const sessionLost = useAuth((s) => s.sessionLost);
  // Session LexNote réellement perdue : retour à la connexion ; la demande (nonce en sessionStorage, ≤ 10 min) est reprise ensuite.
  useEffect(() => { if (error?.code === 'SESSION_REQUIRED') void sessionLost(); }, [error, sessionLost]);

  // Vérifie la demande SANS la consommer, pour que l'étudiant reconnaisse son propre compte REV-EM avant d'autoriser.
  useEffect(() => {
    if (!pending) return;
    let live = true;
    void getBackend().then((b) => b.integration.call('inspect', { linkIntentId: pending.intent, nonce: pending.nonce })).then((r) => {
      if (!live) return; if (r.ok) setHint(r.displayHint ?? ''); else setError(r.error);
    });
    return () => { live = false; };
  }, [pending]);

  if (!pending && !done) return <Navigate to="/settings" replace />;

  async function authorize() {
    if (!pending) return;
    setBusy(true); setError(null);
    setRemember(stay);                                // préférence de CET appareil (aucun secret) ; appliquée à la prochaine réouverture du navigateur
    const r = await (await getBackend()).integration.call('confirm', { linkIntentId: pending.intent, nonce: pending.nonce, autoLogin });
    setBusy(false);
    // Le nonce est à usage unique : effacé dès qu'il a été présenté au serveur — sauf si la demande n'a pas pu être traitée (session, réseau).
    if (r.ok || !KEEP_PENDING.has(r.error.code)) clearPending();
    if (r.ok) setDone({ returnUrl: safeReturn(r.returnUrl), autoLogin: r.state?.autoLogin === true }); else setError(r.error);
  }
  function cancel() { clearPending(); navigate('/settings', { replace: true }); }

  return (
    <div className="page page-enter" data-testid="authorize-revem">
      <div className="authorize panel">
        <span className="authorize__icon" aria-hidden><Link2 size={22} /></span>
        {done ? (
          <>
            <h1><CheckCircle2 size={22} aria-hidden /> REV-EM est connecté</h1>
            <p className="muted" data-testid="authorize-done">Vos comptes sont reliés. Vous pouvez revenir dans REV-EM : il affichera « LexNote ✓ Connecté ».</p>
            <p className="muted" data-testid="authorize-done-auto">{done.autoLogin
              ? 'Connexion automatique activée : depuis REV-EM, LexNote s’ouvrira sans mot de passe. Vous pouvez la désactiver dans Réglages › Applications connectées.'
              : 'Connexion automatique non activée : LexNote vous demandera de vous connecter si votre session n’est plus ouverte.'}</p>
            <div className="row-actions">
              {done.returnUrl && <a className="btn btn--primary" href={done.returnUrl} data-testid="authorize-return">Retourner dans REV-EM</a>}
              <Link className="btn" to="/settings">Ouvrir les Réglages</Link>
            </div>
          </>
        ) : (
          <>
            <h1>REV-EM souhaite être connecté à votre compte LexNote.</h1>
            {hint !== null && !error && <p className="muted" data-testid="authorize-hint">Demande initiée depuis le compte REV-EM <strong>« {hint || 'sans nom'} »</strong>. Si ce n’est pas vous, annulez.</p>}
            <ul className="authorize__list">
              <li><ShieldCheck size={15} aria-hidden /> Les deux comptes restent <strong>indépendants</strong> : rien n’est fusionné.</li>
              <li><ShieldCheck size={15} aria-hidden /> Aucun mot de passe, jeton ni e-mail n’est partagé.</li>
              <li><ShieldCheck size={15} aria-hidden /> Vos notes, transcriptions et fichiers audio ne sont <strong>jamais</strong> transmis.</li>
              <li><ShieldCheck size={15} aria-hidden /> Vous pouvez déconnecter à tout moment, ici ou dans REV-EM.</li>
            </ul>
            <fieldset className="authorize__choices" disabled={busy}>
              <legend className="sr-only">Vos choix</legend>
              <label className="check"><input type="checkbox" checked={linkAccounts} onChange={(e) => setLinkAccounts(e.target.checked)} data-testid="authorize-link" />
                <span><strong>Relier mes comptes REV-EM et LexNote</strong><small>La liaison est enregistrée dans le cloud : vous n’aurez plus à la refaire, sur aucun appareil.</small></span></label>
              <label className="check"><input type="checkbox" checked={stay} onChange={(e) => setStay(e.target.checked)} data-testid="authorize-stay" />
                <span><strong>Rester connecté sur cet appareil</strong><small>LexNote conservera votre session sur cet appareil afin de vous reconnecter automatiquement. N’utilisez pas cette option sur un appareil partagé.</small></span></label>
              <label className="check"><input type="checkbox" checked={autoLogin} onChange={(e) => setAutoLogin(e.target.checked)} data-testid="authorize-auto" />
                <span><strong>Autoriser REV-EM à me reconnecter automatiquement à LexNote</strong><small>Lorsque vous êtes connecté à votre compte REV-EM, vous pourrez ouvrir LexNote sans ressaisir votre mot de passe sur les appareils autorisés. Vous pourrez désactiver cette autorisation à tout moment.</small></span></label>
            </fieldset>
            {error && <div className="banner banner--warn" role="alert" data-testid="authorize-error"><TriangleAlert size={16} aria-hidden /> <span>{errorText(error)} <small className="muted" data-testid="authorize-error-code">Code : {errorCodeLabel(error)}</small></span></div>}
            <div className="row-actions">
              <button className="btn btn--primary" onClick={authorize} disabled={busy || !linkAccounts || (!!error && !error.retryable)} data-testid="authorize-accept">{busy ? 'Connexion…' : 'Autoriser'}</button>
              <button className="btn" onClick={cancel} disabled={busy} data-testid="authorize-cancel">Annuler</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
