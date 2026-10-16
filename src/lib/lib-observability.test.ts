import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLogs, describeError, log, recentLogs, redact } from './log';
import { ERROR_CODES, crashCode, errorInfo, syncErrorCode } from './errorCodes';
import { getBuildInfo } from './buildInfo';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
afterEach(() => { clearLogs(); vi.restoreAllMocks(); });

describe('journal technique', () => {
  it('expurge jetons, e-mails, clés et paramètres sensibles', () => {
    const dirty = `Bearer abcdefghijklmnop ${JWT} marie@exemple.fr sk-ant-api03-${'x'.repeat(30)} https://x/cb?access_token=SECRETVALUE&a=1 #n=NONCEVALUE`;
    const clean = redact(dirty);
    for (const s of ['abcdefghijklmnop', JWT, 'marie@exemple.fr', 'x'.repeat(30), 'SECRETVALUE', 'NONCEVALUE']) expect(clean).not.toContain(s);
    expect(clean).toContain('a=1');
  });
  it('préfixes normalisés, code optionnel, erreur réduite à « Nom: message »', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.sync.error('synchronisation échouée', new TypeError(`échec pour ${JWT}`), 'SYNC-REMOTE-04');
    expect(spy).toHaveBeenCalledOnce();
    const line = String(spy.mock.calls[0]![0]);
    expect(line.startsWith('[sync] synchronisation échouée (SYNC-REMOTE-04) — TypeError:')).toBe(true);
    expect(line).not.toContain(JWT);
    expect(spy.mock.calls[0]).toHaveLength(1);              // jamais l'objet d'erreur brut (il peut contenir des données)
  });
  it('tampon des derniers événements borné et expurgé', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 80; i++) log.auth.warn(`événement ${i}`, `user${i}@exemple.fr`);
    const r = recentLogs();
    expect(r).toHaveLength(50);
    expect(r.at(-1)!.message).toBe('événement 79 — ‹e-mail›');
    expect(describeError({ message: JWT })).not.toContain(JWT);
  });
});

describe('codes d’erreur', () => {
  it('chaque code est « ZONE-…-NN » avec zone cohérente, titre et conseil', () => {
    for (const [code, info] of Object.entries(ERROR_CODES)) {
      expect(code.startsWith(`${info.area}-`), code).toBe(true);
      expect(info.title.length).toBeGreaterThan(3); expect(info.hint.length).toBeGreaterThan(10);
    }
    expect(errorInfo('AI-503')?.area).toBe('AI');
    expect(errorInfo('INCONNU')).toBeNull();
  });
  it('codes de synchronisation selon l’état', () => {
    expect(syncErrorCode({ state: 'offline', error: null, conflicts: 0 })).toBe('SYNC-OFFLINE-01');
    expect(syncErrorCode({ state: 'error', error: 'HTTP 401', conflicts: 0 })).toBe('SYNC-AUTH-03');
    expect(syncErrorCode({ state: 'error', error: 'boom', conflicts: 0 })).toBe('SYNC-REMOTE-04');
    expect(syncErrorCode({ state: 'synced', error: null, conflicts: 2 })).toBe('SYNC-CONFLICT-02');
    expect(syncErrorCode({ state: 'synced', error: null, conflicts: 0 })).toBeNull();
  });
  it('code de plantage stable et sans contenu', () => {
    expect(crashCode(new TypeError('secret de la note'))).toBe(crashCode(new TypeError('autre message')));
    expect(crashCode(new TypeError('x'))).toMatch(/^UI-CRASH-01\/[0-9a-f]{4}$/);
  });
});

describe('version du build', () => {
  it('numéro, commit court et libellé', () => {
    const b = getBuildInfo();
    expect(b.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(b.label).toBe(`v${b.version} (${b.shortSha})`);
    expect(b.sha === 'unknown' || /^[0-9a-f]{40}$/.test(b.sha)).toBe(true);
  });
});
