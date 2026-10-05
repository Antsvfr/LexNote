import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider, extensionFor } from './providers/openaiCompatible';
import { WebSpeechProvider } from './providers/webSpeech';
import { DEFAULT_ENGINE_SETTINGS, saveEngineSettings } from './settings';
import { resolveProvider } from './index';
import type { ProviderContext, SegmentDraft, ProviderError } from './types';

function ctx() {
  const segments: SegmentDraft[] = [], interims: string[] = [], errors: ProviderError[] = [];
  let t = 0;
  const c: ProviderContext = { sessionId: 's', language: 'fr-FR', now: () => (t += 1000), onSegment: (d) => segments.push(d), onInterim: (x) => interims.push(x), onError: (e) => errors.push(e) };
  return { c, segments, interims, errors };
}

describe('configuration par défaut : aucun secret, aucune fausse clé', () => {
  beforeEach(() => localStorage.clear());
  it('pas de clé ni d’URL par défaut ; le moteur compatible OpenAI est « non configuré »', () => {
    expect(DEFAULT_ENGINE_SETTINGS.apiKey).toBe('');
    expect(DEFAULT_ENGINE_SETTINGS.baseUrl).toBe('');
    const p = new OpenAICompatibleProvider();
    expect(p.availability().available).toBe(false);
  });
  it('une API distante sans clé est refusée ; un serveur local n’exige pas de clé', () => {
    saveEngineSettings({ baseUrl: 'https://api.openai.com/v1', apiKey: '' });
    expect(new OpenAICompatibleProvider().availability().available).toBe(false);
    saveEngineSettings({ apiKey: 'sk-test' });
    expect(new OpenAICompatibleProvider().availability().available).toBe(true);
    saveEngineSettings({ baseUrl: 'http://localhost:8080/v1', apiKey: '' });
    const p = new OpenAICompatibleProvider();
    expect(p.availability().available).toBe(true);
    expect(p.privacyNote()).toMatch(/ne quitte pas/);
  });
  it('resolveProvider : « none » → audio seul', () => {
    saveEngineSettings({ providerId: 'none' });
    expect(resolveProvider()).toBeNull();
  });
});

describe('OpenAICompatibleProvider', () => {
  beforeEach(() => { localStorage.clear(); saveEngineSettings({ baseUrl: 'http://localhost:8080/v1', model: 'whisper-1' }); });
  afterEach(() => vi.unstubAllGlobals());

  it('envoie le chunk en multipart et convertit les segments en temps CM', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const fd = init.body as FormData;
      expect(fd.get('model')).toBe('whisper-1');
      expect(fd.get('language')).toBe('fr');
      expect((fd.get('file') as File).name).toMatch(/\.webm$/);
      return new Response(JSON.stringify({ segments: [{ start: 1, end: 3.5, text: ' Bonjour à tous', avg_logprob: -0.2 }, { start: 4, end: 5, text: '  ' }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { c, segments } = ctx();
    const p = new OpenAICompatibleProvider();
    await p.initialize(c); await p.start();
    await p.processAudioChunk({ id: 'c1', startMs: 60_000, endMs: 90_000, blob: new Blob(['x']), mimeType: 'audio/webm' });
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:8080/v1/audio/transcriptions');
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ startMs: 61_000, endMs: 63_500, text: 'Bonjour à tous' });
    expect(segments[0]!.confidence).toBeGreaterThan(0.7);
  });

  it('n’envoie un en-tête Authorization que si une clé est saisie', async () => {
    const seen: Record<string, string>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { seen.push(init.headers as Record<string, string>); return new Response(JSON.stringify({ text: 'ok' }), { status: 200 }); }));
    const { c } = ctx();
    const p = new OpenAICompatibleProvider(); await p.initialize(c);
    await p.processAudioChunk({ id: '1', startMs: 0, endMs: 1000, blob: new Blob(['x']), mimeType: 'audio/webm' });
    saveEngineSettings({ apiKey: 'sk-xyz' });
    await p.processAudioChunk({ id: '2', startMs: 0, endMs: 1000, blob: new Blob(['x']), mimeType: 'audio/webm' });
    expect(seen[0]?.Authorization).toBeUndefined();
    expect(seen[1]?.Authorization).toBe('Bearer sk-xyz');
  });

  it('erreur HTTP → la promesse est rejetée (l’orchestrateur réessaie)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503 })));
    const { c } = ctx();
    const p = new OpenAICompatibleProvider(); await p.initialize(c);
    await expect(p.processAudioChunk({ id: '1', startMs: 0, endMs: 1, blob: new Blob(['x']), mimeType: 'audio/webm' })).rejects.toThrow(/503/);
  });

  it('extensions de fichier selon le type MIME', () => {
    expect(extensionFor('audio/webm;codecs=opus')).toBe('webm');
    expect(extensionFor('audio/mp4')).toBe('m4a');
  });
});

