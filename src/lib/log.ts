/**
 * Journal technique de l'application : préfixes normalisés [auth] [sync] [integration] [study-ai] [transcription] (+ [storage] [pwa] [ui]).
 * RÈGLE : on journalise des ÉVÉNEMENTS (nom, code, taille), jamais du CONTENU — ni notes, ni transcription, ni prompt, ni jeton, ni e-mail.
 * Les erreurs sont réduites à « Nom: message » puis expurgées (jetons, e-mails, URL à paramètres) et tronquées.
 */
export type LogScope = 'auth' | 'sync' | 'integration' | 'study-ai' | 'transcription' | 'storage' | 'pwa' | 'ui';
export type LogLevel = 'info' | 'warn' | 'error';
export interface LogEntry { at: string; level: LogLevel; scope: LogScope; message: string; code?: string }

const MAX_ENTRIES = 50;
const ring: LogEntry[] = [];

/** Retire tout ce qui ressemble à un secret ou à une donnée personnelle. */
export function redact(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '‹jeton›')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ‹jeton›')
    .replace(/\b(sk-ant|sbp|sk|pk)[_-][A-Za-z0-9_-]{16,}/g, '‹clé›')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '‹e-mail›')
    .replace(/([?&#](?:access_token|refresh_token|token|key|apikey|code|nonce|n)=)[^&\s#]+/gi, '$1‹masqué›')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '‹masqué›');
}
export function describeError(err: unknown): string {
  if (err === undefined || err === null) return '';
  const s = err instanceof Error ? `${err.name}: ${err.message}` : typeof err === 'string' ? err : typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : typeof err;
  return redact(s).slice(0, 200);
}

function emit(level: LogLevel, scope: LogScope, message: string, err?: unknown, code?: string) {
  const detail = describeError(err);
  const line = `[${scope}] ${message}${code ? ` (${code})` : ''}${detail ? ` — ${detail}` : ''}`;
  ring.push({ at: new Date().toISOString(), level, scope, message: redact(`${message}${detail ? ` — ${detail}` : ''}`).slice(0, 240), ...(code ? { code } : {}) });
  if (ring.length > MAX_ENTRIES) ring.shift();
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(line);
}

export const log = Object.fromEntries((['auth', 'sync', 'integration', 'study-ai', 'transcription', 'storage', 'pwa', 'ui'] as const).map((scope) => [scope, {
  info: (m: string, err?: unknown, code?: string) => emit('info', scope, m, err, code),
  warn: (m: string, err?: unknown, code?: string) => emit('warn', scope, m, err, code),
  error: (m: string, err?: unknown, code?: string) => emit('error', scope, m, err, code),
}])) as Record<LogScope, Record<LogLevel, (message: string, err?: unknown, code?: string) => void>>;

/** Derniers événements (pour la page Diagnostic) : déjà expurgés. */
export const recentLogs = (): readonly LogEntry[] => ring.slice();
export const clearLogs = () => { ring.length = 0; };
