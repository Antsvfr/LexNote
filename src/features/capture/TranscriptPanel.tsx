import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Mic, Star, TriangleAlert } from 'lucide-react';
import {
  STATUS_LABELS, formatBytes, formatHMS, wallClock, type TimelineMarker, type TranscriptSegment,
} from '@/domain/capture';
import { captureManager } from '@/services/capture/manager';
import { useCapture } from '@/store/capture';
import { MiniPlayer } from './MiniPlayer';
import { useStartCapture } from './RecControls';
import { useRecordedMs } from './useRecording';

/** Fenêtre d'affichage : seuls les derniers passages sont rendus ; les précédents se chargent par paliers. */
const PAGE = 300;

type Item = { kind: 'seg'; seg: TranscriptSegment } | { kind: 'mark'; marker: TimelineMarker };

const Row = memo(function Row({ seg, originAt, selected, onPick }: { seg: TranscriptSegment; originAt: number; selected: boolean; onPick: (s: TranscriptSegment) => void }) {
  return (
    <li
      className={`tseg${selected ? ' is-selected' : ''}${seg.confidence !== undefined && seg.confidence < 0.6 ? ' is-low' : ''}`}
      data-seg={seg.id} data-testid="tseg" onClick={() => onPick(seg)}
    >
      <time title={`${formatHMS(seg.startMs)} depuis le début du CM`}>{wallClock(originAt, seg.startMs)}</time>
      <p>{seg.text}</p>
    </li>
  );
});

const MarkRow = memo(function MarkRow({ marker, onPick }: { marker: TimelineMarker; onPick: (ms: number) => void }) {
  return (
    <li className="tmark" onClick={() => onPick(marker.atMs)} data-testid="tmark">
      <Star size={13} fill="currentColor" aria-hidden />
      <span>Marqueur · {formatHMS(marker.atMs)}</span>
      {marker.reasons.map((r) => <span className="tag" key={r}>{r === 'exam' ? 'Examen' : r === 'important' ? 'Important' : r === 'review' ? 'À revoir' : 'Exemple'}</span>)}
      {marker.note && <em>{marker.note}</em>}
    </li>
  );
});

/**
 * Transcription : en direct pendant le cours, consultable après.
 * - suit le direct tant que l'utilisateur est en bas ; s'il remonte, il n'est JAMAIS ramené de force ;
 * - `content-visibility: auto` + lignes mémoïsées : des milliers de segments sans ralentir l'éditeur.
 */
