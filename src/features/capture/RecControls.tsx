import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Mic, Pause, Play, Square, Star, TriangleAlert } from 'lucide-react';
import { STATUS_LABELS, formatHMS, MARKER_REASONS } from '@/domain/capture';
import { captureManager } from '@/services/capture/manager';
import { grantRecordingConsent, hasRecordingConsent } from '@/services/transcription/settings';
import { useCapture } from '@/store/capture';
import { useUI } from '@/store/ui';
import { formatShortcut } from '@/features/editor/commands';
import { ConsentDialog } from './ConsentDialog';
import { useActiveRecordedMs, useRecordedMs } from './useRecording';

/** Démarre la capture après (si besoin) l'avertissement de première utilisation. */
export function useStartCapture(sessionId: string) {
  const [asking, setAsking] = useState(false);
  // Après la boîte de dialogue, le focus revient à l'éditeur : l'étudiant continue d'écrire sans clic.
  const refocus = () => setTimeout(() => (document.querySelector('.note-prose') as HTMLElement | null)?.focus(), 50);
  const request = () => {
    if (hasRecordingConsent()) { void captureManager.start(sessionId); refocus(); }
    else setAsking(true);
  };
  const dialog = (
    <ConsentDialog
      open={asking}
      onCancel={() => setAsking(false)}
      onAccept={() => { grantRecordingConsent(); setAsking(false); void captureManager.start(sessionId); refocus(); }}
    />
  );
  return { request, dialog };
}

export const SHORTCUT_RECORD = 'Mod+Alt+R';
export const SHORTCUT_MARK = 'Mod+Alt+S';

/** Barre supérieure de l'éditeur : démarrer / REC + pause + arrêt + marqueur. Toujours visible, y compris en mode Focus. */
export function RecControls({ sessionId }: { sessionId: string }) {
  const status = useCapture((s) => s.status);
  const audio = useCapture((s) => s.audio);
  const error = useCapture((s) => s.error);
  const failed = useCapture((s) => s.failedChunks);
  const elapsed = useRecordedMs();
  const { request, dialog } = useStartCapture(sessionId);
  const openPanel = useUI((s) => s.openTranscript);

  const live = status === 'RECORDING';
  const busy = status === 'REQUESTING_PERMISSION' || status === 'STARTING' || status === 'PROCESSING';
  const resumable = !!audio && status !== 'COMPLETED' && status !== 'INACTIVE';
  const hasData = !!audio;

  if (live || busy || status === 'PAUSED') {
    return (
      <div className="rec" data-testid="rec-controls">
        <button
          className={`rec__pill${live ? ' is-live' : ''}${status === 'PAUSED' ? ' is-paused' : ''}`}
          onClick={openPanel}
          title="Ouvrir les contrôles de transcription"
          data-testid="rec-pill"
          aria-label={live ? `Enregistrement en cours, ${formatHMS(elapsed)}` : STATUS_LABELS[status]}
        >
          {busy ? <Loader2 size={13} className="spin" aria-hidden /> : <span className="rec__dot" aria-hidden />}
          {live || status === 'PAUSED' ? (
            <>
              <strong>{live ? 'REC' : 'PAUSE'}</strong>
              <span className="rec__time" data-testid="rec-time">{formatHMS(elapsed)}</span>
            </>
          ) : (<span>{STATUS_LABELS[status]}</span>)}
        </button>
        {live && (
          <>
            <button className="btn btn--ghost btn--icon btn--sm" onClick={() => captureManager.mark(sessionId)} title={`Marquer ce moment (${formatShortcut(SHORTCUT_MARK)})`} aria-label="Marquer ce moment" data-testid="mark-btn">
              <Star />
            </button>
            <button className="btn btn--ghost btn--icon btn--sm" onClick={() => void captureManager.pause(sessionId)} title="Pause" aria-label="Mettre en pause la transcription" data-testid="pause-btn"><Pause /></button>
          </>
        )}
        {status === 'PAUSED' && (
          <button className="btn btn--sm" onClick={() => void captureManager.resume(sessionId)} title="Reprendre la transcription" aria-label="Reprendre la transcription" data-testid="resume-btn"><Play /> <span className="lbl">Reprendre</span></button>
        )}
        {(live || status === 'PAUSED') && (
          <button className="btn btn--ghost btn--icon btn--sm" onClick={() => void captureManager.stop(sessionId)} title="Arrêter" aria-label="Arrêter la transcription" data-testid="stop-btn"><Square /></button>
        )}
        {dialog}
      </div>
    );
  }

  return (
    <div className="rec">
      <button
        className={`btn btn--sm ${status === 'ERROR' ? 'btn--warn' : 'btn--ghost'} topbar__soon`}
        onClick={request}
        title={status === 'ERROR' && error ? error.message : `Transcription (${formatShortcut(SHORTCUT_RECORD)})`}
        data-testid="transcription-btn"
      >
        {status === 'ERROR' ? <TriangleAlert /> : <Mic />}
        <span>{resumable || hasData ? 'Reprendre la transcription' : 'Transcription'}</span>
      </button>
      {failed > 0 && <span className="tag tag--soon" title="Des segments n’ont pas pu être transcrits">{failed} à retranscrire</span>}
      {dialog}
    </div>
  );
}

