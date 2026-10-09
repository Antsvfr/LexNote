import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Link2, Loader2, TriangleAlert } from 'lucide-react';
import { getBackend } from '@/services/backend';
import { syncNow } from '@/services/workspace';
import { useLibrary } from '@/store/library';
import type { IntegrationFailureBody } from '@/services/integration/types';
import { clearPendingLaunch, readLaunchResult, readPendingLaunch, saveLaunchResult } from './launchPending';

const LINK_CODES = new Set(['LINK_NOT_FOUND', 'LINK_REVOKED', 'LINK_PENDING']);
const TEXT: Record<string, string> = {
  LINK_NOT_FOUND: 'REV-EM n’est pas connecté à votre compte LexNote. Connectez-le d’abord, puis relancez « Prendre mes notes » depuis REV-EM.',
  LINK_REVOKED: 'La connexion avec REV-EM a été interrompue. Reconnectez REV-EM, puis relancez depuis le planning.',
  LINK_PENDING: 'La connexion avec REV-EM n’est pas terminée. Terminez-la, puis relancez depuis le planning.',
  LINK_EXPIRED: 'Cette ouverture a expiré (elle ne reste valable que quelques minutes). Retournez dans REV-EM et cliquez de nouveau sur « Prendre mes notes dans LexNote ».',
  GONE: 'Cette ouverture a déjà été utilisée ou le cours est annulé. Retournez dans REV-EM et cliquez de nouveau sur « Prendre mes notes dans LexNote ».',
  NOT_FOUND: 'Cette ouverture est introuvable. Retournez dans REV-EM et cliquez de nouveau sur « Prendre mes notes dans LexNote ».',
  FORBIDDEN: 'Cette ouverture n’est pas valide pour ce compte. Retournez dans REV-EM et recommencez.',
  UNAUTHENTICATED: 'Votre session LexNote a expiré. Reconnectez-vous, puis relancez depuis REV-EM.',
  RATE_LIMITED: 'Trop de tentatives. Patientez un instant puis réessayez.',
  UNAVAILABLE: 'LexNote ou REV-EM est momentanément injoignable. Vérifiez votre connexion puis réessayez.',
  TIMEOUT: 'REV-EM ne répond pas. Réessayez dans un instant.',
};
const errorText = (e: IntegrationFailureBody) => TEXT[e.code] ?? 'Le cours n’a pas pu être ouvert. Réessayez depuis REV-EM.';

/** Une seule exécution par intention (React StrictMode, double montage, double clic) : l'intention est à USAGE UNIQUE. */
const inflight = new Map<string, Promise<{ ok: true; sessionId: string } | { ok: false; error: IntegrationFailureBody }>>();
function openOnce(intent: string, nonce: string) {
  let p = inflight.get(intent);
  if (!p) {
    p = getBackend().then((b) => b.integration.call('launch-open', { launchIntentId: intent, nonce })).then((r) => {
      if (r.ok && r.sessionId) { saveLaunchResult(intent, r.sessionId); clearPendingLaunch(); return { ok: true as const, sessionId: r.sessionId }; }
      clearPendingLaunch();                         // l'intention est consommée ou invalide : inutile de la garder
      return { ok: false as const, error: r.ok ? { code: 'INTERNAL', message: '', retryable: false } : r.error };
    }).catch(() => ({ ok: false as const, error: { code: 'UNAVAILABLE', message: '', retryable: true } }));
    inflight.set(intent, p);
  }
  return p;
}

/** La séance est créée côté serveur : on attend qu'elle soit présente sur CET appareil (le moteur de synchronisation habituel la rapatrie). */
async function waitLocal(sessionId: string, signal: { cancelled: boolean }): Promise<boolean> {
  const deadline = Date.now() + 15_000;
  while (!signal.cancelled && Date.now() < deadline) {
    await useLibrary.getState().reload().catch(() => undefined);
    if (useLibrary.getState().sessions.some((s) => s.id === sessionId)) return true;
    await syncNow()?.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 400));
  }
  return useLibrary.getState().sessions.some((s) => s.id === sessionId);
}

/**
 * « Prendre mes notes dans LexNote » : crée / retrouve la matière et la séance (idempotent côté serveur), puis ouvre DIRECTEMENT l'éditeur existant
 * avec le panneau Transcription. Le micro n'est JAMAIS démarré ici : la capture passe toujours par son consentement habituel.
 */
export function OpenRevemCourse() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const intent = params.get('intent') ?? '';
  const [error, setError] = useState<IntegrationFailureBody | null>(null);
  const [slow, setSlow] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pending = readPendingLaunch(intent);
  const known = readLaunchResult(intent);

  const run = useCallback(async (signal: { cancelled: boolean }) => {
    setError(null); setSlow(null);
    let sessionId = readLaunchResult(intent);
    if (!sessionId) {
      const p = readPendingLaunch(intent); if (!p) { setError({ code: 'NOT_FOUND', message: '', retryable: false }); return; }
      const r = await openOnce(p.intent, p.nonce);
      if (signal.cancelled) return;
      if (!r.ok) { inflight.delete(intent); setError(r.error); return; }
      sessionId = r.sessionId;
    }
    if (await waitLocal(sessionId, signal)) { if (!signal.cancelled) navigate(`/session/${sessionId}?panel=transcript`, { replace: true }); }
    else if (!signal.cancelled) setSlow(sessionId);
  }, [intent, navigate]);

  const started = useRef<string>('');
  useEffect(() => {
    const key = `${intent}:${attempt}`; if (started.current === key) return; started.current = key;
    const signal = { cancelled: false }; void run(signal);
    return () => { signal.cancelled = true; started.current = ''; };
  }, [intent, attempt, run]);

  if (!pending && !known && !error) return <Navigate to="/" replace />;

  return (
    <div className="page page-enter" data-testid="open-revem-course">
      <div className="authorize panel" role="status" aria-live="polite">
        <span className="authorize__icon" aria-hidden>{error || slow ? <TriangleAlert size={22} /> : <Loader2 size={22} className="spin" />}</span>
        {!error && !slow && <><h1>Ouverture de votre cours…</h1><p className="muted" data-testid="open-progress">Préparation de la matière et de la séance depuis REV-EM. Vos notes s’ouvrent dans un instant.</p></>}
        {slow && (
          <>
            <h1>Votre séance est prête</h1>
            <p className="muted" data-testid="open-slow">Elle n’est pas encore arrivée sur cet appareil (synchronisation lente ou hors ligne). Réessayez, ou ouvrez-la depuis « Mes séances » dès qu’elle apparaît.</p>
            <div className="row-actions"><button className="btn btn--primary" onClick={() => setAttempt((n) => n + 1)} data-testid="open-retry-local">Réessayer</button><Link className="btn" to="/sessions">Mes séances</Link></div>
          </>
        )}
        {error && (
          <>
            <h1>Impossible d’ouvrir ce cours</h1>
            <div className="banner banner--warn" role="alert" data-testid="open-error"><TriangleAlert size={16} aria-hidden /> {errorText(error)}</div>
            <div className="row-actions">
              {LINK_CODES.has(error.code) && <Link className="btn btn--primary" to="/settings#apps-h" data-testid="open-connect"><Link2 size={14} aria-hidden /> Applications connectées</Link>}
              <Link className="btn" to="/">Ouvrir LexNote</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
