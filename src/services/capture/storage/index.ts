import { IndexedDbCaptureStorage } from './idb';
import { MemoryCaptureStorage } from './memory';
import type { CaptureStorage } from './types';

export type { CaptureStorage } from './types';

export async function createCaptureStorage(userId?: string): Promise<CaptureStorage> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB indisponible');
    return await IndexedDbCaptureStorage.open(userId ? 'lexnote-capture-' + userId : undefined);
  } catch (err) {
    console.warn('[LexNote] Stockage de capture indisponible, repli mémoire (non persistant).', err);
    return new MemoryCaptureStorage(false);
  }
}
