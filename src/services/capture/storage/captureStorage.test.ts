import { beforeEach, describe, expect, it } from 'vitest';
import type { AudioChunk, AudioSession, TranscriptSegment } from '@/domain/capture';
import { IndexedDbCaptureStorage } from './idb';
import { MemoryCaptureStorage } from './memory';
import type { CaptureStorage } from './types';

const factories: [string, () => Promise<CaptureStorage>][] = [
  ['memory', async () => new MemoryCaptureStorage(true)],
  ['indexeddb', async () => IndexedDbCaptureStorage.open(`cap-${Math.random().toString(36).slice(2)}`)],
];

const seg = (id: string, sessionId: string, startMs: number, text = 'texte'): TranscriptSegment => ({
  id, sessionId, startMs, endMs: startMs + 1000, text, provider: 'fake', status: 'final', source: 'TRANSCRIPTION', verification: 'UNVERIFIED', createdAt: 'x',
});
const chunk = (id: string, sessionId: string, sequence: number, size = 1000): AudioChunk => ({
  id, sessionId, sequence, runId: 'r', startMs: sequence * 30000, endMs: (sequence + 1) * 30000, durationMs: 30000, mimeType: 'audio/webm', size, createdAt: 'x', status: 'stored', transcription: 'none',
});
const audio = (sessionId: string): AudioSession => ({
  id: sessionId, sessionId, originAt: 1, mimeType: 'audio/webm', bitsPerSecond: 32000, chunkMs: 30000, keepAudio: true, providerId: null,
  runs: [], status: 'RECORDING', createdAt: 'x', updatedAt: 'x',
});

describe.each(factories)('CaptureStorage contract — %s', (_n, make) => {
  let db: CaptureStorage;
  beforeEach(async () => { db = await make(); });

  it('stocke les segments audio (données + métadonnées) dans l’ordre', async () => {
    await db.putChunk(chunk('c2', 's1', 2), new Blob([new Uint8Array(500)], { type: 'audio/webm' }));
    await db.putChunk(chunk('c1', 's1', 1), new Blob([new Uint8Array(700)], { type: 'audio/webm' }));
    expect((await db.listChunks('s1')).map((c) => c.id)).toEqual(['c1', 'c2']);
    const blob = await db.getChunkBlob('c1');
    expect(blob?.size).toBe(700);
    expect(blob?.type).toBe('audio/webm');
  });

  it('calcule l’audio utilisé par CM', async () => {
    await db.putChunk(chunk('a', 's1', 1, 100), new Blob([new Uint8Array(100)]));
    await db.putChunk(chunk('b', 's1', 2, 200), new Blob([new Uint8Array(200)]));
    await db.putChunk(chunk('c', 's2', 1, 50), new Blob([new Uint8Array(50)]));
    expect(await db.audioUsage()).toEqual({ s1: 300, s2: 50 });
  });

  it('deleteAudio supprime l’audio mais conserve transcription et marqueurs', async () => {
    await db.putChunk(chunk('a', 's1', 1), new Blob([new Uint8Array(10)]));
    await db.putSegments([seg('g1', 's1', 0)]);
    await db.putMarker({ id: 'm', sessionId: 's1', atMs: 5, reasons: [], createdAt: 'x' });
    await db.deleteAudio('s1');
    expect(await db.listChunks('s1')).toHaveLength(0);
    expect(await db.getChunkBlob('a')).toBeUndefined();
    expect(await db.listSegments('s1')).toHaveLength(1);
    expect(await db.listMarkers('s1')).toHaveLength(1);
  });

  it('deleteSession supprime TOUT ce qui concerne un CM, et rien d’un autre', async () => {
    for (const sid of ['s1', 's2']) {
      await db.putAudioSession(audio(sid));
      await db.putChunk(chunk(`c-${sid}`, sid, 1), new Blob([new Uint8Array(10)]));
      await db.putSegments([seg(`g-${sid}`, sid, 0)]);
      await db.putMarker({ id: `m-${sid}`, sessionId: sid, atMs: 1, reasons: ['exam'], createdAt: 'x' });
      await db.putAnchors([{ id: `a-${sid}`, sessionId: sid, timestamp: 1, notePosition: 1, textSnippet: 't', nearbyTranscriptSegmentIds: [], createdAt: 'x' }]);
      await db.putInterruption({ id: `i-${sid}`, sessionId: sid, atMs: 1, kind: 'device', message: 'm', recoverable: true });
    }
    await db.deleteSession('s1');
    const ex1 = await db.exportSession('s1');
    expect(ex1.audioSession).toBeUndefined();
    expect([ex1.chunks, ex1.segments, ex1.markers, ex1.anchors, ex1.interruptions].every((l) => l.length === 0)).toBe(true);
    expect(await db.getChunkBlob('c-s1')).toBeUndefined();
    const ex2 = await db.exportSession('s2');
    expect(ex2.audioSession).toBeDefined();
    expect([ex2.chunks, ex2.segments, ex2.markers, ex2.anchors, ex2.interruptions].every((l) => l.length === 1)).toBe(true);
  });

  it('listAllSegments alimente la recherche globale', async () => {
    await db.putSegments([seg('1', 's1', 0, 'le dol'), seg('2', 's2', 0, 'la violence')]);
    expect((await db.listAllSegments()).map((s) => s.text).sort()).toEqual(['la violence', 'le dol']);
  });

  it('clearAll', async () => {
    await db.putSegments([seg('1', 's1', 0)]);
    await db.clearAll();
    expect(await db.listAllSegments()).toHaveLength(0);
  });
});

describe('IndexedDB capture — indépendante de la base des notes', () => {
  it('utilise une base distincte PAR COMPTE : saturer l’audio ne peut pas toucher les notes, ni un autre compte', async () => {
    const { captureDbName } = await import('./idb');
    const { userDbName } = await import('../../storage/indexedDbAdapter');
    expect(captureDbName('a')).toBe('lexnote-capture-u-a');
    expect(captureDbName('a')).not.toBe(userDbName('a'));
    expect(captureDbName('a')).not.toBe(captureDbName('b'));
  });
  it('persiste après réouverture', async () => {
    const name = `reopen-${Math.random().toString(36).slice(2)}`;
    const a = await IndexedDbCaptureStorage.open(name);
    await a.putSegments([seg('1', 's1', 0, 'persistant')]);
    await a.putChunk(chunk('c', 's1', 1), new Blob([new Uint8Array(42)]));
    const b = await IndexedDbCaptureStorage.open(name);
    expect((await b.listSegments('s1'))[0]?.text).toBe('persistant');
    expect((await b.getChunkBlob('c'))?.size).toBe(42);
  });
});
