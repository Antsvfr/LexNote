import { Check, CircleAlert, Loader2 } from 'lucide-react';
import { useSaveStatus } from './saveStatus';

export function SaveIndicator() {
  const state = useSaveStatus((s) => s.state);
  return (
    <span className={`save save--${state}`} role="status" aria-live="polite" data-testid="save-status">
      {state === 'saving' && (<><Loader2 size={14} className="spin" aria-hidden /> <span>Enregistrement…</span></>)}
      {(state === 'saved' || state === 'idle') && (<><Check size={14} aria-hidden /> <span>Enregistré</span></>)}
      {state === 'error' && (<><CircleAlert size={14} aria-hidden /> <span>Échec de l’enregistrement</span></>)}
    </span>
  );
}
