import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMediaRecorder, FakeProvider, makeRig } from './testing';
import { MemoryCaptureStorage } from './storage/memory';
import { CaptureController } from './controller';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-03-02T10:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('permission micro', () => {
  it('ne démarre jamais tout seul : le micro n’est demandé qu’à start()', async () => {
    const r = await makeRig(vi);
    expect(r.getUserMedia).not.toHaveBeenCalled();
    expect(r.controller.status).toBe('INACTIVE');
  });

  it('passe par REQUESTING_PERMISSION → STARTING → RECORDING', async () => {
    const r = await makeRig(vi);
    const seen: string[] = [];
    r.controller.subscribe((e) => e.type === 'status' && seen.push(e.status));
    await r.controller.start();
    expect(seen).toEqual(['REQUESTING_PERMISSION', 'STARTING', 'RECORDING']);
    expect(r.getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it('permission refusée → ERROR explicite, rien n’est enregistré', async () => {
    const r = await makeRig(vi, { getUserMediaError: 'NotAllowedError' });
    await r.controller.start();
    expect(r.controller.status).toBe('ERROR');
    expect(r.controller.error?.kind).toBe('permission');
    expect(r.controller.error?.recoverable).toBe(false);
    expect(r.controller.error?.message).toMatch(/refusé/);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(await r.storage.getAudioSession('cm1')).toBeUndefined();
  });

  it('microphone introuvable → ERROR récupérable', async () => {
    const r = await makeRig(vi, { getUserMediaError: 'NotFoundError' });
    await r.controller.start();
    expect(r.controller.error).toMatchObject({ kind: 'device', recoverable: true });
  });
});

describe('enregistrement par segments', () => {
  it('produit un segment autonome toutes les 30 s, avec séquence, bornes et durée', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    await advance(65_000);
    await r.controller.stop();
    const chunks = await r.storage.listChunks('cm1');
    expect(chunks.length).toBe(3); // 30 s + 30 s + 5 s
    expect(chunks.map((c) => c.sequence)).toEqual([1, 2, 3]);
    chunks.forEach((c) => {
      expect(c.sessionId).toBe('cm1');
      expect(c.size).toBe(1000);
      expect(c.status).toBe('stored');
      expect(c.mimeType).toContain('webm');
      expect(c.durationMs).toBe(c.endMs - c.startMs);
    });
    expect(chunks[0]!.durationMs).toBeGreaterThanOrEqual(29_900);
    expect(chunks[1]!.startMs).toBeLessThanOrEqual(chunks[0]!.endMs + 5); // pas de trou entre segments
    expect(await r.storage.getChunkBlob(chunks[0]!.id)).toBeInstanceOf(Blob);
  });

  it('démarre le segment suivant AVANT d’arrêter le précédent (aucun trou)', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    await advance(30_000);
    expect(FakeMediaRecorder.instances).toHaveLength(2);
    expect(FakeMediaRecorder.instances[1]!.state).toBe('recording');
  });
});

describe('pause / reprise / arrêt', () => {
  it('pause coupe le micro, reprise ré-acquiert un micro et ouvre un nouveau run', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    await advance(10_000);
    await r.controller.pause();
    expect(r.controller.status).toBe('PAUSED');
    expect(r.streams[0]!.tracks[0]!.readyState).toBe('ended'); // micro réellement coupé
    await advance(20_000);
    await r.controller.resume();
    expect(r.controller.status).toBe('RECORDING');
    expect(r.getUserMedia).toHaveBeenCalledTimes(2);
    await advance(10_000);
    await r.controller.stop();
    const audio = (await r.storage.getAudioSession('cm1'))!;
    expect(audio.runs).toHaveLength(2);
    expect(audio.runs[0]).toMatchObject({ endReason: 'pause' });
    expect(audio.runs[1]).toMatchObject({ endReason: 'user' });
    // la pause de 20 s est un trou dans la timeline
    expect(audio.runs[1]!.startMs - audio.runs[0]!.endMs!).toBeGreaterThanOrEqual(19_000);
    expect(audio.status).toBe('COMPLETED');
  });

  it('la durée enregistrée exclut les pauses', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    await advance(10_000);
    await r.controller.pause();
    await advance(60_000);
    await r.controller.resume();
    await advance(10_000);
    expect(Math.round(r.controller.recordedMs() / 1000)).toBe(20);
  });

  it('stop libère le micro et passe par PROCESSING → COMPLETED', async () => {
    const r = await makeRig(vi);
    const seen: string[] = [];
    r.controller.subscribe((e) => e.type === 'status' && seen.push(e.status));
    await r.controller.start();
    await r.controller.stop();
    expect(seen.slice(-2)).toEqual(['PROCESSING', 'COMPLETED']);
    expect(r.streams[0]!.tracks[0]!.readyState).toBe('ended');
    expect(r.provider!.state).toBe('disposed');
  });
});

