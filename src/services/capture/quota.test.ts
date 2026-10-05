import { afterEach, describe, expect, it, vi } from 'vitest';
import { estimateStorage, levelFor } from './quota';

afterEach(() => vi.unstubAllGlobals());

describe('quotas de stockage', () => {
  it('niveaux ok / low / critical / unknown', () => {
    const GB = 1024 ** 3, MB = 1024 ** 2;
    expect(levelFor(1 * GB, 10 * GB)).toBe('ok');
    expect(levelFor(9 * GB + 800 * MB, 10 * GB)).toBe('low'); // > 85 % et < 300 Mo libres
    expect(levelFor(10 * GB - 20 * MB, 10 * GB)).toBe('critical');
    expect(levelFor(1, 0)).toBe('unknown');
  });
  it('estimateStorage lit navigator.storage', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 100, quota: 1000 * 1024 * 1024 }), persisted: async () => true } });
    const i = await estimateStorage();
    expect(i).toMatchObject({ usage: 100, persisted: true, level: 'ok' });
    expect(i.free).toBe(1000 * 1024 * 1024 - 100);
  });
  it('API indisponible → unknown, sans exception', async () => {
    vi.stubGlobal('navigator', {});
    expect((await estimateStorage()).level).toBe('unknown');
  });
});
