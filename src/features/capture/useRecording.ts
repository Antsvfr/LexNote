import { useEffect, useState } from 'react';
import { recordedMs } from '@/domain/capture';
import { useCapture } from '@/store/capture';

/** Durée enregistrée (hors pauses), rafraîchie chaque seconde uniquement tant qu'un enregistrement tourne. */
export function useRecordedMs(): number {
  const audio = useCapture((s) => s.audio);
  const status = useCapture((s) => s.status);
  const [, tick] = useState(0);
  useEffect(() => {
    if (status !== 'RECORDING') return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [status]);
  return audio ? recordedMs(audio.runs, Date.now() - audio.originAt) : 0;
}

/** Pour la pastille globale (hors page CM). */
export function useActiveRecordedMs(): number {
  const active = useCapture((s) => s.active);
  const [, tick] = useState(0);
  useEffect(() => {
    if (active?.status !== 'RECORDING') return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active?.status]);
  const a = active?.audio;
  return a ? recordedMs(a.runs, Date.now() - a.originAt) : 0;
}

export const isLive = (status: string) => ['REQUESTING_PERMISSION', 'STARTING', 'RECORDING', 'PROCESSING'].includes(status);
