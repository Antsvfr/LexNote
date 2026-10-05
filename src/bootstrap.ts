import { createStorage, requestPersistence, withSync } from '@/services/storage';
import type { StorageAdapter } from '@/services/storage/types';
import { seedDemoOnFirstRun } from '@/data/seed';
import { useLibrary } from '@/store/library';
import { captureManager } from '@/services/capture/manager';

let storage: StorageAdapter | null = null;
export const getStorage = (): StorageAdapter => {
  if (!storage) throw new Error('Stockage non initialisé');
  return storage;
};

/** Démarrage : ouvre le stockage local, installe la démo au premier lancement, charge la bibliothèque. */
export async function bootstrap(): Promise<void> {
  storage = withSync(await createStorage());
  await seedDemoOnFirstRun(storage).catch((e) => console.warn('[LexNote] seed démo ignoré', e));
  await useLibrary.getState().init(storage);
  // La capture a sa propre base : si elle est indisponible, les notes fonctionnent quand même.
  await captureManager.init().catch((e) => console.warn('[LexNote] capture indisponible', e));
  void requestPersistence();
}
