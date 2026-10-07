/**
 * Fournisseur de moteur : local (règles, hors-ligne) ou distant (modèle cloud / local derrière une fonction serveur).
 * L'application ne parle JAMAIS à un modèle directement et ne contient AUCUNE clé : un fournisseur distant est un point d'accès
 * (Edge Function) authentifié par le jeton de l'utilisateur ; la clé du modèle reste côté serveur (voir supabase/functions/course-engine).
 */
import type { CourseKnowledgeUnit } from '@/domain/course';
import type { KnowledgeAnalyzer } from './analyzer';
import type { Plan, PlanNode } from './structure';

export class EngineUnavailableError extends Error {
  constructor(message = 'Le moteur de cours est injoignable.') { super(message); this.name = 'EngineUnavailableError'; }
}

/** Contexte SÉLECTIONNÉ envoyé à un moteur distant : le plan + les connaissances (pas la transcription brute de 3 h). */
export interface ComposeInput {
  title: string;
  plan: { id: string; title: string; level: number; parentId: string | null }[];
  units: { id: string; type: string; label?: string; text: string; nodeId: string | null; confidence: string; refs: { chunkId: string; quote: string }[] }[];
}

export interface CourseEngineProvider {
  readonly id: string;
  readonly label: string;
  /** Local, sans réseau ? (toujours disponible) */
  readonly local: boolean;
  isAvailable(): boolean;
  /** Analyse des morceaux (sinon : règles locales). */
  analyzer?: KnowledgeAnalyzer;
  /** Composition du cours : renvoie du JSON conforme à `generatedCourseContentSchema` (sinon : génération locale). */
  compose?(input: ComposeInput, signal?: AbortSignal): Promise<unknown>;
}

export const localProvider: CourseEngineProvider = { id: 'local', label: 'Moteur local (sans IA)', local: true, isAvailable: () => true };

export function toComposeInput(title: string, plan: Plan, units: CourseKnowledgeUnit[]): ComposeInput {
  const flat: ComposeInput['plan'] = [];
  const walk = (n: PlanNode, parent: string | null) => { flat.push({ id: n.id, title: n.title, level: n.level, parentId: parent }); n.children.forEach((c) => walk(c, n.id)); };
  plan.roots.forEach((r) => walk(r, null));
  return { title, plan: flat, units: units.map((u) => ({ id: u.id, type: u.type, label: u.label, text: u.text.slice(0, 500), nodeId: plan.unitNode.get(u.id) ?? null, confidence: u.confidence, refs: u.refs.map((r) => ({ chunkId: r.chunkId, quote: r.quote.slice(0, 300) })) })) };
}

/** Moteur distant : POST JSON vers un point d'accès serveur (Edge Function) avec le jeton de session. Aucune clé de modèle ici. */
export function createRemoteProvider(cfg: { endpoint: string; getToken: () => Promise<string | null>; label?: string; fetchImpl?: typeof fetch; timeoutMs?: number }): CourseEngineProvider {
  return {
    id: 'remote', label: cfg.label ?? 'Moteur distant', local: false,
    isAvailable: () => !!cfg.endpoint && (typeof navigator === 'undefined' || navigator.onLine !== false),
    async compose(input, signal) {
      const token = await cfg.getToken();
      if (!token) throw new EngineUnavailableError('Connectez-vous pour utiliser le moteur distant.');
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? 120_000);
      signal?.addEventListener('abort', () => ctl.abort());
      try {
        const res = await (cfg.fetchImpl ?? fetch)(cfg.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ task: 'compose', input }), signal: ctl.signal });
        if (!res.ok) throw new EngineUnavailableError(res.status === 401 || res.status === 403 ? 'Moteur distant : accès refusé.' : `Moteur distant : erreur ${res.status}.`);
        return await res.json();
      } catch (e) {
        if (e instanceof EngineUnavailableError) throw e;
        throw new EngineUnavailableError(ctl.signal.aborted && !signal?.aborted ? 'Le moteur distant ne répond pas.' : 'Moteur distant injoignable (réseau ?).');
      } finally { clearTimeout(timer); }
    },
  };
}

const registry = new Map<string, CourseEngineProvider>([[localProvider.id, localProvider]]);
let activeId = localProvider.id;
export const registerEngineProvider = (p: CourseEngineProvider) => { registry.set(p.id, p); };
export const unregisterEngineProvider = (id: string) => { if (id !== 'local') registry.delete(id); if (activeId === id) activeId = 'local'; };
export const listEngineProviders = () => [...registry.values()];
export const setActiveEngineProvider = (id: string) => { if (registry.has(id)) activeId = id; };
export const getActiveEngineProvider = () => registry.get(activeId) ?? localProvider;
