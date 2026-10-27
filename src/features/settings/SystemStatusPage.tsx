import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Copy, RefreshCw } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { useSync } from '@/store/sync';
import { useCapture } from '@/store/capture';
import { useLibrary } from '@/store/library';
import { aiService } from '@/services/ai';
import { getBackend } from '@/services/backend';
import { getBuildInfo } from '@/lib/buildInfo';
import { recentLogs } from '@/lib/log';
import { errorInfo } from '@/lib/errorCodes';
import { readDevice, isStandalone } from '@/services/auth/device';
import { toast } from '@/store/toasts';
import { buildDiagnostic, diagnosticText, maskEmail, type HealthResult, type RowStatus } from './diagnostics';

const ICON: Record<RowStatus, string> = { ok: '✓', warn: '!', error: '✕', info: '·' };

/** Sonde publique `health` (aucune donnée sensible). Hors Supabase / hors ligne : « injoignable », jamais une erreur. */
async function fetchHealth(): Promise<HealthResult> {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base) return { reachable: false };
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/functions/v1/health`, { signal: AbortSignal.timeout(6000), headers: { apikey: String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '') } });
    const j = (await r.json()) as { status?: string; services?: Record<string, string>; missing?: string[] };
    return { reachable: true, status: j.status, services: j.services, missing: j.missing };
  } catch { return { reachable: false }; }
}

/** Réglages → Diagnostic : l'état du système en un coup d'œil, sans jamais afficher de jeton, de clé ni de contenu. */
export function SystemStatusPage() {
  const auth = useAuth();
  const sync = useSync();
  const capture = useCapture();
  const lib = useLibrary();
  const [conn, setConn] = useState<{ state: string | null; checked: boolean }>({ state: null, checked: false });
  const [storage, setStorage] = useState<{ persisted: boolean | null; usageKb: number | null; quotaMb: number | null }>({ persisted: null, usageKb: null, quotaMb: null });
  const [server, setServer] = useState<HealthResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState(recentLogs());

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [persisted, est, health, status] = await Promise.all([
        navigator.storage?.persisted?.().catch(() => null) ?? null,
        navigator.storage?.estimate?.().catch(() => null) ?? null,
        fetchHealth(),
        auth.status === 'authenticated' ? getBackend().then((b) => b.integration.call('status')).catch(() => null) : null,
      ]);
      setStorage({ persisted, usageKb: est?.usage != null ? Math.round(est.usage / 1024) : null, quotaMb: est?.quota != null ? Math.round(est.quota / 1048576) : null });
      setServer(health);
      setConn({ checked: true, state: status && status.ok && status.state ? status.state.state : null });
      setLogs(recentLogs());
    } finally { setBusy(false); }
  }, [auth.status]);
  useEffect(() => { void refresh(); }, [refresh]);

  const sections = buildDiagnostic({
    build: getBuildInfo(), online: navigator.onLine,
    auth: { status: auth.status, emailMasked: maskEmail(auth.user?.email), offlineSession: auth.offlineSession, backend: auth.backendKind, remember: readDevice().remember },
    sync, integration: conn,
    capture: { status: capture.status, provider: capture.providerLabel, storageLevel: capture.storage?.level ?? null, failedChunks: capture.failedChunks },
    ai: { available: aiService.isAvailable(), label: aiService.isAvailable() ? aiService.label : null },
    storage: { kind: lib.persistent ? 'indexeddb' : 'memory', ...storage },
    pwa: { standalone: isStandalone(), serviceWorker: !!navigator.serviceWorker?.controller, secureContext: window.isSecureContext },
    server, logs,
  });

  return (
    <div className="page" data-testid="system-status">
      <Link to="/settings" className="btn btn--ghost" style={{ marginBottom: 8 }}><ArrowLeft /> Réglages</Link>
      <h1>Diagnostic</h1>
      <p className="page__sub">L’état de LexNote sur cet appareil. Aucune donnée personnelle, clé ni contenu de note n’est affiché ou copié.</p>
      <div className="row-actions" style={{ margin: '12px 0' }}>
        <button className="btn" onClick={() => void refresh()} disabled={busy}><RefreshCw /> {busy ? 'Vérification…' : 'Actualiser'}</button>
        <button className="btn" onClick={() => { void navigator.clipboard?.writeText(diagnosticText(sections)).then(() => toast.success('Diagnostic copié.'), () => toast.error('Copie impossible.')); }}><Copy /> Copier le diagnostic</button>
      </div>
      {sections.map((s) => (
        <section key={s.id} className="settings-block" aria-labelledby={`diag-${s.id}`}>
          <h2 id={`diag-${s.id}`}>{s.title}</h2>
          <dl className="diag-list">
            {s.rows.map((r) => (
              <div key={r.id} className={`diag-row diag-row--${r.status}`} data-testid={`diag-${r.id}`}>
                <dt>{r.label}</dt>
                <dd><span className="diag-icon" aria-hidden="true">{ICON[r.status]}</span> {r.value}{r.code && <> <code title={errorInfo(r.code)?.hint}>{r.code}</code></>}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
