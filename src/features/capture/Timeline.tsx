import { memo, useEffect, useMemo, useState } from 'react';
import { useCapture } from '@/store/capture';
import { Star } from 'lucide-react';
import {
  formatHMS, type Interruption, type NoteAnchor, type RecordingRun, type TimelineMarker,
} from '@/domain/capture';

interface Props {
  runs: RecordingRun[];
  markers: TimelineMarker[];
  interruptions: Interruption[];
  anchors?: NoteAnchor[];
  /** Durée totale connue (ms) ; étendue si des éléments la dépassent. */
  totalMs: number;
  positionMs?: number | null;
  size?: 'slim' | 'full';
  onSeek?: (ms: number) => void;
}

const KIND_LABEL: Record<string, string> = {
  permission: 'Permission', device: 'Micro', recorder: 'Enregistreur', provider: 'Moteur', storage: 'Stockage',
  'system-sleep': 'Veille', 'app-closed': 'App fermée', network: 'Réseau', unknown: 'Erreur',
};

/** Frise du CM : portions enregistrées, pauses, interruptions, marqueurs (et, en détail, densité de notes). */
export const Timeline = memo(function Timeline({ runs, markers, interruptions, anchors, totalMs, positionMs, size = 'slim', onSeek }: Props) {
  const total = useMemo(() => {
    const ends = [totalMs, ...runs.map((r) => r.endMs ?? r.startMs), ...markers.map((m) => m.atMs), ...interruptions.map((i) => i.atMs)];
    return Math.max(1000, ...ends);
  }, [runs, markers, interruptions, totalMs]);
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / total) * 100))}%`;

  // Densité des notes : 60 cases au maximum (jamais un élément par ancre).
  const density = useMemo(() => {
    if (!anchors?.length) return [];
    const buckets = new Array<number>(60).fill(0);
    anchors.forEach((a) => { buckets[Math.min(59, Math.floor((a.timestamp / total) * 60))]!++; });
    const max = Math.max(...buckets);
    return buckets.map((n) => (max ? n / max : 0));
  }, [anchors, total]);

  return (
    <div className={`timeline timeline--${size}`} role="group" aria-label="Chronologie du CM" data-testid="timeline">
      <span className="timeline__t">00:00</span>
      <div
        className="timeline__rail"
        onClick={(e) => {
          if (!onSeek) return;
          const r = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - r.left) / r.width) * total);
        }}
      >
        {runs.map((r, i) => {
          const next = runs[i + 1];
          return (
            <span key={r.id}>
              <span className="timeline__run" style={{ left: pct(r.startMs), width: `calc(${pct((r.endMs ?? total) - r.startMs)})` }} />
              {next && r.endMs !== null && (
                <span
                  className={`timeline__gap ${r.endReason === 'interrupted' ? 'is-int' : 'is-pause'}`}
                  style={{ left: pct(r.endMs), width: pct(Math.max(0, next.startMs - r.endMs)) }}
                  title={r.endReason === 'interrupted' ? 'Interruption' : 'Pause'}
                />
              )}
            </span>
          );
        })}
        {interruptions.map((i) => (
          <span key={i.id} className="timeline__int" style={{ left: pct(i.atMs) }} title={`${KIND_LABEL[i.kind] ?? 'Interruption'} — ${i.message}`} />
        ))}
        {markers.map((m) => (
          <button
            key={m.id} className="timeline__mark" style={{ left: pct(m.atMs) }}
            onClick={(e) => { e.stopPropagation(); onSeek?.(m.atMs); }}
            title={`Marqueur ${formatHMS(m.atMs)}${m.reasons.length ? ` · ${m.reasons.join(', ')}` : ''}${m.note ? ` · ${m.note}` : ''}`}
            aria-label={`Marqueur à ${formatHMS(m.atMs)}`}
          ><Star size={size === 'full' ? 14 : 11} fill="currentColor" /></button>
        ))}
        {positionMs != null && <span className="timeline__pos" style={{ left: pct(positionMs) }} />}
      </div>
      <span className="timeline__t">{formatHMS(total)}</span>
      {size === 'full' && density.length > 0 && (
        <div className="timeline__density" aria-label="Densité des notes" title="Moments où vous avez pris des notes">
          {density.map((d, i) => <span key={i} style={{ opacity: 0.12 + d * 0.88, height: `${20 + d * 80}%` }} />)}
        </div>
      )}
    </div>
  );
});

/** Frise reliée au store de capture ; se rafraîchit toutes les 5 s pendant l'enregistrement (jamais à chaque frappe). */
export function LiveTimeline({ size = 'slim', onSeek, positionMs, withAnchors }: { size?: 'slim' | 'full'; onSeek?: (ms: number) => void; positionMs?: number | null; withAnchors?: NoteAnchor[] }) {
  const audio = useCapture((s) => s.audio);
  const markers = useCapture((s) => s.markers);
  const interruptions = useCapture((s) => s.interruptions);
  const status = useCapture((s) => s.status);
  const [, tick] = useState(0);
  useEffect(() => {
    if (status !== 'RECORDING') return;
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, [status]);
  if (!audio || audio.runs.length === 0) return null;
  const last = audio.runs[audio.runs.length - 1]!;
  const total = status === 'RECORDING' ? Date.now() - audio.originAt : last.endMs ?? 0;
  return <Timeline size={size} runs={audio.runs} markers={markers} interruptions={interruptions} anchors={withAnchors} totalMs={total} positionMs={positionMs} onSeek={onSeek} />;
}
