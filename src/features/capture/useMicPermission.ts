import { useEffect, useState } from 'react';
import { browserEnv, queryMicPermission, type MicPermission } from '@/services/capture/mic';

/**
 * Permission micro du site, à titre INDICATIF (libellé du bouton) : ne déclenche jamais la demande et ne bloque rien.
 * 'unknown' si le navigateur n'expose pas l'API (Firefox, anciens Safari).
 */
export function useMicPermission(enabled = true): MicPermission {
  const [state, setState] = useState<MicPermission>('unknown');
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let status: PermissionStatus | null = null;
    void queryMicPermission(browserEnv()).then((s) => alive && setState(s));
    void (async () => {
      try {
        status = (await navigator.permissions?.query({ name: "microphone" as PermissionName })) ?? null;
        if (status && alive) status.onchange = () => setState(status!.state as MicPermission);
      } catch { /* non pris en charge */ }
    })();
    return () => { alive = false; if (status) status.onchange = null; };
  }, [enabled]);
  return state;
}
