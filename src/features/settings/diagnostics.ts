import type { BuildInfo } from '@/lib/buildInfo';
import type { LogEntry } from '@/lib/log';
import { redact } from '@/lib/log';
import { errorInfo, syncErrorCode } from '@/lib/errorCodes';
import type { SyncStatus } from '@/store/sync';

/**
 * Rapport de diagnostic affiché dans Réglages → Diagnostic et copiable pour le support.
 * Construit à partir de DONNÉES SANS SECRET : le type d'entrée n'a aucun champ jeton / clé / contenu, et le texte final est expurgé une
 * seconde fois (`redact`). Rien ici ne lit le contenu des notes, des transcriptions ou des prompts.
 */
export type RowStatus = 'ok' | 'warn' | 'error' | 'info';
export interface DiagRow { id: string; label: string; status: RowStatus; value: string; code?: string }
export interface DiagSection { id: string; title: string; rows: DiagRow[] }
export interface HealthResult { reachable: boolean; status?: string; services?: Record<string, string>; missing?: string[] }

export interface DiagnosticInput {
  build: BuildInfo;
  online: boolean;
  auth: { status: string; emailMasked: string | null; offlineSession: boolean; backend: string | null; remember: boolean };
  sync: SyncStatus;
  integration: { state: string | null; checked: boolean };
  capture: { status: string; provider: string | null; storageLevel: string | null; failedChunks: number };
  ai: { available: boolean; label: string | null };
  storage: { kind: 'indexeddb' | 'memory'; persisted: boolean | null; usageKb: number | null; quotaMb: number | null };
  pwa: { standalone: boolean; serviceWorker: boolean; secureContext: boolean };
  server: HealthResult | null;
  logs: readonly LogEntry[];
}

/** « marie.dupont@exemple.fr » → « m***@exemple.fr » (le domaine aide au support, pas l'identité). */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null;
  const [l, d] = email.split('@');
  return `${(l ?? '').slice(0, 1)}***@${d}`;
}

const row = (id: string, label: string, status: RowStatus, value: string, code?: string): DiagRow => ({ id, label, status, value, ...(code ? { code } : {}) });