export function TranscriptPanel({ sessionId, variant = 'live' }: { sessionId: string; variant?: 'live' | 'review' }) {
  const segments = useCapture((s) => s.segments);
  const markers = useCapture((s) => s.markers);
  const status = useCapture((s) => s.status);
  const error = useCapture((s) => s.error);
  const audio = useCapture((s) => s.audio);
  const interim = useCapture((s) => s.interim);
  const chunks = useCapture((s) => s.chunks);
  const info = useCapture((s) => s.storage);
  const interruptions = useCapture((s) => s.interruptions);
  const providerLabel = useCapture((s) => s.providerLabel);
  const providerPrivacy = useCapture((s) => s.providerPrivacy);
  const failed = useCapture((s) => s.failedChunks);
  const audioStopped = useCapture((s) => s.audioStopped);
  const focusMs = useCapture((s) => s.focusMs);
  const loaded = useCapture((s) => s.loaded);
  const { request, dialog } = useStartCapture(sessionId);
  const elapsed = useRecordedMs();

  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [play, setPlay] = useState<{ ms: number | null; nonce: number }>({ ms: null, nonce: 0 });

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    let mi = 0;
    for (const seg of segments) {
      while (mi < markers.length && markers[mi]!.atMs <= seg.startMs) out.push({ kind: 'mark', marker: markers[mi++]! });
      out.push({ kind: 'seg', seg });
    }
    while (mi < markers.length) out.push({ kind: 'mark', marker: markers[mi++]! });
    return out;
  }, [segments, markers]);

  // `following` : l'utilisateur est « collé » au direct. Seul un mouvement vers le haut de sa part le décolle ;
  // la croissance du contenu (hauteurs réelles des lignes) ne doit jamais le faire.
  const following = useRef(true);
  const lastTop = useRef(0);
  const windowed = useMemo(() => (items.length > shown ? items.slice(items.length - shown) : items), [items, shown]);
  const hidden = items.length - windowed.length;

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist < 48) following.current = true;
    else if (el.scrollTop < lastTop.current - 2) following.current = false;
    lastTop.current = el.scrollTop;
    setAtBottom((prev) => (prev === following.current ? prev : following.current));
  }, []);

  // Suit le direct SEULEMENT si on est déjà en bas ; se recale quand la hauteur de la liste change.
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = scroller.current, ol = list.current;
    if (variant !== 'live' || !el) return;
    const pin = () => { if (following.current) { el.scrollTop = el.scrollHeight; lastTop.current = el.scrollTop; } };
    pin();
    if (!ol || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(pin);
    ro.observe(ol);
    return () => ro.disconnect();
  }, [segments.length, interim, variant, items.length]);

  // Ouverture à un passage précis (depuis la recherche).
  useEffect(() => {
    if (focusMs == null || !loaded || !segments.length) return;
    const target = segments.find((s) => s.endMs >= focusMs) ?? segments[segments.length - 1]!;
    const idx = items.findIndex((it) => it.kind === 'seg' && it.seg.id === target.id);
    if (idx >= 0 && items.length - idx > shown) setShown(items.length - idx + 20);
    setSelected(target.id);
    following.current = false;
    setAtBottom(false);
    requestAnimationFrame(() => scroller.current?.querySelector(`[data-seg="${target.id}"]`)?.scrollIntoView({ block: 'center' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMs, loaded, segments.length > 0]);

  const hasAudio = chunks.some((c) => c.status === 'stored');
  const pick = useCallback((seg: TranscriptSegment) => {
    setSelected(seg.id);
    if (hasAudio) setPlay((p) => ({ ms: seg.startMs, nonce: p.nonce + 1 }));
  }, [hasAudio]);
  const pickMs = useCallback((ms: number) => { if (hasAudio) setPlay((p) => ({ ms, nonce: p.nonce + 1 })); }, [hasAudio]);

  const audioBytes = chunks.reduce((n, c) => n + (c.status === 'stored' ? c.size : 0), 0);
  const unresolved = [...interruptions].reverse().find((i) => i.resolvedAtMs === undefined && ['provider', 'network', 'storage'].includes(i.kind));
  const live = status === 'RECORDING';
  const canStart = !['REQUESTING_PERMISSION', 'STARTING', 'RECORDING', 'PROCESSING'].includes(status);

  return (
    <section className="tpanel" aria-label="Transcription" data-testid="transcript-panel">
      <header className="tpanel__head">
        <div className="tpanel__status">
          {live || status === 'PAUSED' ? (
            <span className="tpanel__rec"><span className={`rec__dot${live ? ' is-live' : ''}`} aria-hidden /><strong>{live ? 'REC' : 'PAUSE'}</strong><span className="rec__time">{formatHMS(elapsed)}</span></span>
          ) : <span className="rec__dot" aria-hidden />}
          <strong className="tpanel__title">Transcription</strong>
          <span className="muted">·</span>
          <span data-testid="capture-status">{STATUS_LABELS[status]}</span>
          {providerLabel && <span className="muted">· {providerLabel}</span>}
          {!providerLabel && <span className="muted">· audio seul</span>}
        </div>
        {providerPrivacy && <p className="tpanel__privacy">{providerPrivacy}</p>}
        {(audioBytes > 0 || info) && (
          <p className="tpanel__storage" data-testid="storage-line">
            Audio enregistré : {formatBytes(audioBytes)}
            {info && info.level !== 'unknown' && <> · Espace disponible : {formatBytes(info.free)}</>}
            {audioStopped && <strong className="warn"> · audio arrêté</strong>}
          </p>
        )}
      </header>

      {error && (
        <div className="banner banner--warn tpanel__banner" role="alert" data-testid="capture-error">
          <TriangleAlert size={15} aria-hidden /> <span>{error.message} <em>Vos notes ne sont pas affectées.</em></span>
          {error.recoverable && <button className="btn btn--sm" onClick={request}>Reprendre la transcription</button>}
        </div>
      )}
      {!error && unresolved && (
        <div className="banner tpanel__banner" role="status" data-testid="capture-warning"><TriangleAlert size={15} aria-hidden /> <span>{unresolved.message}</span></div>
      )}
      {info && (info.level === 'low' || info.level === 'critical') && !audioStopped && (
        <div className="banner tpanel__banner" role="status" data-testid="storage-warning"><TriangleAlert size={15} aria-hidden /> <span>Espace de stockage faible ({formatBytes(info.free)} disponibles). Libérez de l’espace avant qu’il ne soit saturé.</span></div>
      )}
      {failed > 0 && canStart === false && (
        <div className="banner tpanel__banner"><span>{failed} segment(s) audio non transcrits.</span>
          <button className="btn btn--sm" onClick={() => void captureManager.retryFailed(sessionId)}>Réessayer</button></div>
      )}

      <div className="tpanel__scroll" ref={scroller} onScroll={onScroll} data-testid="transcript-scroll">
        {items.length === 0 && !interim ? (
          <div className="tpanel__empty">
            <Mic size={20} aria-hidden />
            {status === 'RECORDING'
              ? <p>En écoute… la transcription apparaît ici au fil du cours.</p>
              : <>
                  <p>{loaded ? 'Aucune transcription pour ce CM.' : 'Chargement…'}</p>
                  {variant === 'live' && canStart && <button className="btn btn--sm" onClick={request}><Mic /> {audio ? 'Reprendre la transcription' : 'Activer la transcription'}</button>}
                </>}
          </div>
        ) : (
          <ol className="tlist" ref={list}>
            {hidden > 0 && (
              <li className="tmore"><button className="btn btn--sm" data-testid="load-earlier" onClick={() => {
                const el = scroller.current; const before = el ? el.scrollHeight - el.scrollTop : 0;
                following.current = false; setAtBottom(false); setShown((n) => n + PAGE);
                requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; }); // garde la position de lecture
              }}>Afficher les {Math.min(PAGE, hidden)} passages précédents ({hidden})</button></li>
            )}
            {windowed.map((it) => it.kind === 'seg'
              ? <Row key={it.seg.id} seg={it.seg} originAt={audio?.originAt ?? 0} selected={selected === it.seg.id} onPick={pick} />
              : <MarkRow key={it.marker.id} marker={it.marker} onPick={pickMs} />)}
            {interim && <li className="tseg tseg--interim" aria-live="off"><time>…</time><p>{interim}</p></li>}
          </ol>
        )}
      </div>

      {variant === 'live' && !atBottom && items.length > 0 && (
        <button className="tpanel__live" onClick={() => { const el = scroller.current; following.current = true; if (el) el.scrollTop = el.scrollHeight; setAtBottom(true); }} data-testid="back-to-live">
          <ArrowDown size={14} /> Revenir au direct
        </button>
      )}
      <MiniPlayer sessionId={sessionId} startAtMs={play.ms} nonce={play.nonce} chunkCount={chunks.length} />
      {dialog}
    </section>
  );
}