describe('segments de transcription', () => {
  it('conserve id, session, bornes, texte, confidence optionnelle, provider, provenance TRANSCRIPTION / UNVERIFIED', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    await advance(5000);
    r.provider!.say('Pour qu’un contrat soit valablement formé…', 1000, 4000, 0.93);
    r.provider!.say('L’article 1128 du Code civil prévoit…', 4500, 8000);
    await r.controller.stop();
    const segs = await r.storage.listSegments('cm1');
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ sessionId: 'cm1', startMs: 1000, endMs: 4000, confidence: 0.93, provider: 'fake', status: 'final', source: 'TRANSCRIPTION', verification: 'UNVERIFIED' });
    expect(segs[0]!.id).toBeTruthy();
    expect(segs[1]!.confidence).toBeUndefined();
  });

  it('un texte qui cite « article 1128 » n’est jamais « vérifié »', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    r.provider!.say('Article 1128 du Code civil', 0, 3000);
    const seg = r.controller.segments[0]!;
    expect(seg.source).toBe('TRANSCRIPTION');
    expect(seg.verification).toBe('UNVERIFIED');
  });

  it('ignore les segments vides et garde l’ordre chronologique', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    r.provider!.say('   ', 0, 1000);
    r.provider!.say('second', 5000, 6000);
    r.provider!.say('premier', 1000, 2000);
    expect(r.controller.segments.map((s) => s.text)).toEqual(['premier', 'second']);
  });
});

describe('moteur par chunks', () => {
  it('envoie chaque chunk au moteur, dans l’ordre, et marque la transcription « done »', async () => {
    const p = new FakeProvider('chunk');
    const r = await makeRig(vi, { provider: p });
    await r.controller.start();
    await advance(61_000);
    await r.controller.stop();
    expect(p.chunks.map((c) => c.id).length).toBe(3);
    expect(p.chunks[0]!.startMs).toBeLessThan(p.chunks[1]!.startMs);
    const chunks = await r.storage.listChunks('cm1');
    expect(chunks.every((c) => c.transcription === 'done')).toBe(true);
    expect((await r.storage.listSegments('cm1')).length).toBe(3);
  });

  it('erreur provider : réessaie, puis marque « failed » SANS arrêter l’enregistrement ; l’audio est conservé', async () => {
    const p = new FakeProvider('chunk');
    p.failTimes = 99;
    const r = await makeRig(vi, { provider: p });
    await r.controller.start();
    await advance(31_000);
    await advance(500);
    expect(r.controller.status).toBe('RECORDING'); // toujours en train d'enregistrer
    const chunks = await r.storage.listChunks('cm1');
    expect(chunks[0]).toMatchObject({ status: 'stored', transcription: 'failed' });
    expect(r.controller.interruptions.some((i) => i.kind === 'provider')).toBe(true);
    expect(await r.storage.getChunkBlob(chunks[0]!.id)).toBeTruthy();
  });

  it('réessai transitoire : 2 échecs puis succès', async () => {
    const p = new FakeProvider('chunk');
    p.failTimes = 2;
    const r = await makeRig(vi, { provider: p });
    await r.controller.start();
    await advance(31_000);
    await advance(500);
    expect((await r.storage.listChunks('cm1'))[0]!.transcription).toBe('done');
    expect(r.controller.interruptions).toHaveLength(0);
  });

  it('retryFailedChunks relance la transcription des chunks en échec', async () => {
    const p = new FakeProvider('chunk');
    p.failTimes = 99;
    const r = await makeRig(vi, { provider: p });
    await r.controller.start();
    await advance(31_000); await advance(500);
    p.failTimes = 0;
    expect(await r.controller.retryFailedChunks()).toBeGreaterThan(0);
    await advance(100);
    expect((await r.storage.listChunks('cm1'))[0]!.transcription).toBe('done');
  });
});

