import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Link2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { getBackend } from '@/services/backend';
import type { IntegrationFailureBody } from '@/services/integration/types';
import { errorText } from './useConnection';
import { clearPending, readPending } from './pending';

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
  const [done, setDone] = useState<{ returnUrl: string | null } | null>(null);

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
    const r = await (await getBackend()).integration.call('confirm', { linkIntentId: pending.intent, nonce: pending.nonce });
    setBusy(false);
    clearPending();                                   // le nonce est à usage unique : inutile de le garder, succès ou non
    if (r.ok) setDone({ returnUrl: safeReturn(r.returnUrl) }); else setError(r.error);
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
            {error && <div className="banner banner--warn" role="alert" data-testid="authorize-error"><TriangleAlert size={16} aria-hidden /> {errorText(error)}</div>}
            <div className="row-actions">
              <button className="btn btn--primary" onClick={authorize} disabled={busy || (!!error && !error.retryable)} data-testid="authorize-accept">{busy ? 'Connexion…' : 'Autoriser'}</button>
              <button className="btn" onClick={cancel} disabled={busy} data-testid="authorize-cancel">Annuler</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
