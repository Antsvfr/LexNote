import { describe, expect, it } from 'vitest';
import { buildDiagnostic, diagnosticText, maskEmail, type DiagnosticInput } from './diagnostics';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
const base = (over: Partial<DiagnosticInput> = {}): DiagnosticInput => ({
  build: { version: '0.1.0', sha: 'a'.repeat(40), shortSha: 'aaaaaaa', builtAt: '2026-10-16T10:00:00Z', label: 'v0.1.0 (aaaaaaa)' },
  online: true,
  auth: { status: 'authenticated', emailMasked: maskEmail('marie.dupont@exemple.fr'), offlineSession: false, backend: 'supabase', remember: true },
  sync: { state: 'synced', pending: 0, lastSyncAt: '2026-10-16T10:05:00Z', error: null, conflicts: 0 },
  integration: { state: 'CONNECTED', checked: true },
  capture: { status: 'INACTIVE', provider: null, storageLevel: 'ok', failedChunks: 0 },
  ai: { available: true, label: 'IA LexNote' },
  storage: { kind: 'indexeddb', persisted: true, usageKb: 420, quotaMb: 2048 },
  pwa: { standalone: false, serviceWorker: true, secureContext: true },
  server: { reachable: true, status: 'ok', services: { database: 'ok', schema: 'ok', integration: 'ok', ai: 'enabled' } },
  logs: [], ...over,
});
const rows = (i: DiagnosticInput) => Object.fromEntries(buildDiagnostic(i).flatMap((s) => s.rows).map((r) => [r.id, r]));

describe('diagnostic système', () => {
  it('couvre compte, synchronisation, REV-EM, transcription, IA, stockage local, PWA, version et build', () => {
    expect(buildDiagnostic(base()).map((s) => s.id)).toEqual(['app', 'account', 'sync', 'revem', 'transcription', 'ai', 'storage', 'pwa', 'server']);
    expect(rows(base()).version!.value).toBe('v0.1.0 (aaaaaaa)');
  });
  it('tout va bien → aucune ligne en erreur', () => {
    expect(Object.values(rows(base())).filter((r) => r.status === 'error' || r.status === 'warn')).toEqual([]);
  });
  it('problèmes → statuts et codes de diagnostic', () => {
    const r = rows(base({
      online: false, sync: { state: 'error', pending: 4, lastSyncAt: null, error: 'HTTP 503', conflicts: 2 },
      storage: { kind: 'memory', persisted: false, usageKb: null, quotaMb: null }, auth: { status: 'unauthenticated', emailMasked: null, offlineSession: false, backend: 'supabase', remember: false },
      server: { reachable: true, status: 'degraded', services: { database: 'ok', schema: 'incomplete', integration: 'ok', ai: 'disabled' }, missing: ['devices'] },
    }));
    expect(r.network).toMatchObject({ status: 'warn', code: 'SYNC-OFFLINE-01' });
    expect(r['sync-state']).toMatchObject({ status: 'error', code: 'SYNC-REMOTE-04' });
    expect(r['sync-conflicts']).toMatchObject({ status: 'warn', code: 'SYNC-CONFLICT-02' });
    expect(r.idb).toMatchObject({ status: 'error', code: 'STORE-IDB-01' });
    expect(r.auth).toMatchObject({ status: 'warn', code: 'AUTH-SESSION-01' });
    expect(r['ai-server']).toMatchObject({ status: 'warn', code: 'AI-DISABLED' });
    expect(r['health-schema']).toMatchObject({ status: 'warn' });
    expect(r['health-missing']!.value).toBe('devices');
  });
  it('sonde health injoignable : simple avertissement', () => {
    expect(rows(base({ server: { reachable: false } })).health).toMatchObject({ status: 'warn', value: 'Injoignable' });
  });
  it('l’e-mail est masqué', () => {
    expect(maskEmail('marie.dupont@exemple.fr')).toBe('m***@exemple.fr');
    expect(maskEmail(null)).toBeNull();
  });
  it('AUCUN secret ni contenu dans le texte copié, même si un journal en contient par erreur', () => {
    const text = diagnosticText(buildDiagnostic(base({
      logs: [{ at: '2026-10-16T10:00:00Z', level: 'error', scope: 'sync', message: `échec avec ${JWT} et marie.dupont@exemple.fr et sk-ant-api03-${'z'.repeat(30)}`, code: 'SYNC-REMOTE-04' }],
    })));
    for (const forbidden of [JWT, 'marie.dupont', 'sk-ant', 'refresh_token', 'service_role', 'INTEGRATION_KEY', 'Bearer ']) expect(text).not.toContain(forbidden);
    expect(text).toContain('m***@exemple.fr');
    expect(text).toContain('SYNC-REMOTE-04');
  });
});
