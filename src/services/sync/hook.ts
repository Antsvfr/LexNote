/** Point d'accès sans dépendance circulaire : la capture demande une synchro, l'espace de travail l'exécute. */
let requester: ((delayMs?: number) => void) | null = null;
export const setSyncRequester = (fn: ((delayMs?: number) => void) | null) => { requester = fn; };
export const requestSyncSoon = (delayMs?: number) => requester?.(delayMs);
