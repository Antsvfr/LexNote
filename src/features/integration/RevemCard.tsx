import { Link } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { useConnection } from './useConnection';

/** Libellé de l'état de la liaison, VÉRIFIÉ auprès du serveur (jamais déduit d'un stockage local) : réutilise `useConnection`, comme Réglages › Applications connectées. */
export function revemLabel(s: string | undefined, hasError: boolean, errorCode?: string): { text: string; connected: boolean; key: string } {
  // Session LexNote réellement perdue (vérifiée et non rafraîchissable) — distincte d'un refus entre serveurs.
  if (errorCode === 'SESSION_REQUIRED') return { text: 'Session expirée', connected: false, key: 'expired' };
  if (s === 'CONNECTED') return { text: '● Connecté', connected: true, key: 'connected' };
  if (s === 'PENDING') return { text: '○ Connexion en cours', connected: false, key: 'pending' };
  if (s === 'ERROR' || (hasError && !s)) return { text: '○ Vérification impossible', connected: false, key: 'error' };
  if (!s) return { text: 'Vérification…', connected: false, key: 'loading' };
  return { text: '○ Non connecté', connected: false, key: 'disconnected' };      // NOT_CONNECTED / REVOKED
}

/** Carte de la barre latérale : cliquable → Réglages › Applications connectées. */
export function RevemCard() {
  const { state, error } = useConnection();
  const l = revemLabel(state?.state, !!error, error?.code);
  return (
    <Link to="/settings#apps-h" className="revem" aria-label={`REV-EM — ${l.text.replace(/^[●○]\s*/, '')}. Ouvrir Applications connectées`} data-testid="revem-card" data-state={l.key}>
      <span className="revem__icon"><GraduationCap size={20} /></span>
      <span><strong>REV-EM</strong><small data-testid="revem-card-status" className={l.connected ? 'is-live' : undefined}>{l.text}</small></span>
    </Link>
  );
}
