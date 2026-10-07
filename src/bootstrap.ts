import { createStorage, requestPersistence, withSync } from '@/services/storage';
import type { StorageAdapter } from '@/services/storage/types';
import { useLibrary } from '@/store/library';
import { captureManager } from '@/services/capture/manager';
import { createCaptureStorage } from '@/services/capture/storage';
import { CloudSyncEngine, type SyncEngine } from '@/services/sync';
import { flushCaptureCloud, hydrateCaptureCloud } from '@/services/sync/captureCloud';

let storage: StorageAdapter | null = null;
let rawStorage: StorageAdapter | null = null;
let syncEngine: SyncEngine | null = null;
let activeUserId: string | null = null;

export const getStorage = (): StorageAdapter => {
  if (!storage) throw new Error('Stockage non initialisé');
  return storage;
};

export function currentWorkspaceUserId() {
  return activeUserId;
}

export async function bootstrapUser(userId: string): Promise<void> {
  if (activeUserId === userId && storage) return;

  syncEngine?.dispose();
  activeUserId = userId;

  rawStorage = await createStorage(userId);
  syncEngine = new CloudSyncEngine(userId, rawStorage);

  // Les écritures locales restent prioritaires. On pousse d'abord la file hors-ligne,
  // puis on fusionne les données distantes plus récentes, puis on expose l'adapter décoré.
  await syncEngine.flush().catch(() => undefined);
  await syncEngine.pull().catch(() => undefined);

  storage = withSync(rawStorage, syncEngine);
  await useLibrary.getState().init(storage);

  // La capture (audio/transcription) a sa propre base, elle aussi isolée par utilisateur.
  const captureStorage = await createCaptureStorage(userId);
  await flushCaptureCloud().catch(() => undefined);
  await hydrateCaptureCloud(captureStorage).catch((e) => console.warn('[LexNote] capture cloud non chargée', e));
  await captureManager.init(captureStorage).catch((e) => console.warn('[LexNote] capture indisponible', e));
  void requestPersistence();
}

export async function clearWorkspace(): Promise<void> {
  syncEngine?.dispose();
  await captureManager.reset();
  syncEngine = null;
  activeUserId = null;
  storage = null;
  rawStorage = null;
  useLibrary.getState().reset();
}