/** Pastille globale (toutes pages) : l'utilisateur sait toujours quand le micro fonctionne. */
export function GlobalRecPill() {
  const active = useCapture((s) => s.active);
  const elapsed = useActiveRecordedMs();
  if (!active || (active.status !== 'RECORDING' && active.status !== 'REQUESTING_PERMISSION' && active.status !== 'STARTING')) return null;
  return (
    <Link to={`/session/${active.sessionId}`} className="rec__pill is-live rec__pill--global" data-testid="global-rec" aria-label="Enregistrement en cours — retourner au CM">
      <span className="rec__dot" aria-hidden /> <strong>REC</strong> <span className="rec__time">{formatHMS(elapsed)}</span>
    </Link>
  );
}

/** « Pourquoi ? » — apparaît quelques secondes après un marqueur, jamais bloquant. */
export function MarkerQuickChips({ sessionId }: { sessionId: string }) {
  const lastId = useCapture((s) => s.lastMarkerId);
  const marker = useCapture((s) => s.markers.find((m) => m.id === s.lastMarkerId));
  const [note, setNote] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // Se ferme tout seul après 8 s sans interaction.
  useAutoDismiss(lastId, () => setDismissed(lastId));
  if (!marker || dismissed === marker.id) return null;
  const toggle = (id: (typeof MARKER_REASONS)[number]['id']) => {
    const has = marker.reasons.includes(id);
    captureManager.updateMarker(sessionId, marker.id, { reasons: has ? marker.reasons.filter((r) => r !== id) : [...marker.reasons, id] });
  };
  return (
    <div className="chips-pop" role="group" aria-label="Pourquoi ce marqueur ?" data-testid="marker-chips">
      <span className="chips-pop__q"><Star size={13} aria-hidden /> Marqué · Pourquoi ?</span>
      {MARKER_REASONS.map((r) => (
        <button key={r.id} className={`chip chip--sm${marker.reasons.includes(r.id) ? ' is-on' : ''}`} aria-pressed={marker.reasons.includes(r.id)} onClick={() => toggle(r.id)}>{r.label}</button>
      ))}
      {note === null ? (
        <button className="chip chip--sm" onClick={() => setNote(marker.note ?? '')}>+ Note</button>
      ) : (
        <input
          className="input chips-pop__note" autoFocus placeholder="Note…" value={note} aria-label="Note du marqueur"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { captureManager.updateMarker(sessionId, marker.id, { note }); setNote(null); setDismissed(marker.id); } if (e.key === 'Escape') setNote(null); }}
          onBlur={() => { if (note) captureManager.updateMarker(sessionId, marker.id, { note }); }}
        />
      )}
    </div>
  );
}

import { useEffect } from 'react';
function useAutoDismiss(key: string | null, fn: () => void) {
  useEffect(() => {
    if (!key) return;
    const t = setTimeout(fn, 8000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
