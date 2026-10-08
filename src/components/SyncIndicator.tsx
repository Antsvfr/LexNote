import { AlertTriangle, Check, CloudOff, RefreshCw } from 'lucide-react';
import { useSync } from '@/store/sync';
import { useAuth } from '@/store/auth';
import { syncNow } from '@/services/workspace';

/** État de synchronisation, discret : ✓ Synchronisé · ↑ Synchronisation… · Hors ligne · ⚠ Synchronisation impossible. */
export function SyncIndicator({ compact = false }: { compact?: boolean }) {
  const { state, pending, error } = useSync();
  const offlineSession = useAuth((s) => s.offlineSession);
  const effective = offlineSession && state !== 'syncing' ? 'offline' : state;
  const map = {
    synced: { icon: <Check size={14} />, label: 'Synchronisé', cls: 'ok' },
    syncing: { icon: <RefreshCw size={14} className="spin" />, label: 'Synchronisation…', cls: 'busy' },
    idle: { icon: <Check size={14} />, label: pending ? `${pending} en attente` : 'Synchronisé', cls: pending ? 'busy' : 'ok' },
    offline: { icon: <CloudOff size={14} />, label: pending ? `Hors ligne · ${pending} en attente` : 'Hors ligne', cls: 'off' },
    error: { icon: <AlertTriangle size={14} />, label: 'Synchronisation impossible', cls: 'err' },
    disabled: { icon: <CloudOff size={14} />, label: 'Local uniquement', cls: 'off' },
  } as const;
  const v = map[effective];
  return (
    <button
      type="button" className={`syncind syncind--${v.cls}`} onClick={() => void syncNow()} data-testid="sync-indicator" data-state={effective}
      title={error ?? (pending ? `${pending} élément(s) seront envoyés dès que possible. Vos notes sont déjà enregistrées sur cet appareil.` : 'Vos données sont à jour sur tous vos appareils. Cliquez pour synchroniser.')}
      aria-live="polite"
    >
      {v.icon}{!compact && <span>{v.label}</span>}
    </button>
  );
}
