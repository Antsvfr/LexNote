import { Pause, Play, Square, Star, X } from 'lucide-react';
import { STATUS_LABELS, formatHMS } from '@/domain/capture';
import { captureManager } from '@/services/capture/manager';
import { useCapture } from '@/store/capture';
import { useUI } from '@/store/ui';
import { useRecordedMs } from './useRecording';
import { MarkerQuickChips } from './RecControls';

/** Mode Focus : le panneau est masqué, un clic sur « ● REC » rouvre les contrôles essentiels. */
export function RecPopover({ sessionId }: { sessionId: string }) {
  const open = useUI((s) => s.recPopover);
  const close = useUI((s) => s.setRecPopover);
  const status = useCapture((s) => s.status);
  const segments = useCapture((s) => s.segments);
  const interim = useCapture((s) => s.interim);
  const elapsed = useRecordedMs();
  if (!open) return null;
  const last = segments.slice(-2);
  return (
    <div className="recpop" role="dialog" aria-label="Contrôles de transcription" data-testid="rec-popover">
      <div className="recpop__head">
        <span className={`rec__dot${status === 'RECORDING' ? ' is-live' : ''}`} aria-hidden />
        <strong>{STATUS_LABELS[status]}</strong>
        <span className="rec__time">{formatHMS(elapsed)}</span>
        <button className="btn btn--ghost btn--icon btn--sm" onClick={() => close(false)} aria-label="Fermer"><X /></button>
      </div>
      <div className="recpop__actions">
        {status === 'RECORDING' && <button className="btn btn--sm" onClick={() => void captureManager.pause(sessionId)}><Pause /> Pause</button>}
        {status === 'PAUSED' && <button className="btn btn--sm" onClick={() => void captureManager.resume(sessionId)}><Play /> Reprendre</button>}
        {(status === 'RECORDING' || status === 'PAUSED') && <button className="btn btn--sm" onClick={() => void captureManager.stop(sessionId)}><Square /> Arrêter</button>}
        {status === 'RECORDING' && <button className="btn btn--sm" onClick={() => captureManager.mark(sessionId)}><Star /> Marquer</button>}
      </div>
      {(last.length > 0 || interim) && (
        <div className="recpop__live" aria-live="off">
          {last.map((s) => <p key={s.id}>{s.text}</p>)}
          {interim && <p className="muted"><em>{interim}</em></p>}
        </div>
      )}
      <MarkerQuickChips sessionId={sessionId} />
    </div>
  );
}
