import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, MonitorSmartphone } from 'lucide-react';
import { confirm } from '@/components/confirm';
import { getBackend } from '@/services/backend';
import { readDevice, setRemember } from '@/services/auth/device';
import type { UserDevice } from '@/services/auth/types';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/toasts';

const when = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Appareils où ce compte LexNote est connecté (registre d'affichage : UUID local + « Navigateur — système », jamais d'empreinte).
 * « Déconnecter » un appareil supprime SA session Supabase : son jeton de rafraîchissement cesse de fonctionner immédiatement
 * (le jeton d'accès déjà émis expire de lui-même, au plus tard dans l'heure). « Tous les appareils » révoque toutes les sessions du compte.
 */
export function DevicesPanel() {
  const navigate = useNavigate();
  const signOut = useAuth((s) => s.signOut);
  const me = readDevice();
  const [stay, setStay] = useState(me.remember);
  const [devices, setDevices] = useState<UserDevice[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try { const repo = (await getBackend()).auth.devices; setDevices(repo ? await repo.list() : []); setFailed(false); }
    catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function toggleStay(v: boolean) {
    setStay(v); setRemember(v);
    toast.success(v ? 'Cet appareil restera connecté.' : 'La session de cet appareil s’arrêtera à la fermeture du navigateur.');
  }
  async function revoke(d: UserDevice) {
    if (d.deviceId === me.id) return void logoutHere();
    const ok = await confirm({ title: `Déconnecter « ${d.label} » ?`, message: 'Cet appareil devra se reconnecter. Aucune donnée n’est supprimée.', confirmLabel: 'Déconnecter', danger: true });
    if (!ok) return;
    try { await (await getBackend()).auth.devices?.revoke(d.deviceId); toast.success('Appareil déconnecté.'); }
    catch { toast.error('La déconnexion de cet appareil a échoué. Réessayez.'); }
    await load();
  }
  async function logoutHere() { await signOut(); navigate('/login', { replace: true }); }
  async function logoutEverywhere() {
    const ok = await confirm({ title: 'Déconnecter tous les appareils ?', message: 'Toutes les sessions de votre compte LexNote seront fermées, y compris celle-ci et l’application installée. La liaison avec REV-EM est conservée ; la connexion automatique, si vous l’avez autorisée, le reste aussi.', confirmLabel: 'Tout déconnecter', danger: true });
    if (!ok) return;
    await signOut({ everywhere: true });
    navigate('/login', { replace: true });
  }

  return (
    <div className="appcard" data-testid="devices-panel">
      <div className="appcard__head"><strong><MonitorSmartphone size={15} aria-hidden /> Appareils connectés à LexNote</strong></div>
      <label className="check"><input type="checkbox" checked={stay} onChange={(e) => toggleStay(e.target.checked)} data-testid="devices-stay" />
        <span><strong>Rester connecté sur cet appareil</strong><small>LexNote conservera votre session sur cet appareil afin de vous reconnecter automatiquement. N’utilisez pas cette option sur un appareil partagé.</small></span></label>
      {failed && <p className="muted" role="status">La liste des appareils n’a pas pu être chargée (hors ligne ?).</p>}
      {devices && (
        <ul className="devices" data-testid="devices-list">
          {devices.length === 0 && <li className="muted">Aucun appareil enregistré pour le moment.</li>}
          {devices.map((d) => (
            <li key={d.deviceId} data-testid="device-row" data-current={d.deviceId === me.id ? 'true' : undefined}>
              <span><strong>{d.label}{d.deviceId === me.id ? ' (cet appareil)' : ''}</strong><small>Dernière utilisation : {when(d.lastSeenAt)}{d.remember ? ' · reste connecté' : ''}</small></span>
              <button className="btn btn--ghost" onClick={() => void revoke(d)} data-testid="device-revoke">Déconnecter</button>
            </li>
          ))}
        </ul>
      )}
      <div className="row-actions">
        <button className="btn btn--danger" onClick={() => void logoutEverywhere()} data-testid="devices-logout-all"><LogOut /> Déconnecter tous les appareils</button>
      </div>
    </div>
  );
}
