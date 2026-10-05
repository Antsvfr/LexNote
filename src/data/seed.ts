import type { StorageAdapter } from '@/services/storage/types';
import { buildDemoLibrary } from './demo/demoData';

const SEED_FLAG = 'demoSeeded';

/**
 * Au tout premier lancement, installe les données de démonstration.
 * Désactivable avec `VITE_SEED_DEMO=false`. Ne s'exécute qu'une seule fois par appareil :
 * supprimer la démo ne la fait pas revenir.
 */
export async function seedDemoOnFirstRun(adapter: StorageAdapter): Promise<boolean> {
  if (import.meta.env.VITE_SEED_DEMO === 'false') return false;
  if (await adapter.getMeta<boolean>(SEED_FLAG)) return false;
  const lib = await adapter.loadLibrary();
  const empty = !lib.subjects.length && !lib.modules.length && !lib.sessions.length;
  if (empty) {
    const demo = buildDemoLibrary();
    await adapter.commit({
      putSubjects: demo.subjects, putModules: demo.modules, putSessions: demo.sessions, putNotes: demo.notes,
    });
  }
  await adapter.setMeta(SEED_FLAG, true);
  return empty;
}

/** Réinstalle la démo à la demande (Réglages). */
export async function installDemo(adapter: StorageAdapter): Promise<void> {
  const demo = buildDemoLibrary();
  await adapter.commit({
    putSubjects: demo.subjects, putModules: demo.modules, putSessions: demo.sessions, putNotes: demo.notes,
  });
}
