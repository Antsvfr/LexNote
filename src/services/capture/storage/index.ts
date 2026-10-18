import { IndexedDbCaptureStorage, captureDbName } from './idb';
import { MemoryCaptureStorage } from './memory';
import type { CaptureStorage } from './types';
import { log } from '@/lib/log';

export type { CaptureStorage } from './types';

export async function createCaptureStorage(userId: string): Promise<CaptureStorage> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB indisponible');
    return await IndexedDbCaptureStorage.open(captureDbName(userId));
  } catch (err) {
    log.transcription.warn('Stockage de capture indisponible, repli mémoire (non persistant).', err);
    return new MemoryCaptureStorage(false);
  }
}
