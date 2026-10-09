import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { savePendingLaunch } from './launchPending';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{32,100}$/;

/**
 * Point d'arrivée public du bouton « Prendre mes notes dans LexNote » de REV-EM : `/integrations/revem/launch?intent=<uuid>#n=<nonce>`.
 * Il met le nonce à l'abri (sessionStorage), EFFACE le fragment de l'URL, puis envoie vers la page d'ouverture (protégée par la connexion
 * LexNote, qui conserve `?intent=`). Aucune donnée de cours dans l'URL : seulement une intention à usage unique.
 */
export function LaunchRevemEntry() {
  const loc = useLocation();
  const intent = new URLSearchParams(loc.search).get('intent') ?? '';
  const nonce = new URLSearchParams(loc.hash.replace(/^#/, '')).get('n') ?? '';
  const valid = UUID.test(intent) && NONCE.test(nonce);
  useEffect(() => { if (valid) savePendingLaunch(intent, nonce); }, [valid, intent, nonce]);
  if (!valid) return <Navigate to="/" replace />;
  savePendingLaunch(intent, nonce);                // synchrone : doit exister avant la navigation vers /open
  return <Navigate to={`/integrations/revem/open?intent=${encodeURIComponent(intent)}`} replace />;
}
