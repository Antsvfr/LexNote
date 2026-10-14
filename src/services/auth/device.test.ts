import { beforeEach, describe, expect, it } from 'vitest';
import { deviceLabel, isNewBrowserSession, markBrowserSession, readDevice, setRemember, shouldDiscardStoredSession } from './device';

const clearCookie = () => { document.cookie = 'lexnote_bs=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'; };
beforeEach(() => { localStorage.clear(); clearCookie(); });

describe('appareil : UUID local, « Rester connecté », session de navigateur', () => {
  it('UUID aléatoire stable ; « Rester connecté » décoché par défaut ; aucun secret stocké', () => {
    const a = readDevice(); const b = readDevice();
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/); expect(b.id).toBe(a.id); expect(a.remember).toBe(false);
    expect(Object.keys(JSON.parse(localStorage.getItem('lexnote-device')!)).sort()).toEqual(['createdAt', 'id', 'remember']);
  });
  it('« Rester connecté » DÉCOCHÉ : session abandonnée à la réouverture du navigateur, conservée dans les onglets de la même session', () => {
    setRemember(false);
    expect(isNewBrowserSession()).toBe(true); expect(shouldDiscardStoredSession()).toBe(true);    // navigateur rouvert
    markBrowserSession();
    expect(shouldDiscardStoredSession()).toBe(false);                                              // nouvel onglet, même session
    clearCookie();                                                                                  // fermeture complète du navigateur
    expect(shouldDiscardStoredSession()).toBe(true);
  });
  it('« Rester connecté » COCHÉ : session conservée même après fermeture du navigateur', () => {
    setRemember(true); clearCookie();
    expect(shouldDiscardStoredSession()).toBe(false);
  });
  it('appareil déjà connecté avant cette version : « Rester connecté » conservé (pas de déconnexion surprise à la mise à jour)', () => {
    localStorage.setItem('lexnote-auth', '{"access_token":"x"}');
    expect(readDevice().remember).toBe(true);
  });
  it('libellé grossier et lisible, sans version ni identifiant matériel', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')).toBe('Chrome — macOS');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari — iOS');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0')).toBe('Edge — Windows');
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox — Linux');
  });
});