describe('interruptions et reprise', () => {
  it('micro débranché : segments valides conservés, interruption enregistrée, état ERROR reprenable', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    r.provider!.say('avant la coupure', 1000, 2000);
    await advance(35_000);
    r.streams[0]!.tracks[0]!.unplug();
    await advance(100);
    expect(r.controller.status).toBe('ERROR');
    expect(r.controller.error).toMatchObject({ kind: 'device', recoverable: true });
    expect((await r.storage.listChunks('cm1')).length).toBeGreaterThanOrEqual(1);
    expect(await r.storage.listSegments('cm1')).toHaveLength(1);
    const ints = await r.storage.listInterruptions('cm1');
    expect(ints).toHaveLength(1);
    expect(ints[0]!.kind).toBe('device');

    await r.controller.resume(); // « Reprendre la transcription »
    expect(r.controller.status).toBe('RECORDING');
    const audio = (await r.storage.getAudioSession('cm1'))!;
    expect(audio.runs.map((x) => x.endReason)).toEqual(['interrupted', null]);
    expect(r.controller.interruptions[0]!.resolvedAtMs).toBeDefined();
    r.provider!.say('après la reprise', 50_000, 52_000);
    await r.controller.stop();
    expect(await r.storage.listSegments('cm1')).toHaveLength(2);
  });

  it('MediaRecorder interrompu de lui-même → interruption « recorder », données conservées', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    await advance(5000);
    FakeMediaRecorder.instances[0]!.crash();
    await advance(50);
    expect(r.controller.status).toBe('ERROR');
    expect(r.controller.interruptions.at(-1)?.kind).toBe('recorder');
    expect((await r.storage.listChunks('cm1')).length).toBe(1);
  });

  it('mise en veille détectée (saut d’horloge) → interruption « system-sleep », l’enregistrement continue', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    await advance(2000);
    vi.setSystemTime(Date.now() + 120_000); // l'ordinateur « dort » 2 min
    await advance(1000);
    expect(r.controller.status).toBe('RECORDING');
    const it = r.controller.interruptions.find((i) => i.kind === 'system-sleep');
    expect(it).toBeTruthy();
    expect(it!.resolvedAtMs).toBeDefined();
  });

  it('moteur indisponible à l’initialisation : l’audio est quand même enregistré', async () => {
    const p = new FakeProvider('live');
    p.failInit = true;
    const r = await makeRig(vi, { provider: p });
    await r.controller.start();
    expect(r.controller.status).toBe('RECORDING');
    expect(r.controller.interruptions[0]?.kind).toBe('provider');
    await advance(31_000);
    expect((await r.storage.listChunks('cm1')).length).toBeGreaterThan(0);
  });

  it('erreur réseau du moteur : une seule interruption, résolue au retour des segments', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    r.provider!.ctx.onError({ kind: 'network', recoverable: true, message: 'réseau perdu' });
    r.provider!.ctx.onError({ kind: 'network', recoverable: true, message: 'réseau perdu' });
    await advance(10);
    expect(r.controller.interruptions.filter((i) => i.kind === 'network')).toHaveLength(1);
    r.provider!.say('de retour', 1000, 2000);
    expect(r.controller.interruptions[0]!.resolvedAtMs).toBeDefined();
    expect(r.controller.status).toBe('RECORDING');
  });

  it('fermeture brutale de l’app : à la réouverture le run orphelin est refermé et signalé, rien n’est perdu', async () => {
    const storage = new MemoryCaptureStorage(true);
    const r1 = await makeRig(vi, { storage });
    await r1.controller.start();
    r1.provider!.say('dit avant le crash', 1000, 3000);
    await advance(31_000); // un chunk écrit, segments flushés
    // → la page disparaît sans stop() : on crée un NOUVEAU contrôleur sur le même stockage
    const r2 = await makeRig(vi, { storage });
    const loaded = await r2.controller.load();
    expect(loaded.audioSession!.runs[0]!.endReason).toBe('interrupted');
    expect(loaded.audioSession!.runs[0]!.endMs).not.toBeNull();
    expect(loaded.interruptions.some((i) => i.kind === 'app-closed')).toBe(true);
    expect(loaded.segments).toHaveLength(1);
    expect(loaded.chunks.length).toBeGreaterThanOrEqual(1);
    expect(r2.controller.status).toBe('PAUSED'); // prête à « Reprendre la transcription »
    await r2.controller.resume();
    expect(r2.controller.status).toBe('RECORDING');
    expect(r2.controller.cmNow()).toBeGreaterThan(30_000); // la même horloge de CM continue
  });
});

describe('incident multiple', () => {
  it('recorder + micro qui tombent en même temps = UNE seule interruption', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    await advance(1000);
    r.streams[0]!.tracks[0]!.unplug();
    FakeMediaRecorder.instances[0]!.crash();
    await advance(100);
    expect(r.controller.interruptions).toHaveLength(1);
    expect(r.controller.status).toBe('ERROR');
  });
});

describe('dernier segment', () => {
  it('à l’arrêt, le dernier segment audio est transcrit avant la fin (chunk provider)', async () => {
    const p = new FakeProvider('chunk');
    const r = await makeRig(vi, { provider: p });
    // écriture audio lente : le segment est encore « en cours d'écriture » quand stop() est appelé
    const orig = r.storage.putChunk.bind(r.storage);
    r.storage.putChunk = async (m, b) => { await new Promise((res) => setTimeout(res, 200)); return orig(m, b); };
    await r.controller.start();
    await advance(5000);
    const stopping = r.controller.stop();
    await advance(1000);
    await stopping;
    expect(p.chunks).toHaveLength(1);
    expect((await r.storage.listChunks('cm1'))[0]!.transcription).toBe('done');
  });
});

