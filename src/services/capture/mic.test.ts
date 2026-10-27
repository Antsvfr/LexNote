import { describe, expect, it, vi } from 'vitest';
import { UNSUPPORTED, audioInputs, diagnoseMicFailure, openMic, queryMicPermission, type MicEnv } from './mic';

const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';
const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const err = (name: string) => new DOMException('x', name);

/** Navigateur simulé : permission du site + périphériques visibles (masqués tant que la permission n'est pas accordée). */
function env(o: { permission?: string | 'throws'; devices?: number; labelled?: boolean; ua?: string; secure?: boolean; noMedia?: boolean; noPermissionsApi?: boolean } = {}): MicEnv {
  const devices = Array.from({ length: o.devices ?? 1 }, (_, i) => ({ kind: 'audioinput', label: o.labelled ? `Micro ${i}` : '', deviceId: o.labelled ? `d${i}` : '' }));
  return {
    mediaDevices: o.noMedia ? undefined : { getUserMedia: vi.fn(), enumerateDevices: async () => [...devices, { kind: 'videoinput', label: '', deviceId: '' }] },
    permissions: o.noPermissionsApi ? undefined : { query: async () => { if (o.permission === 'throws') throw new TypeError('microphone non pris en charge'); return { state: o.permission ?? 'prompt' }; } },
    isSecureContext: o.secure ?? true,
    userAgent: o.ua ?? WIN_CHROME,
  };
}

describe('RÉGRESSION — micro présent, permission pas encore accordée : jamais « aucun microphone »', () => {
  it('Mac + Chrome : NotFoundError alors que le micro intégré existe (navigateur non autorisé par macOS) → cause système, pas « aucun micro »', async () => {
    const f = await diagnoseMicFailure(err('NotFoundError'), env({ permission: 'prompt', devices: 0, ua: MAC_CHROME }));
    expect(f.issue).toBe('system-blocked');
    expect(f.title + f.message).not.toMatch(/Aucun microphone/);
    expect(f.message).toMatch(/Confidentialité et sécurité › Microphone/);
    expect(f.retry).toBe(true);
  });
  it('Mac : même avec la permission du site accordée et une liste vide, on ne conclut pas à l’absence (le micro intégré existe)', async () => {
    const f = await diagnoseMicFailure(err('NotFoundError'), env({ permission: 'granted', devices: 0, labelled: true, ua: MAC_SAFARI }));
    expect(f.issue).toBe('system-blocked');
  });
  it('liste masquée avant autorisation (libellés vides) : non concluante → « inaccessible », pas « aucun »', async () => {
    const f = await diagnoseMicFailure(err('NotFoundError'), env({ permission: 'prompt', devices: 1, labelled: false }));
    expect(f.issue).toBe('unavailable');
    expect(f.title).not.toMatch(/Aucun/);
  });
  it('API Permissions absente ou refusant « microphone » (Firefox, anciens Safari) : rien n’est supposé', async () => {
    expect(await queryMicPermission(env({ permission: 'throws' }))).toBe('unknown');
    expect(await queryMicPermission(env({ noPermissionsApi: true }))).toBe('unknown');
    const f = await diagnoseMicFailure(err('NotFoundError'), env({ noPermissionsApi: true, devices: 0 }));
    expect(f.issue).toBe('unavailable');
  });
});

describe('diagnostic d’accès au micro', () => {
  it('API micro absente, page sécurisée → non pris en charge (pas de nouvel essai inutile)', async () => {
    const f = await diagnoseMicFailure(err(UNSUPPORTED), env({ noMedia: true }));
    expect(f.issue).toBe('unsupported'); expect(f.retry).toBe(false);
  });
  it('API micro absente sur une page http → connexion non sécurisée (et non « aucun micro »)', async () => {
    const f = await diagnoseMicFailure(err(UNSUPPORTED), env({ noMedia: true, secure: false }));
    expect(f.issue).toBe('insecure'); expect(f.message).toMatch(/https/);
  });
  it('NotAllowedError, site non autorisé → « L’accès au microphone est bloqué », réessai possible', async () => {
    const f = await diagnoseMicFailure(err('NotAllowedError'), env({ permission: 'denied' }));
    expect(f.issue).toBe('denied'); expect(f.kind).toBe('permission');
    expect(f.title).toBe('L’accès au microphone est bloqué');
    expect(f.retry).toBe(true);
  });
  it('NotAllowedError alors que le site est autorisé → c’est le système qui bloque (Chrome « Permission denied by system »)', async () => {
    const f = await diagnoseMicFailure(err('NotAllowedError'), env({ permission: 'granted', ua: MAC_CHROME }));
    expect(f.issue).toBe('system-blocked'); expect(f.message).toMatch(/Réglages Système/);
  });
  it('NotFoundError vérifié (hors Mac, permission accordée, liste lisible et vide) → « Aucun microphone disponible »', async () => {
    const f = await diagnoseMicFailure(err('NotFoundError'), env({ permission: 'granted', devices: 0, labelled: true }));
    expect(f.issue).toBe('no-device'); expect(f.title).toBe('Aucun microphone disponible');
  });
  it('NotReadableError → momentanément indisponible, réessai', async () => {
    const f = await diagnoseMicFailure(err('NotReadableError'), env({ permission: 'granted', labelled: true }));
    expect(f.issue).toBe('busy'); expect(f.title).toBe('Le microphone est momentanément indisponible'); expect(f.retry).toBe(true);
  });
  it('erreur inconnue → message neutre avec le code, réessai', async () => {
    const f = await diagnoseMicFailure(err('WeirdError'), env());
    expect(f.issue).toBe('unknown'); expect(f.message).toMatch(/WeirdError/);
  });
  it('diagnostic : métadonnées seulement (catégorie, code, permission, compte, navigateur)', async () => {
    const f = await diagnoseMicFailure(err('NotFoundError'), env({ permission: 'prompt', devices: 2, ua: MAC_CHROME }));
    expect(f.diag).toEqual({ issue: 'system-blocked', error: 'NotFoundError', permission: 'prompt', audioInputs: 2, labelled: false, secure: true, browser: 'chrome' });
  });
  it('compte des entrées audio : null si enumerateDevices manque ou échoue', async () => {
    expect(await audioInputs({ mediaDevices: { getUserMedia: vi.fn() } })).toBeNull();
    expect(await audioInputs({ mediaDevices: { enumerateDevices: async () => { throw new Error('x'); } } })).toBeNull();
    expect(await audioInputs(env({ devices: 2, labelled: true }))).toEqual({ count: 2, labelled: true });
  });
});

describe('ouverture du micro', () => {
  it('contrainte souple, puis { audio: true } si OverconstrainedError (pas « aucun micro »)', async () => {
    const stream = {} as MediaStream;
    const gum = vi.fn().mockRejectedValueOnce(err('OverconstrainedError')).mockResolvedValueOnce(stream);
    expect(await openMic(gum)).toBe(stream);
    expect(gum.mock.calls).toEqual([[{ audio: { channelCount: 1 } }], [{ audio: true }]]);
  });
  it('les autres erreurs remontent telles quelles, sans second essai', async () => {
    const gum = vi.fn().mockRejectedValue(err('NotAllowedError'));
    await expect(openMic(gum)).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(gum).toHaveBeenCalledTimes(1);
  });
});
