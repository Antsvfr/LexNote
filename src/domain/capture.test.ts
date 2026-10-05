import { describe, expect, it } from 'vitest';
import { formatBytes, formatHMS, insertSorted, nearbySegmentIds, recordedMs, segmentAt, segmentsWordCount, wallClock } from './capture';

const S = (id: string, startMs: number, endMs: number) => ({ id, startMs, endMs });

describe('timestamps et durées', () => {
  it('formatHMS', () => {
    expect(formatHMS(0)).toBe('00:00:00');
    expect(formatHMS(5_025_000)).toBe('01:23:45');
    expect(formatHMS(-5)).toBe('00:00:00');
  });
  it('recordedMs additionne les runs (hors pauses) et compte le run ouvert', () => {
    const runs = [
      { id: 'a', startMs: 0, endMs: 10_000, endReason: 'pause' as const },
      { id: 'b', startMs: 60_000, endMs: null, endReason: null },
    ];
    expect(recordedMs(runs, 75_000)).toBe(25_000);
  });
  it('wallClock donne l’heure murale', () => {
    const origin = new Date(2026, 2, 2, 10, 14, 0).getTime();
    expect(wallClock(origin, 23_000)).toBe('10:14:23');
  });
  it('formatBytes', () => {
    expect(formatBytes(2048)).toBe('2 Ko');
    expect(formatBytes(214 * 1024 * 1024)).toBe('214 Mo');
    expect(formatBytes(3.5 * 1024 ** 3)).toBe('3.50 Go');
  });
});

describe('segments', () => {
  it('insertSorted conserve l’ordre chronologique', () => {
    let l: { startMs: number }[] = [];
    [5, 1, 9, 3].forEach((t) => { l = insertSorted(l, { startMs: t }); });
    expect(l.map((x) => x.startMs)).toEqual([1, 3, 5, 9]);
  });
  it('segmentAt retrouve le segment à un instant', () => {
    const segs = [S('a', 0, 5000), S('b', 6000, 9000)];
    expect(segmentAt(segs, 7000)?.id).toBe('b');
    expect(segmentAt(segs, 5200)?.id).toBe('a');
    expect(segmentAt(segs, 30_000)).toBeUndefined();
  });
  it('compte les mots de la transcription', () => {
    expect(segmentsWordCount([{ text: 'le dol est une tromperie' }, { text: 'article 1128' }])).toBe(7);
  });
});

describe('NoteAnchor — segments proches', () => {
  const segs = Array.from({ length: 100 }, (_, i) => S(`s${i}`, i * 10_000, i * 10_000 + 8000));
  it('trouve les segments qui chevauchent la fenêtre [t-20 s ; t+5 s]', () => {
    const ids = nearbySegmentIds(segs, 500_000);
    expect(ids).toContain('s48'); // 480–488 s
    expect(ids).toContain('s50');
    expect(ids).not.toContain('s40');
    expect(ids).not.toContain('s60');
  });
  it('fonctionne aux bornes', () => {
    expect(nearbySegmentIds(segs, 0)[0]).toBe('s0');
    expect(nearbySegmentIds([], 1000)).toEqual([]);
  });
  it('reste rapide sur 3 h de transcription (≈ 1 800 segments) et des milliers d’ancrages', () => {
    const big = Array.from({ length: 1800 }, (_, i) => S(`g${i}`, i * 6000, i * 6000 + 5000));
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) nearbySegmentIds(big, i * 5400);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