describe('stockage audio', () => {
  it('stockage presque plein : l’audio n’est plus conservé, la transcription et l’enregistrement logique continuent', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    r.info.current = { usage: 9.99e9, quota: 10e9, free: 10e6, level: 'critical', persisted: false };
    await advance(31_000);
    expect(r.controller.status).toBe('RECORDING');
    expect(r.controller.audioStopped).toBe(true);
    expect(r.controller.interruptions.some((i) => i.kind === 'storage')).toBe(true);
    r.provider!.say('toujours transcrit', 40_000, 41_000);
    await r.controller.stop();
    expect(await r.storage.listSegments('cm1')).toHaveLength(1);
  });

  it('écriture refusée (QuotaExceeded) : interruption « storage », aucune exception, segment marqué failed', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    r.storage.failChunkWrites = true;
    await advance(31_000);
    expect(r.controller.status).toBe('RECORDING');
    expect(r.controller.chunks[0]!.status).toBe('failed');
    expect(r.controller.interruptions.some((i) => i.kind === 'storage')).toBe(true);
  });

  it('keepAudio=false : aucun audio écrit, transcription seule', async () => {
    const r = await makeRig(vi, { settings: { keepAudio: false } });
    await r.controller.start();
    await advance(31_000);
    expect(await r.storage.listChunks('cm1')).toHaveLength(0);
    expect(r.controller.status).toBe('RECORDING');
  });

  it('segment audio vide : marqué corrupt, ignoré, signalé', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    FakeMediaRecorder.instances[0]!.emptyOnStop = true;
    await advance(30_100);
    const chunks = await r.storage.listChunks('cm1');
    expect(chunks[0]).toMatchObject({ status: 'corrupt', size: 0 });
    expect(await r.storage.getChunkBlob(chunks[0]!.id)).toBeUndefined();
    expect(r.controller.interruptions.some((i) => i.kind === 'recorder')).toBe(true);
  });
});

describe('marqueurs et ancrages', () => {
  it('un marqueur est créé instantanément à l’instant courant et persisté ; impossible hors enregistrement', async () => {
    const r = await makeRig(vi);
    expect(r.controller.mark()).toBeNull();
    await r.controller.start();
    await advance(12_000);
    const m = r.controller.mark()!;
    expect(m.atMs).toBe(12_000);
    expect(m.reasons).toEqual([]);
    r.controller.updateMarker(m.id, { reasons: ['exam', 'important'], note: 'à retravailler' });
    await advance(10);
    const stored = await r.storage.listMarkers('cm1');
    expect(stored[0]).toMatchObject({ atMs: 12_000, reasons: ['exam', 'important'], note: 'à retravailler' });
    r.controller.removeMarker(m.id);
    await advance(10);
    expect(await r.storage.listMarkers('cm1')).toHaveLength(0);
  });

  it('NoteAnchor : timestamp, position, extrait, segments proches — recalculés à l’arrêt', async () => {
    const r = await makeRig(vi);
    await r.controller.start();
    await advance(20_000);
    const a = r.controller.recordAnchor({ notePosition: 42, textSnippet: 'Le consentement doit être libre' })!;
    expect(a.timestamp).toBe(20_000);
    expect(a.nearbyTranscriptSegmentIds).toEqual([]); // le moteur n'a encore rien rendu
    r.provider!.say('le consentement doit être libre', 17_000, 21_000); // arrive en retard
    await r.controller.stop();
    const stored = await r.storage.listAnchors('cm1');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ notePosition: 42, textSnippet: 'Le consentement doit être libre' });
    expect(stored[0]!.nearbyTranscriptSegmentIds).toHaveLength(1);
  });
});

describe('indépendance vis-à-vis des notes', () => {
  it('un contrôleur peut échouer de toutes les façons sans lever d’exception vers l’appelant', async () => {
    const r = await makeRig(vi, { getUserMediaError: 'NotAllowedError' });
    await expect(r.controller.start()).resolves.toBeUndefined();
    await expect(r.controller.pause()).resolves.toBeUndefined();
    await expect(r.controller.stop()).resolves.toBeUndefined();
    expect(() => r.controller.mark()).not.toThrow();
  });
  it('se construit sans moteur de transcription (audio seul)', async () => {
    const r = await makeRig(vi, { provider: null });
    await r.controller.start();
    expect(r.controller.status).toBe('RECORDING');
    await advance(31_000);
    expect((await r.storage.listChunks('cm1')).length).toBeGreaterThan(0);
    await r.controller.stop();
  });
});

describe('construction', () => {
  it('CaptureController est exporté', () => { expect(CaptureController).toBeTypeOf('function'); });
});
