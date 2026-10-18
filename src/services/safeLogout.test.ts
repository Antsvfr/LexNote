import { beforeEach, describe, expect, it, vi } from 'vitest';

const confirmMock = vi.fn();
const flushMock = vi.fn();
const reasonMock = vi.fn();
vi.mock('@/components/confirm', () => ({ confirm: (a: unknown) => confirmMock(a) }));
vi.mock('@/services/workspace', () => ({ flushSyncBeforeExit: () => flushMock() }));
vi.mock('@/lib/activity', () => ({ currentBlockReason: () => reasonMock() }));

import { confirmSafeLogout } from './safeLogout';
import { setSync } from '@/store/sync';

beforeEach(() => { confirmMock.mockReset(); flushMock.mockReset(); reasonMock.mockReset(); setSync({ state: 'synced', pending: 0 }); });

describe('déconnexion sans perte', () => {
  it('tout est synchronisé : se déconnecte sans question', async () => {
    flushMock.mockResolvedValue(0); reasonMock.mockReturnValue(null);
    expect(await confirmSafeLogout()).toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(flushMock).toHaveBeenCalledOnce();                       // dernière tentative d'envoi
  });
  it('des éléments restent non envoyés : l’étudiant est prévenu, peut renoncer ; rien n’est supprimé', async () => {
    flushMock.mockResolvedValue(3); reasonMock.mockReturnValue(null);
    confirmMock.mockResolvedValue(false);
    expect(await confirmSafeLogout()).toBe(false);
    expect(String(confirmMock.mock.calls[0]![0].message)).toMatch(/3 éléments ne sont pas encore synchronisés.*Rien n’est perdu/);
    confirmMock.mockResolvedValue(true);
    expect(await confirmSafeLogout()).toBe(true);
  });
  it('transcription en cours : confirmation avant d’arrêter ; refus → on ne se déconnecte pas et on ne tente même pas d’envoi', async () => {
    reasonMock.mockReturnValue('recording'); confirmMock.mockResolvedValue(false);
    expect(await confirmSafeLogout()).toBe(false);
    expect(flushMock).not.toHaveBeenCalled();
  });
  it('travail local seul (synchronisation désactivée) : aucune tentative d’envoi', async () => {
    setSync({ state: 'disabled' }); reasonMock.mockReturnValue(null);
    expect(await confirmSafeLogout()).toBe(true);
    expect(flushMock).not.toHaveBeenCalled();
  });
});
