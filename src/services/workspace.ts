/**
 * Espace de travail d'UN utilisateur : stockage local (une base par compte), capture, synchronisation.
 * Ouvert à la connexion, FERMÉ et vidé à la déconnexion — rien d'un compte ne survit en mémoire pour le suivant.
 */
import type { AuthUser } from './auth/types';
import type { Backend } from './backend';
import { createStorage, requestPersistence, withSync } from './storage';
import type { StorageAdapter } from './storage/types';
import { SyncEngine } from './sync/engine';
import { captureManager } from './capture/manager';
import { setSyncRequester } from './sync/hook';
import { setStorageScope } from '@/lib/scope';
import { newId } from '@/lib/ids';
import { useLibrary, onSubjectsRemoved } from '@/store/library';
import { useArtifacts } from '@/store/artifacts';
import { useEditorBridge } from '@/store/editorBridge';
import { initialSync, setSync, useSync } from '@/store/sync';
import { useToasts } from '@/store/toasts';
import { useUI } from '@/store/ui';
import { useSaveStatus } from '@/features/editor/saveStatus';
import { toast } from '@/store/toasts';

let hooked = false;
interface Workspace { userId: string; local: StorageAdapter; engine: SyncEngine | null }
let current: Workspace | null = null;

export const getWorkspace = () => current;
export const getLocalAdapter = (): StorageAdapter => {
  if (!current) throw new Error('Aucun espace de travail ouvert.');
  return current.local;
};
/** Demande une synchronisation rapide (ex. fin d'enregistrement, nouveau marqueur). */
export const requestSync = (delayMs = 800) => current?.engine?.schedule(delayMs);
export const syncNow = () => current?.engine?.syncNow();

function deviceId(): string {
  try {
    let id = localStorage.getItem('lexnote.deviceId');
    if (!id) { id = newId(); localStorage.setItem('lexnote.deviceId', id); }
    return id;
  } catch { return newId(); }
}

export async function openWorkspace(user: AuthUser, backend: Backend): Promise<void> {
  if (!hooked) { hooked = true; onSubjectsRemoved(async (ids) => { for (const id of ids) await useArtifacts.getState().removeForSubject(id); }); }
  if (current?.userId === user.id) return;
  if (current) await closeWorkspace();
  setStorageScope(user.id);

  let engine: SyncEngine | null = null;
  const local = withSync(await createStorage(user.id), { onLocalWrite: () => engine?.schedule() });
  await useLibrary.getState().init(local, user.id);
  await useArtifacts.getState().init(local);
  await captureManager.init(user.id);

  if (backend.kind !== 'unconfigured') {
    engine = new SyncEngine({
      userId: user.id,
      deviceId: deviceId(),
      local,
      capture: () => captureManager.getStorageOrNull(),
      remote: backend.remoteFor(user.id),
      status: { update: (p) => setSync(p) },
      onApplied: (c) => {
        void useLibrary.getState().applyRemote(c.removedSessionIds);
        void useArtifacts.getState().reload();
        if (c.captureSessionIds.length) void captureManager.refreshAfterRemote(c.captureSessionIds);
      },
      onConflictCopy: (orig) => toast.info(`Conflit sur « ${orig.title || 'une séance'} » : les deux versions ont été conservées.`),
    });
  }
  current = { userId: user.id, local, engine };
  setSyncRequester((d) => requestSync(d));
  void requestPersistence();
  engine?.start();
  if (!engine) setSync({ state: 'disabled' });
}

export async function closeWorkspace(): Promise<void> {
  const ws = current;
  current = null;
  setSyncRequester(null);
  if (ws) {
    ws.engine?.stop();
    await captureManager.shutdown();
    ws.local.close();
  }
  // Plus aucune donnée du compte précédent ne doit rester visible.
  useLibrary.getState().reset();
  useArtifacts.getState().reset();
  useEditorBridge.getState().setEditor(null);
  useSaveStatus.getState().set('idle');
  useToasts.setState({ toasts: [] });
  useUI.setState({ focus: false, paletteOpen: false, navOpen: false, newSession: null, supportDialog: null, recPopover: false });
  useSync.setState({ ...initialSync });
  setStorageScope(null);
}