export function buildDiagnostic(i: DiagnosticInput): DiagSection[] {
  const authOk = i.auth.status === 'authenticated';
  const syncCode = syncErrorCode(i.sync);
  const sections: DiagSection[] = [
    { id: 'app', title: 'Application', rows: [
      row('version', 'Version', 'info', i.build.label),
      row('build', 'Build', 'info', `${i.build.shortSha}${i.build.builtAt ? ` · ${i.build.builtAt.slice(0, 16).replace('T', ' ')} UTC` : ''}`),
      row('network', 'Réseau', i.online ? 'ok' : 'warn', i.online ? 'En ligne' : 'Hors ligne', i.online ? undefined : 'SYNC-OFFLINE-01'),
    ] },
    { id: 'account', title: 'Compte', rows: [
      row('auth', 'Session', authOk ? 'ok' : 'warn', authOk ? `Connecté${i.auth.emailMasked ? ` (${i.auth.emailMasked})` : ''}` : i.auth.status === 'unconfigured' ? 'Serveur non configuré' : 'Non connecté', authOk ? undefined : 'AUTH-SESSION-01'),
      row('auth-mode', 'Mode', i.auth.offlineSession ? 'warn' : 'info', i.auth.offlineSession ? 'Session hors ligne (travail local)' : i.auth.remember ? 'Appareil de confiance (reste connecté)' : 'Session de navigation'),
      row('backend', 'Serveur', i.auth.backend === 'mock' ? 'warn' : 'info', i.auth.backend === 'supabase' ? 'Supabase' : i.auth.backend ?? 'inconnu'),
    ] },
    { id: 'sync', title: 'Synchronisation', rows: [
      row('sync-state', 'État', i.sync.state === 'error' ? 'error' : i.sync.state === 'offline' ? 'warn' : 'ok',
        ({ idle: 'Au repos', syncing: 'En cours…', synced: 'À jour', offline: 'Hors ligne', error: 'Erreur', disabled: 'Désactivée (travail local)' } as Record<string, string>)[i.sync.state] ?? i.sync.state, syncCode ?? undefined),
      row('sync-pending', 'En attente d’envoi', i.sync.pending > 0 ? 'info' : 'ok', `${i.sync.pending} élément(s)`),
      row('sync-last', 'Dernière synchronisation', 'info', i.sync.lastSyncAt ? i.sync.lastSyncAt.slice(0, 16).replace('T', ' ') + ' UTC' : 'jamais'),
      row('sync-conflicts', 'Conflits (cette session)', i.sync.conflicts ? 'warn' : 'ok', String(i.sync.conflicts), i.sync.conflicts ? 'SYNC-CONFLICT-02' : undefined),
    ] },
    { id: 'revem', title: 'REV-EM', rows: [
      row('revem', 'Liaison', 'info', !i.integration.checked ? 'Non vérifiée' : i.integration.state === 'CONNECTED' ? 'Connecté' : i.integration.state === 'REVOKED' ? 'Révoquée' : i.integration.state === 'NOT_CONNECTED' ? 'Non connecté' : i.integration.state ?? 'Indisponible'),
    ] },
    { id: 'transcription', title: 'Transcription', rows: [
      row('capture', 'État', i.capture.status === 'ERROR' ? 'error' : 'info', i.capture.status),
      row('engine', 'Moteur', 'info', i.capture.provider ?? 'aucun actif'),
      row('capture-space', 'Espace audio', i.capture.storageLevel && i.capture.storageLevel !== 'ok' ? 'warn' : 'ok', i.capture.storageLevel ?? 'inconnu'),
      row('capture-failed', 'Segments non enregistrés', i.capture.failedChunks ? 'warn' : 'ok', String(i.capture.failedChunks)),
    ] },
    { id: 'ai', title: 'IA', rows: [
      row('ai', 'Moteur IA', i.ai.available ? 'ok' : 'info', i.ai.available ? i.ai.label ?? 'Disponible' : 'Non configuré'),
      ...(i.server?.services?.ai ? [row('ai-server', 'Côté serveur', i.server.services.ai === 'enabled' ? 'ok' : 'warn', ({ enabled: 'Activée', disabled: 'Désactivée (interrupteur d’urgence)', not_configured: 'Non configurée' } as Record<string, string>)[i.server.services.ai] ?? i.server.services.ai, i.server.services.ai === 'disabled' ? 'AI-DISABLED' : undefined)] : []),
    ] },
    { id: 'storage', title: 'Stockage local', rows: [
      row('idb', 'Base locale', i.storage.kind === 'indexeddb' ? 'ok' : 'error', i.storage.kind === 'indexeddb' ? 'IndexedDB' : 'Mémoire temporaire (non persistant)', i.storage.kind === 'indexeddb' ? undefined : 'STORE-IDB-01'),
      row('persist', 'Stockage durable', i.storage.persisted === false ? 'warn' : 'info', i.storage.persisted === null ? 'inconnu' : i.storage.persisted ? 'Accordé' : 'Non accordé (le navigateur peut effacer en cas de manque d’espace)'),
      row('usage', 'Espace utilisé', 'info', i.storage.usageKb === null ? 'inconnu' : `${i.storage.usageKb} Ko${i.storage.quotaMb ? ` sur ${i.storage.quotaMb} Mo` : ''}`),
    ] },
    { id: 'pwa', title: 'Application installable (PWA)', rows: [
      row('standalone', 'Mode', 'info', i.pwa.standalone ? 'Installée' : 'Navigateur'),
      row('sw', 'Mode hors ligne', i.pwa.serviceWorker ? 'ok' : 'warn', i.pwa.serviceWorker ? 'Service worker actif' : 'Service worker inactif'),
      row('https', 'Contexte sécurisé', i.pwa.secureContext ? 'ok' : 'warn', i.pwa.secureContext ? 'HTTPS' : 'Non sécurisé'),
    ] },
  ];
  if (i.server) {
    const s = i.server;
    sections.push({ id: 'server', title: 'Serveur LexNote (health)', rows: s.reachable ? [
      row('health', 'État global', s.status === 'ok' ? 'ok' : 'warn', s.status ?? 'inconnu'),
      ...Object.entries(s.services ?? {}).filter(([k]) => k !== 'ai').map(([k, v]) => row(`health-${k}`, k, v === 'ok' ? 'ok' : v === 'not_configured' ? 'info' : 'warn', v)),
      ...(s.missing?.length ? [row('health-missing', 'Éléments de schéma manquants', 'warn', s.missing.join(', '))] : []),
    ] : [row('health', 'Sonde health', 'warn', 'Injoignable')] });
  }
  if (i.logs.length) {
    sections.push({ id: 'events', title: 'Derniers événements', rows: i.logs.slice(-10).reverse().map((l, n) => row(`log-${n}`, `[${l.scope}] ${l.at.slice(11, 19)}`, l.level === 'error' ? 'error' : l.level === 'warn' ? 'warn' : 'info', l.message, l.code)) });
  }
  return sections;
}

/** Texte à copier pour le support : expurgé, sans contenu. */
export function diagnosticText(sections: DiagSection[]): string {
  const lines = ['LexNote — diagnostic'];
  for (const s of sections) {
    lines.push('', `## ${s.title}`);
    for (const r of s.rows) lines.push(`- ${r.label} : ${r.value}${r.code ? ` [${r.code}${errorInfo(r.code) ? ` — ${errorInfo(r.code)!.title}` : ''}]` : ''}`);
  }
  return redact(lines.join('\n'));
}
