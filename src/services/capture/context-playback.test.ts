import { describe, expect, it, vi } from 'vitest';
import { MemoryCaptureStorage } from './storage/memory';
import { ChunkPlayer } from './playback';
import { buildCourseContext } from '@/services/course/courseContext';
import { sess } from '@/test/fixtures';
import { docToPlainText } from '@/lib/docText';

describe('CourseContext (interface pour le futur moteur IA)', () => {
  it('réunit notes, transcription, marqueurs, ancrages — sources séparées et étiquetées', async () => {
    const cap = new MemoryCaptureStorage(true);
    const session = sess({ subjectId: 's', moduleId: 'm', title: 'Dol', number: 4, date: '2026-03-02' });
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Le dol vicie le consentement' }] }] };
    await cap.putSegments([{ id: 'g1', sessionId: session.id, startMs: 0, endMs: 2000, text: 'Article 1137 du Code civil', provider: 'fake', status: 'final', source: 'TRANSCRIPTION', verification: 'UNVERIFIED', createdAt: 'x' }]);
    await cap.putMarker({ id: 'm1', sessionId: session.id, atMs: 1000, reasons: ['exam'], createdAt: 'x' });
    await cap.putAnchors([{ id: 'a1', sessionId: session.id, timestamp: 1500, notePosition: 3, textSnippet: 'Le dol', nearbyTranscriptSegmentIds: ['g1'], createdAt: 'x' }]);
    const ctx = await buildCourseContext(session.id, { getSession: () => session, loadNotes: async () => doc, capture: cap });
    expect(ctx.session.id).toBe(session.id);
    expect(ctx.notes.plainText).toBe('Le dol vicie le consentement');
    expect(ctx.notes.wordCount).toBe(5);
    expect(ctx.transcript.segments).toHaveLength(1);
    expect(ctx.markers).toHaveLength(1);
    expect(ctx.noteAnchors[0]?.nearbyTranscriptSegmentIds).toEqual(['g1']);
    expect(ctx.documents).toEqual([]); // import de documents : pas encore
    expect(ctx.sources.notes).toMatchObject({ provenance: 'USER_NOTE', available: true });
    expect(ctx.sources.transcript).toMatchObject({ provenance: 'TRANSCRIPTION', available: true });
    expect(ctx.sources.documents).toMatchObject({ provenance: 'DOCUMENT', available: false });
    // la transcription n'est jamais auto-vérifiée
    expect(ctx.transcript.segments.every((s) => s.verification === 'UNVERIFIED' && s.source === 'TRANSCRIPTION')).toBe(true);
  });
  it('CM inconnu → erreur explicite', async () => {
    await expect(buildCourseContext('nope', { getSession: () => undefined, loadNotes: async () => undefined, capture: new MemoryCaptureStorage() })).rejects.toThrow(/introuvable/);
  });
  it('CM vide : sources indisponibles mais contexte valide', async () => {
    const s = sess({ subjectId: 's', moduleId: 'm', title: '', number: 1, date: '2026-03-02' });
    const ctx = await buildCourseContext(s.id, { getSession: () => s, loadNotes: async () => undefined, capture: new MemoryCaptureStorage() });
    expect(ctx.sources.notes.available).toBe(false);
    expect(ctx.audio).toBeNull();
  });
  it('docToPlainText', () => {
    expect(docToPlainText({ type: 'doc', content: [{ type: 'heading', content: [{ type: 'text', text: 'A' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] })).toBe('A\nB');
  });
});

class FakeAudio {
  src = ''; paused = true; readyState = 4; currentTime = 0;
  onended: (() => void) | null = null; ontimeupdate: (() => void) | null = null; onpause: (() => void) | null = null; onplay: (() => void) | null = null; onerror: (() => void) | null = null;
  play() { this.paused = false; this.onplay?.(); return Promise.resolve(); }
  pause() { this.paused = true; this.onpause?.(); }
  removeAttribute() { this.src = ''; }
  addEventListener(_: string, fn: () => void) { fn(); }
}

describe('réécoute (ChunkPlayer)', () => {
  async function setup() {
    const cap = new MemoryCaptureStorage(true);
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn();
    for (let i = 0; i < 3; i++) {
      await cap.putChunk({ id: `c${i}`, sessionId: 's', sequence: i + 1, runId: 'r', startMs: i * 30_000, endMs: (i + 1) * 30_000, durationMs: 30_000, mimeType: 'audio/webm', size: 10, createdAt: 'x', status: 'stored', transcription: 'none' }, new Blob([new Uint8Array(10)]));
    }
    const audio = new FakeAudio();
    const player = new ChunkPlayer(cap, 's', () => audio as unknown as HTMLAudioElement);
    await player.load();
    return { audio, player };
  }
  it('lit depuis un instant donné : choisit le bon segment et le bon décalage', async () => {
    const { audio, player } = await setup();
    await player.playFrom(45_000);
    expect(audio.currentTime).toBeCloseTo(15);
    expect(audio.paused).toBe(false);
    expect(player.state.positionMs).toBeCloseTo(45_000);
  });
  it('-10 s / +10 s', async () => {
    const { audio, player } = await setup();
    await player.playFrom(45_000);
    await player.seekBy(-10_000);
    expect(audio.currentTime).toBeCloseTo(5);
    await player.seekBy(10_000);
    expect(audio.currentTime).toBeCloseTo(15);
  });
  it('enchaîne les segments à la fin de chacun', async () => {
    const { audio, player } = await setup();
    await player.playFrom(10_000);
    audio.onended?.(); await new Promise((r) => setTimeout(r, 0));
    expect(audio.currentTime).toBe(0);
    expect(player.state.positionMs).toBeCloseTo(30_000);
  });
  it('disponible seulement si de l’audio existe', async () => {
    const empty = new ChunkPlayer(new MemoryCaptureStorage(), 'x', () => new FakeAudio() as unknown as HTMLAudioElement);
    expect(await empty.load()).toBe(false);
    expect(empty.state.available).toBe(false);
  });
});
