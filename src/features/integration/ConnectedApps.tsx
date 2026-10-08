import { Link2, Link2Off, RefreshCw, ShieldCheck } from 'lucide-react';
import { confirm } from '@/components/confirm';
import { toast } from '@/store/toasts';
import { errorText, useConnection } from './useConnection';

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Réglages › Applications connectées › REV-EM. L'affichage « Connecté » exige que les DEUX côtés le confirment. */
export function ConnectedApps() {
  const { state, error, busy, refresh, revoke } = useConnection();
  const s = state?.state;

  async function disconnect() {
    const ok = await confirm({ title: 'Déconnecter REV-EM ?', message: 'LexNote et REV-EM n’échangeront plus rien. Aucune de vos données (notes, séances, supports, ni côté REV-EM) n’est supprimée. Vous pourrez vous reconnecter à tout moment depuis REV-EM.', confirmLabel: 'Déconnecter', danger: true });
    if (!ok) return;
    const r = await revoke();
    if (r?.ok) toast.success(r.peerNotified ? 'REV-EM est déconnecté.' : 'Déconnecté de LexNote. REV-EM l’apprendra à sa prochaine synchronisation.');
    else toast.error('La déconnexion a échoué. Réessayez.');
  }

  return (
    <section className="settings-block" aria-labelledby="apps-h" data-testid="connected-apps">
      <h2 id="apps-h"><Link2 size={18} aria-hidden /> Applications connectées</h2>
      <p className="muted">Reliez explicitement votre compte REV-EM à votre compte LexNote. Les deux comptes restent indépendants : rien n’est fusionné, aucun mot de passe ni jeton n’est partagé, et l’adresse e-mail ne sert jamais à relier les comptes.</p>
      <div className="appcard" data-testid="app-revem" data-state={s ?? 'loading'}>
        <div className="appcard__head">
          <strong>REV-EM</strong>
          {!state && !error && <span className="tag" data-testid="revem-status">Vérification…</span>}
          {s === 'CONNECTED' && <span className="tag tag--live" data-testid="revem-status"><ShieldCheck size={12} aria-hidden /> Connecté</span>}
          {s === 'NOT_CONNECTED' && <span className="tag" data-testid="revem-status">Non connecté</span>}
          {s === 'PENDING' && <span className="tag" data-testid="revem-status">Vérification en cours</span>}
          {s === 'REVOKED' && <span className="tag" data-testid="revem-status">Déconnecté</span>}
          {(s === 'ERROR' || (error && !state)) && <span className="tag tag--warn" data-testid="revem-status">Vérification impossible</span>}
        </div>
        {s === 'CONNECTED' && <p className="muted" data-testid="revem-since">Connecté depuis le {state?.linkedAt ? formatDate(state.linkedAt) : '—'}. Seules des références (titres, dates, compteurs) peuvent être échangées — jamais vos notes, transcriptions ni fichiers audio.</p>}
        {s === 'NOT_CONNECTED' && <p className="muted" data-testid="revem-howto">Pour connecter REV-EM : ouvrez REV-EM › Réglages › Applications connectées › LexNote › <em>Connecter</em>. Vous reviendrez ici pour autoriser.</p>}
        {s === 'REVOKED' && <p className="muted" data-testid="revem-revoked">{state?.revokedBy === 'partner' ? 'REV-EM a mis fin à la connexion' : 'Vous avez mis fin à la connexion'}{state?.revokedAt ? ` le ${formatDate(state.revokedAt)}` : ''}. Vos données n’ont pas été supprimées. Pour reconnecter, relancez la connexion depuis REV-EM.</p>}
        {s === 'ERROR' && <p className="muted" role="status">{state?.errorCode === 'PEER_UNREACHABLE' ? 'REV-EM est injoignable pour le moment : la connexion n’a pas pu être vérifiée.' : state?.errorCode === 'PEER_MISSING' ? 'REV-EM ne reconnaît plus cette connexion. Déconnectez puis reconnectez depuis REV-EM.' : 'La connexion est dans un état incohérent. Déconnectez-la puis reconnectez-la depuis REV-EM.'}</p>}
        {error && !state && <p className="muted" role="alert">{errorText(error)}</p>}
        <div className="row-actions">
          {(s === 'CONNECTED' || s === 'ERROR' || s === 'PENDING') && <button className="btn btn--danger" onClick={disconnect} disabled={busy} data-testid="revem-disconnect"><Link2Off /> Déconnecter</button>}
          <button className="btn btn--ghost" onClick={() => void refresh()} disabled={busy} aria-label="Revérifier la connexion" data-testid="revem-refresh"><RefreshCw /> Vérifier</button>
        </div>
      </div>
    </section>
  );
}
