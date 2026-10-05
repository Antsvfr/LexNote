import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/domain/capture';
import { TranscriptIndex } from './transcriptSearch';

const seg = (id: string, sessionId: string, startMs: number, text: string) => ({ id, sessionId, startMs, text } as TranscriptSegment);

describe('recherche dans les transcriptions', () => {
  it('retrouve « dol » (casse et accents ignorés) avec session et instant', async () => {
    const idx = new TranscriptIndex();
    await idx.ensure(async () => [
      seg('1', 'cm1', 5000, 'Le DOL suppose des manœuvres'),
      seg('2', 'cm1', 9000, 'La violence est un autre vice'),
      seg('3', 'cm2', 1000, 'Le dol par réticence : arrêt Baldus'),
    ]);
    const hits = idx.search('dol');
    expect(hits.map((h) => [h.sessionId, h.startMs])).toEqual([['cm1', 5000], ['cm2', 1000]]);
    expect(idx.search('réticence')[0]?.sessionId).toBe('cm2');
    expect(idx.search('RETICENCE')).toHaveLength(1);
  });
  it('tous les mots doivent correspondre', async () => {
    const idx = new TranscriptIndex();
    idx.add(seg('1', 'a', 0, 'le dol est un vice'));
    expect(idx.search('dol vice')).toHaveLength(1);
    expect(idx.search('dol violence')).toHaveLength(0);
    expect(idx.search('  ')).toEqual([]);
  });
  it('mise à jour incrémentale et suppression par CM', () => {
    const idx = new TranscriptIndex();
    idx.add(seg('1', 'a', 0, 'dol'));
    idx.add(seg('2', 'b', 0, 'dol'));
    idx.removeSession('a');
    expect(idx.search('dol').map((h) => h.sessionId)).toEqual(['b']);
  });
  it('indexe 3 h de cours (≈ 20 000 segments) puis recherche en quelques ms', async () => {
    const idx = new TranscriptIndex();
    const all = Array.from({ length: 20_000 }, (_, i) => seg(`s${i}`, `cm${i % 8}`, i * 5000, `phrase ${i} du cours sur le contrat et le consentement ${i % 97 === 0 ? 'dol' : ''}`));
    const t0 = performance.now();
    await idx.ensure(async () => all);
    const build = performance.now() - t0;
    const t1 = performance.now();
    const hits = idx.search('dol');
    const q = performance.now() - t1;
    expect(hits.length).toBeGreaterThan(0);
    expect(build).toBeLessThan(3000);
    expect(q).toBeLessThan(150);
  });
});
