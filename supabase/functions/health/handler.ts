// Logique de l'Edge Function « health » — sonde PUBLIQUE d'exploitation. Aucune dépendance Deno : testée par Vitest (tests/prod/health.test.ts).
//
// Ce que la réponse contient : un état par service (ok / incomplete / not_configured…), la version et l'heure.
// Ce qu'elle ne contient JAMAIS : clé, secret, URL interne, identifiant d'utilisateur, nombre d'utilisateurs, contenu, message d'erreur brut.
// Les noms des éléments de schéma manquants (ex. « devices ») ne sont pas sensibles : ils disent quelle migration appliquer.
import { isAiEnabled } from '../study-ai/budgets.ts';

export type ServiceState = 'ok' | 'down' | 'incomplete' | 'unknown' | 'not_configured' | 'not_deployed' | 'jwt_protected' | 'enabled' | 'disabled' | 'error';
export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  time: string;
  services: { database: ServiceState; schema: ServiceState; integration: ServiceState; ai: ServiceState };
  missing?: string[];
}
export interface HealthDeps {
  env: (name: string) => string | undefined;
  /** Résultat de `app_health()` (booléens), ou null si la base est injoignable. */
  appHealth: () => Promise<Record<string, unknown> | null>;
  /** Code HTTP d'un GET sur la fonction (sans authentification), ou null si injoignable. */
  probeFunction: (name: string) => Promise<number | null>;
  now?: () => Date;
}

/** Classe le code renvoyé par un GET non authentifié d'une fonction d'intégration. */
export function classifyProbe(status: number | null): ServiceState {
  if (status === null) return 'error';
  if (status === 404) return 'not_deployed';
  if (status === 401 || status === 403) return 'jwt_protected'; // verify_jwt actif : la passerelle partenaire serait refusée
  return status < 500 ? 'ok' : 'error';
}

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', ...extra } });

export async function buildReport(deps: HealthDeps): Promise<HealthReport> {
  const version = (deps.env('RELEASE_VERSION') || deps.env('APP_VERSION') || 'unknown').slice(0, 40);
  const time = (deps.now?.() ?? new Date()).toISOString();
  let flags: Record<string, unknown> | null = null;
  try { flags = await deps.appHealth(); } catch { flags = null; }
  const database: ServiceState = flags ? 'ok' : 'down';
  const missing = flags ? Object.entries(flags).filter(([, v]) => v !== true).map(([k]) => k) : [];
  const schema: ServiceState = !flags ? 'unknown' : missing.length ? 'incomplete' : 'ok';

  const configured = !!deps.env('INTEGRATION_KEY') || !!deps.env('INTEGRATION_KEYS');
  let integration: ServiceState = 'not_configured';
  if (configured) {
    const [gw, link] = await Promise.all(['integration-gateway', 'integration-link'].map((n) => deps.probeFunction(n).catch(() => null)));
    const states = [classifyProbe(gw), classifyProbe(link)];
    integration = states.find((s) => s !== 'ok') ?? 'ok';
  }
  const ai: ServiceState = !deps.env('ANTHROPIC_API_KEY') ? 'not_configured' : isAiEnabled(deps.env) ? 'enabled' : 'disabled';

  const status: HealthReport['status'] = database === 'down' ? 'down'
    : schema !== 'ok' || (integration !== 'ok' && integration !== 'not_configured') ? 'degraded' : 'ok';
  return { status, version, time, services: { database, schema, integration, ai }, ...(missing.length ? { missing } : {}) };
}

export async function handleHealth(req: Request, deps: HealthDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, OPTIONS' });
  const report = await buildReport(deps);
  return json(report, report.status === 'down' ? 503 : 200);
}
