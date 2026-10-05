import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Pause, Play } from 'lucide-react';
import { formatClock } from '@/lib/dates';
import { useLibrary } from '@/store/library';

interface Props {
  sessionId: string;
  initialSeconds: number;
  /** Lu par l'autosave pour enregistrer la durée avec les notes. */
  secondsRef: MutableRefObject<number>;
}

const PERSIST_EVERY_S = 30;

/** Durée de prise de notes : ne compte que lorsque l'onglet est visible et le chrono actif. */
export function SessionTimer({ sessionId, initialSeconds, secondsRef }: Props) {
  const [seconds, setSeconds] = useState(initialSeconds);
  const [running, setRunning] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const last = useRef(initialSeconds);
  secondsRef.current = seconds;

  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
      if (running && document.visibilityState === 'visible') setSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (seconds - last.current >= PERSIST_EVERY_S) {
      last.current = seconds;
      void useLibrary.getState().setDuration(sessionId, seconds).catch(() => undefined);
    }
  }, [seconds, sessionId]);

  // À la sortie : on enregistre la durée finale.
  useEffect(() => () => {
    void useLibrary.getState().setDuration(sessionId, secondsRef.current).catch(() => undefined);
  }, [sessionId, secondsRef]);

  return (
    <div className="timer" title="Durée de prise de notes">
      <span className="timer__clock">{now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
      <span className="timer__sep" aria-hidden>·</span>
      <span className="timer__elapsed" data-testid="elapsed" aria-label="Durée écoulée">{formatClock(seconds)}</span>
      <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => setRunning((r) => !r)} aria-label={running ? 'Mettre le chronomètre en pause' : 'Reprendre le chronomètre'}>
        {running ? <Pause size={14} /> : <Play size={14} />}
      </button>
    </div>
  );
}
