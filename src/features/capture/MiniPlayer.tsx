import { useEffect, useState } from 'react';
import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { formatHMS } from '@/domain/capture';
import { captureManager } from '@/services/capture/manager';
import type { ChunkPlayer, PlayerState } from '@/services/capture/playback';

/** Lecteur minimal : -10 s · ▶ · +10 s. Pas de montage, pas de vitesse, pas de découpe. */
export function MiniPlayer({ sessionId, startAtMs, nonce, chunkCount }: { sessionId: string; startAtMs: number | null; nonce: number; chunkCount: number }) {
  const [player, setPlayer] = useState<ChunkPlayer | null>(null);
  const [st, setSt] = useState<PlayerState>({ playing: false, positionMs: 0, available: false });

  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    captureManager.getPlayer(sessionId).then((p) => {
      if (cancelled) return;
      setPlayer(p);
      off = p.subscribe(setSt);
    }).catch(() => undefined);
    return () => { cancelled = true; off?.(); };
  }, [sessionId]);

  // Nouveaux segments audio (enregistrement en cours) : on recharge la liste.
  useEffect(() => { if (player) void player.load(); }, [player, chunkCount]);

  // Clic sur un segment de transcription → lecture à cet instant.
  useEffect(() => {
    if (player && startAtMs !== null) void player.playFrom(startAtMs);
    // `nonce` change à chaque clic, même sur le même segment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  if (!player || !st.available) return null;
  return (
    <div className="miniplayer" role="group" aria-label="Réécoute" data-testid="miniplayer">
      <button className="btn btn--ghost btn--sm" onClick={() => void player.seekBy(-10_000)} aria-label="Reculer de 10 secondes"><RotateCcw /> 10 s</button>
      <button className="btn btn--primary btn--icon btn--sm" onClick={() => (st.playing ? player.pause() : st.positionMs > 0 ? player.toggle() : void player.playFrom(0))} aria-label={st.playing ? 'Pause' : 'Lecture'} data-testid="play-btn">
        {st.playing ? <Pause /> : <Play />}
      </button>
      <button className="btn btn--ghost btn--sm" onClick={() => void player.seekBy(10_000)} aria-label="Avancer de 10 secondes">10 s <RotateCw /></button>
      <span className="miniplayer__pos" data-testid="player-pos">{formatHMS(st.positionMs)}</span>
    </div>
  );
}