describe('WebSpeechProvider', () => {
  class FakeSR {
    static last: FakeSR; static count = 0;
    lang = ''; continuous = false; interimResults = false; maxAlternatives = 1;
    onresult: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; onend: (() => void) | null = null;
    started = false;
    constructor() { FakeSR.last = this; FakeSR.count++; }
    start() { this.started = true; }
    stop() { this.started = false; queueMicrotask(() => this.onend?.()); }
    abort() { this.stop(); }
    emit(text: string, isFinal: boolean, confidence = 0.8) {
      const res = Object.assign([{ transcript: text, confidence }], { isFinal });
      this.onresult?.({ resultIndex: 0, results: Object.assign([res], { length: 1 }) });
    }
  }
  beforeEach(() => { FakeSR.count = 0; vi.stubGlobal('webkitSpeechRecognition', FakeSR); vi.useFakeTimers(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('indisponible sans API (Firefox) : message clair', () => {
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    const a = new WebSpeechProvider().availability();
    expect(a.available).toBe(false);
    expect(a.reason).toMatch(/Firefox/);
  });

  it('interim non conservé, final → segment avec bornes et confiance', async () => {
    const { c, segments, interims } = ctx();
    const p = new WebSpeechProvider(); await p.initialize(c); await p.start();
    FakeSR.last.emit('Pour qu’un contrat', false);
    FakeSR.last.emit('Pour qu’un contrat soit formé', true, 0.91);
    expect(interims).toEqual(['Pour qu’un contrat', '']);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ text: 'Pour qu’un contrat soit formé', confidence: 0.91 });
    expect(segments[0]!.endMs).toBeGreaterThanOrEqual(segments[0]!.startMs);
    expect(FakeSR.last.lang).toBe('fr-FR');
    expect(FakeSR.last.continuous).toBe(true);
  });

  it('confiance 0 (inconnue) → omise', async () => {
    const { c, segments } = ctx();
    const p = new WebSpeechProvider(); await p.initialize(c); await p.start();
    FakeSR.last.emit('texte', true, 0);
    expect(segments[0]!.confidence).toBeUndefined();
  });

  it('relance automatiquement quand le navigateur coupe la session', async () => {
    const { c } = ctx();
    const p = new WebSpeechProvider(); await p.initialize(c); await p.start();
    expect(FakeSR.count).toBe(1);
    vi.setSystemTime(Date.now() + 10_000);
    FakeSR.last.onend?.();
    await vi.advanceTimersByTimeAsync(400);
    expect(FakeSR.count).toBe(2);
    expect(FakeSR.last.started).toBe(true);
  });

  it('boucle de redémarrages rapides → erreur non récupérable, pas de boucle infinie', async () => {
    const { c, errors } = ctx();
    const p = new WebSpeechProvider(); await p.initialize(c); await p.start();
    for (let i = 0; i < 10; i++) { FakeSR.last.onend?.(); await vi.advanceTimersByTimeAsync(300); }
    expect(errors.some((e) => !e.recoverable)).toBe(true);
    expect(FakeSR.count).toBeLessThan(10);
  });

  it('erreur réseau → signalée comme récupérable ; not-allowed → fatale (permission)', async () => {
    const { c, errors } = ctx();
    const p = new WebSpeechProvider(); await p.initialize(c); await p.start();
    FakeSR.last.onerror?.({ error: 'network' });
    FakeSR.last.onerror?.({ error: 'no-speech' }); // ignorée
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ kind: 'network', recoverable: true });
    FakeSR.last.onerror?.({ error: 'not-allowed' });
    expect(errors[1]).toMatchObject({ kind: 'permission', recoverable: false });
  });

  it('pause / reprise / arrêt', async () => {
    const { c } = ctx();
    const p = new WebSpeechProvider(); await p.initialize(c); await p.start();
    const first = FakeSR.last;
    const paused = p.pause(); await vi.advanceTimersByTimeAsync(10); await paused;
    expect(p.getStatus().state).toBe('paused');
    expect(first.started).toBe(false);
    await p.resume();
    expect(FakeSR.count).toBe(2);
    const stopped = p.stop(); await vi.advanceTimersByTimeAsync(10); await stopped;
    expect(p.getStatus().state).toBe('idle');
  });
});
