export type QuotaLevel = 'ok' | 'low' | 'critical' | 'unknown';

export interface StorageInfo {
  usage: number;
  quota: number;
  free: number;
  level: QuotaLevel;
  persisted: boolean | null;
}

/** En dessous : on avertit. */
export const LOW_FREE_BYTES = 300 * 1024 * 1024;
/** En dessous : on arrête de stocker l'audio (la transcription texte et les notes continuent). */
export const CRITICAL_FREE_BYTES = 50 * 1024 * 1024;

export function levelFor(usage: number, quota: number): QuotaLevel {
  if (!quota) return 'unknown';
  const free = quota - usage;
  if (free < CRITICAL_FREE_BYTES) return 'critical';
  if (free < LOW_FREE_BYTES || usage / quota > 0.85) return 'low';
  return 'ok';
}

/** Estimation du stockage navigateur. `unknown` si l'API n'existe pas (certains contextes Safari/Firefox). */
export async function estimateStorage(): Promise<StorageInfo> {
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = (await navigator.storage?.persisted?.()) ?? null;
    if (!est || est.quota == null || est.usage == null) return { usage: 0, quota: 0, free: 0, level: 'unknown', persisted };
    return { usage: est.usage, quota: est.quota, free: est.quota - est.usage, level: levelFor(est.usage, est.quota), persisted };
  } catch {
    return { usage: 0, quota: 0, free: 0, level: 'unknown', persisted: null };
  }
}
