import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { useConnection } from './useConnection';

/**
 * Carte REV-EM de la barre latérale : état RÉEL de la liaison (vérifié par le serveur, comme dans Réglages › Applications
 * connectées), et lien vers cette section. « Connecté » n'est affiché que si les DEUX côtés le confirment.
 */
export function RevemStatusCard() {
  const { state, error } = useConnection();
  const connected = state?.state === 'CONNECTED' && state.verified;
  const label = connected ? 'Connecté' : !state && !error ? 'Vérification…' : error ? 'Indisponible' : state?.state === 'PENDING' ? 'Connexion en cours' : 'Non connecté';
  return (
    <Link to="/settings#connected-apps" className={`revem${connected ? ' is-connected' : ''}`} aria-label={`REV-EM — ${label}`} data-testid="sidebar-revem" data-state={connected ? 'connected' : state?.state ?? (error ? 'error' : 'loading')}>
      <span className="revem__icon"><GraduationCap size={20} /></span>
      <span><strong>REV-EM</strong><small><i className={`revem__dot${connected ? ' is-on' : ''}`} aria-hidden>{connected ? '●' : '○'}</i> {label}</small></span>
    </Link>
  );
}
