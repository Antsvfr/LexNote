/**
 * Accès au microphone : demande explicite (getUserMedia) puis, en cas d'échec, DIAGNOSTIC avant tout message.
 *
 * Règle : on ne conclut jamais « aucun microphone » à partir d'un seul `NotFoundError`. Sur Mac en particulier, un navigateur
 * qui n'est pas autorisé dans Réglages Système › Confidentialité et sécurité › Microphone ne voit AUCUN périphérique et
 * reçoit `NotFoundError` alors que le micro intégré existe bien. Avant l'autorisation du site, `enumerateDevices()` peut aussi
 * masquer les périphériques (identifiants et libellés vides) : une liste vide n'est fiable qu'une fois la permission accordée.
 *
 * Diagnostic journalisé : catégorie, nom d'erreur, permission, nombre d'entrées audio, contexte sécurisé, famille de navigateur.
 * Jamais d'audio, de transcription ni de note.
 */
import type { InterruptionKind } from '@/domain/capture';

export type MicPermission = 'granted' | 'denied' | 'prompt' | 'unknown';
export type MicIssue = 'insecure' | 'unsupported' | 'denied' | 'system-blocked' | 'no-device' | 'unavailable' | 'busy' | 'unknown';

export interface MicEnv {
  mediaDevices?: { getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>; enumerateDevices?: () => Promise<{ kind: string; label: string; deviceId: string }[]> };
  permissions?: { query: (d: { name: string }) => Promise<{ state: string }> };
  isSecureContext?: boolean;
  userAgent?: string;
}

export interface MicFailure {
  issue: MicIssue;
  kind: InterruptionKind;
  title: string;
  message: string;
  /** Un nouvel essai a un sens (l'utilisateur peut changer un réglage puis réessayer). */
  retry: boolean;
  diag: { issue: MicIssue; error: string; permission: MicPermission; audioInputs: number | null; labelled: boolean; secure: boolean; browser: string };
}

/** Erreur levée quand l'API micro n'existe pas (navigateur ancien ou page non sécurisée). */
export const UNSUPPORTED = 'MicUnsupportedError';

export function browserEnv(): MicEnv {
  if (typeof navigator === 'undefined') return {};
  return {
    mediaDevices: navigator.mediaDevices,
    permissions: navigator.permissions as MicEnv['permissions'],
    isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : true,
    userAgent: navigator.userAgent,
  };
}

export function browserFamily(ua = ''): string {
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\/|Chromium\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'autre';
}
export const isMac = (ua = '') => /Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua);

/** État de la permission du site, sans jamais en dépendre : 'unknown' si l'API manque ou refuse le nom 'microphone' (Firefox, anciens Safari). */
export async function queryMicPermission(env: MicEnv): Promise<MicPermission> {
  try {
    const st = (await env.permissions?.query({ name: 'microphone' }))?.state;
    return st === 'granted' || st === 'denied' || st === 'prompt' ? st : 'unknown';
  } catch { return 'unknown'; }
}

/** Entrées audio visibles : `labelled` faux = liste masquée (permission pas encore accordée), donc non concluante. */
export async function audioInputs(env: MicEnv): Promise<{ count: number; labelled: boolean } | null> {
  try {
    const list = await env.mediaDevices?.enumerateDevices?.();
    if (!list) return null;
    const inputs = list.filter((d) => d.kind === 'audioinput');
    return { count: inputs.length, labelled: inputs.some((d) => !!d.label) };
  } catch { return null; }
}

/** Ouvre le micro : contrainte souple d'abord, puis `{ audio: true }` si le navigateur la juge impossible. */
export async function openMic(getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>): Promise<MediaStream> {
  try {
    return await getUserMedia({ audio: { channelCount: 1 } });
  } catch (err) {
    if ((err as DOMException)?.name !== 'OverconstrainedError') throw err;
    return getUserMedia({ audio: true });
  }
}

const MAC_HINT = 'Sur Mac : Réglages Système › Confidentialité et sécurité › Microphone, activez votre navigateur, puis relancez-le si besoin.';

/** Transforme un échec de getUserMedia en cause précise, après vérification (permission + périphériques). */
export async function diagnoseMicFailure(err: unknown, env: MicEnv): Promise<MicFailure> {
  const name = (err as DOMException)?.name || (err as Error)?.name || '';
  const ua = env.userAgent ?? '';
  const secure = env.isSecureContext !== false;
  const [permission, inputs] = await Promise.all([queryMicPermission(env), audioInputs(env)]);
  const diag = (issue: MicIssue): MicFailure['diag'] => ({
    issue, error: name || 'inconnue', permission, audioInputs: inputs?.count ?? null, labelled: inputs?.labelled ?? false, secure, browser: browserFamily(ua),
  });
  const out = (issue: MicIssue, kind: InterruptionKind, title: string, message: string, retry: boolean): MicFailure => ({ issue, kind, title, message, retry, diag: diag(issue) });

  if (name === UNSUPPORTED || !env.mediaDevices?.getUserMedia) {
    return secure
      ? out('unsupported', 'device', 'Microphone non pris en charge', 'Ce navigateur ne donne pas accès au microphone. Utilisez Chrome, Edge ou Safari à jour.', false)
      : out('insecure', 'device', 'Connexion non sécurisée', 'Le microphone n’est accessible que sur une adresse sécurisée (https). Ouvrez LexNote depuis son adresse officielle.', false);
  }
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    // Site autorisé mais refus quand même : c'est le système (macOS) qui bloque le navigateur.
    if (permission === 'granted') return out('system-blocked', 'permission', 'Microphone bloqué par le système', `Le navigateur n’a pas accès au microphone. ${isMac(ua) ? MAC_HINT : 'Vérifiez les réglages de confidentialité du système.'}`, true);
    return out('denied', 'permission', 'L’accès au microphone est bloqué', 'Autorisez le microphone dans les réglages du navigateur (icône à gauche de l’adresse), puis réessayez.', true);
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    // Seul cas concluant : permission accordée, liste lisible et vide — et pas sur Mac, où le micro intégré existe toujours.
    if (permission === 'granted' && inputs && inputs.count === 0 && !isMac(ua)) {
      return out('no-device', 'device', 'Aucun microphone disponible', 'Aucun microphone n’est branché. Branchez-en un puis réessayez.', true);
    }
    if (isMac(ua)) return out('system-blocked', 'device', 'Le navigateur ne voit pas le microphone', MAC_HINT, true);
    return out('unavailable', 'device', 'Microphone inaccessible', 'Le navigateur n’a pas pu ouvrir le microphone. Vérifiez qu’il est branché et autorisé pour ce navigateur, puis réessayez.', true);
  }
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') {
    return out('busy', 'device', 'Le microphone est momentanément indisponible', 'Il est peut-être utilisé par une autre application (visio, dictée…). Fermez-la puis réessayez.', true);
  }
  return out('unknown', 'unknown', 'Microphone inaccessible', `Impossible d’accéder au microphone (${name || 'erreur inconnue'}). Réessayez.`, true);
}
