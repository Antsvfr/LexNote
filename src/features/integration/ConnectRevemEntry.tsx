import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { savePending } from './pending';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{32,100}$/;

/**
 * Point d'arrivée public de REV-EM : `/integrations/revem/connect?intent=<uuid>#n=<nonce>`.
 * Il met le nonce à l'abri (sessionStorage), EFFACE le fragment de l'URL, puis envoie vers la page d'autorisation
 * (protégée par la connexion LexNote, qui conserve `?intent=`).
 */
export function ConnectRevemEntry() {
  const loc = useLocation();
  const intent = new URLSearchParams(loc.search).get('intent') ?? '';
  const nonce = new URLSearchParams(loc.hash.replace(/^#/, '')).get('n') ?? '';
  const valid = UUID.test(intent) && NONCE.test(nonce);
  useEffect(() => { if (valid) savePending(intent, nonce); }, [valid, intent, nonce]);
  if (!valid) return <Navigate to="/settings" replace />;
  savePending(intent, nonce);                     // synchrone : doit exister avant la navigation vers /authorize
  return <Navigate to={`/integrations/revem/authorize?intent=${encodeURIComponent(intent)}`} replace />;
}
