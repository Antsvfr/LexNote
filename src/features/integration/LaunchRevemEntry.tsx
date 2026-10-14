import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Splash } from '@/components/Splash';
import { useAuth } from '@/store/auth';
import { readLaunchResult, readPendingLaunch, savePendingLaunch } from './launchPending';
import { autoSignIn } from './autoSignIn';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{32,100}$/;

/**
 * Point d'arrivée public du bouton « Prendre mes notes dans LexNote » de REV-EM : `/integrations/revem/launch?intent=<uuid>#n=<nonce>`.
 * Il met le nonce à l'abri (sessionStorage), EFFACE le fragment de l'URL (historique compris), puis :
 *  - CAS A / B : session LexNote présente (ou rafraîchie par supabase-js) → page d'ouverture habituelle ;
 *  - CAS C : aucune session → CONNEXION AUTOMATIQUE (consentement vérifié par le serveur LexNote) → ouverture directe du cours ;
 *  - CAS D : connexion automatique refusée / indisponible → page d'ouverture, donc connexion LexNote normale, puis reprise du même lancement.
 * Aucune donnée de cours ni aucun jeton dans l'URL : seulement une intention à usage unique.
 */
export function LaunchRevemEntry() {
  const loc = useLocation();
  const status = useAuth((s) => s.status);
  const intent = new URLSearchParams(loc.search).get('intent') ?? '';
  const nonceInUrl = new URLSearchParams(loc.hash.replace(/^#/, '')).get('n') ?? '';
  // Synchrone, au premier rendu : le nonce quitte l'URL avant tout le reste (il ne doit pas rester dans l'historique).
  if (UUID.test(intent) && NONCE.test(nonceInUrl)) {
    savePendingLaunch(intent, nonceInUrl);
    try { history.replaceState(history.state, '', `${loc.pathname}${loc.search}`); } catch { /* sans effet */ }
  }
  const pending = UUID.test(intent) ? readPendingLaunch(intent) : null;
  const known = UUID.test(intent) ? readLaunchResult(intent) : null;             // connexion automatique réussie : séance déjà créée
  const [auto, setAuto] = useState<'idle' | 'trying' | 'done'>('idle');

  useEffect(() => {
    if (!pending || status !== 'unauthenticated' || auto !== 'idle') return;
    setAuto('trying');
    void autoSignIn(pending.intent, pending.nonce).then(() => setAuto('done'));   // succès ou refus : la page d'ouverture prend le relais
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.intent, status, auto]);

  if (!pending && !known) return <Navigate to="/" replace />;
  if (status === 'loading' || auto === 'trying') return <Splash label="Ouverture de LexNote…" />;
  return <Navigate to={`/integrations/revem/open?intent=${encodeURIComponent(intent)}`} replace />;
}
