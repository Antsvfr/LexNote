import { describe, expect, it } from 'vitest';
import { BLOCK_MESSAGE, blockReason, type Activity } from './activity';

const idle: Activity = { capture: 'INACTIVE', save: 'idle', sync: 'idle', pending: 0 };

describe('sécurité de session active (mise à jour / fermeture)', () => {
  it('au repos, ou hors ligne avec des données en attente (déjà sur l’appareil), on peut recharger', () => {
    expect(blockReason(idle)).toBeNull();
    expect(blockReason({ ...idle, sync: 'offline', pending: 12 })).toBeNull();
    expect(blockReason({ ...idle, capture: 'COMPLETED', save: 'saved', sync: 'synced' })).toBeNull();
    expect(blockReason({ ...idle, capture: 'ERROR' })).toBeNull();
  });
  it.each(['REQUESTING_PERMISSION', 'STARTING', 'RECORDING', 'PAUSED', 'PROCESSING'] as const)('transcription %s → bloqué', (capture) => {
    expect(blockReason({ ...idle, capture })).toBe('recording');
  });
  it('notes en cours d’enregistrement ou synchronisation en cours → bloqué', () => {
    expect(blockReason({ ...idle, save: 'saving' })).toBe('unsaved');
    expect(blockReason({ ...idle, sync: 'syncing' })).toBe('syncing');
  });
  it('la transcription l’emporte sur le reste ; chaque raison a un message français', () => {
    expect(blockReason({ capture: 'RECORDING', save: 'saving', sync: 'syncing', pending: 3 })).toBe('recording');
    for (const m of Object.values(BLOCK_MESSAGE)) expect(m).toMatch(/\.$/);
  });
});
