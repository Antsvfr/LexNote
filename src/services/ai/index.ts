/**
 * Couche IA de LexNote.
 *
 * Règles d'architecture :
 *  1. L'UI n'appelle JAMAIS un fournisseur directement : tout passe par `aiService`.
 *  2. Changer de fournisseur/modèle = écrire un `AIProvider` et l'enregistrer ici (ou changer le modèle CÔTÉ SERVEUR).
 *  3. Toute sortie IA est un `AIResult` : provenance 'AI', statut 'UNVERIFIED' au départ, avec le modèle utilisé.
 *     L'IA n'invente jamais silencieusement une référence, une donnée ou une citation.
 *  4. AUCUNE clé de modèle dans le navigateur : un fournisseur distant est un point d'accès serveur (Edge Function `study-ai`)
 *     authentifié par le jeton de session de l'utilisateur ; la clé reste un secret du serveur.
 *  5. Seul du TEXTE (transcription, notes, supports) est envoyé — jamais l'audio.
 *
 * Par défaut aucun moteur n'est branché : `NullProvider` refuse proprement (« Fonction IA non configurée »).
 */
import type { Provenance, VerificationStatus } from '@/domain/legal';

/** Commandes de l'éditeur (assistant de prise de notes). */
export type AICommandId =
  | 'rephrase'
  | 'explain'
  | 'summarize'
  | 'expand'
  | 'correct'
  | 'verify-legal';

/** Tâches appliquées à une transcription (ou à un passage, ou à un support existant). */
export const TRANSCRIPT_TASKS = [
  'summarize', 'translate', 'structure', 'clean', 'key-points', 'glossary', 'definitions', 'exam-questions', 'to-remember', 'course-plan',
  'concepts', 'important-passages', 'ambiguities', 'teacher-questions', 'explain', 'flashcard',
  /** Synthèse intermédiaire d'une partie (longues transcriptions) : réutilisée par toutes les actions suivantes. */
  'digest',
] as const;
export type TranscriptTaskId = (typeof TRANSCRIPT_TASKS)[number];

export interface AICommandDef {
  id: AICommandId;
  label: string;
  description: string;
}

/** Catalogue des commandes de l'éditeur (affichées « bientôt » tant qu'elles ne sont pas branchées dans l'éditeur). */
export const AI_COMMANDS: readonly AICommandDef[] = [
  { id: 'rephrase', label: 'Reformuler', description: 'Réécrire la sélection plus clairement' },
  { id: 'explain', label: 'Expliquer', description: 'Expliquer une notion ou un passage' },
  { id: 'summarize', label: 'Résumer', description: 'Résumer la sélection ou la séance' },
  { id: 'expand', label: 'Développer', description: 'Développer une idée notée en abrégé' },
  { id: 'correct', label: 'Corriger', description: 'Corriger orthographe et formulation' },
  // Identifiant historique conservé (compatibilité) ; la vérification porte sur toutes les références citées.
  { id: 'verify-legal', label: 'Vérifier les références', description: 'Contrôler les références, chiffres et sources cités' },
] as const;

export type AIOptions = Record<string, string | number | boolean>;

export interface AIRequest {
  command: AICommandId | TranscriptTaskId;
  /** Texte à traiter (transcription, passage, synthèses intermédiaires…). */
  input: string;
  /** Réglages de la tâche : `mode` (résumé), `targetLanguage`, `sourceLanguage`, `fromDigest`… */
  options?: AIOptions;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface AIResult {
  /** Réponse brute du moteur (JSON du document attendu, ou texte). Toujours revalidée côté application. */
  text: string;
  /** Toujours 'AI' : une sortie IA ne se fait jamais passer pour du cours. */
  provenance: Extract<Provenance, 'AI'>;
  /** Toujours 'UNVERIFIED' à la création. */
  verification: Extract<VerificationStatus, 'UNVERIFIED'>;
  providerId: string;
  model: string;
  generatedAt: string;
}

export interface AIProvider {
  readonly id: string;
  readonly label: string;
  /** Faux tant que le fournisseur n'est pas configuré et opérationnel. */
  isAvailable(): boolean;
  /** Taille de texte (caractères) traitée en un seul appel ; au-delà, l'application découpe. */
  readonly maxInputChars?: number;
  run(request: AIRequest): Promise<AIResult>;
}

export class AINotConfiguredError extends Error {
  constructor() {
    super('Fonction IA non configurée : aucun moteur d’IA n’est branché sur cette installation de LexNote.');
    this.name = 'AINotConfiguredError';
  }
}
export class AIOfflineError extends Error {
  constructor() { super('Vous êtes hors ligne : cette action nécessite une connexion. Vos notes et votre transcription restent disponibles.'); this.name = 'AIOfflineError'; }
}
/** Le moteur a répondu une erreur ou ne répond pas. `retryable` : réessayer plus tard a du sens (surcharge, réseau). */
export class AIUnavailableError extends Error {
  constructor(message: string, readonly retryable = true) { super(message); this.name = 'AIUnavailableError'; }
}
export class AIAuthError extends Error {
  constructor() { super('Connectez-vous pour utiliser les fonctions IA.'); this.name = 'AIAuthError'; }
}

export const NullProvider: AIProvider = {
  id: 'none',
  label: 'Aucun',
  isAvailable: () => false,
  async run() {
    throw new AINotConfiguredError();
  },
};

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * Fournisseur distant : POST JSON vers l'Edge Function `study-ai` avec le jeton de session de l'utilisateur.
 * Le choix du fournisseur et du modèle est fait CÔTÉ SERVEUR (secrets) : l'application n'en sait rien.
 */
/** Erreur HTTP de `study-ai` → message clair (limites, refus, délai). Un refus du modèle n'est jamais « contourné » ni réessayé. */
export function remoteError(status: number, body: unknown, retryAfterHeader?: string | null): Error {
  const b = (body && typeof body === 'object' ? body : {}) as { error?: unknown; reason?: unknown; limit?: unknown; retry_after?: unknown };
  if (status === 503 && b.error === 'not_configured') return new AINotConfiguredError();
  // Interrupteur d'urgence (STUDY_AI_ENABLED=false) ou budget GLOBAL atteint : indisponibilité volontaire, inutile de réessayer tout de suite.
  if (status === 503 && b.error === 'ai_disabled') return new AIUnavailableError('Les fonctions IA sont temporairement indisponibles. (AI-DISABLED)', false);
  if (status === 503 && b.error === 'ai_capacity') return new AIUnavailableError('Les fonctions IA sont temporairement indisponibles. (AI-CAPACITY)', false);
  if (status === 413) return new AIUnavailableError('Texte trop long pour une seule requête.', false);
  if (status === 422) return new AIUnavailableError('Le moteur IA a refusé de traiter ce contenu. Aucune nouvelle tentative n’est faite automatiquement : reformulez ou réduisez la sélection.', false);
  if (status === 429) {
    const secs = Number(b.retry_after ?? retryAfterHeader);
    const wait = Number.isFinite(secs) && secs > 0 ? ` Réessayez dans ${secs < 120 ? `${Math.ceil(secs)} s` : secs < 7200 ? `${Math.ceil(secs / 60)} min` : `${Math.ceil(secs / 3600)} h`}.` : ' Réessayez plus tard.';
    const what = b.reason === 'concurrent' ? `Trop d’analyses IA en cours en même temps${b.limit ? ` (max ${b.limit})` : ''}.`
      : b.reason === 'per_minute' ? `Trop de demandes IA en une minute${b.limit ? ` (max ${b.limit})` : ''}.`
      : b.reason === 'per_day' ? `Quota quotidien de demandes IA atteint${b.limit ? ` (${b.limit} par jour)` : ''}.`
      : b.reason === 'chars_per_day' ? 'Volume quotidien de texte analysé par l’IA atteint.'
      : 'Trop de demandes en peu de temps.';
    return new AIUnavailableError(what + wait, false);
  }
  if (status === 504 || b.error === 'timeout') return new AIUnavailableError('Le moteur IA a mis trop de temps à répondre. Réessayez avec un passage plus court.');
  if (status === 503 && b.error === 'rate_limit_unavailable') return new AIUnavailableError('Contrôle des quotas IA momentanément indisponible. Réessayez dans un instant.');
  if (status === 503 && b.error === 'provider_busy') return new AIUnavailableError('Le fournisseur IA est saturé. Réessayez dans un instant.');
  if (b.error === 'truncated') return new AIUnavailableError('Réponse IA incomplète (trop longue). Essayez sur un passage plus court.', false);
  return new AIUnavailableError(`Le moteur IA est momentanément indisponible (erreur ${status}). Réessayez.`);
}

export function createRemoteAIProvider(cfg: {
  endpoint: string; getToken: () => Promise<string | null>; label?: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxInputChars?: number;
}): AIProvider {
  return {
    id: 'remote', label: cfg.label ?? 'IA LexNote', maxInputChars: cfg.maxInputChars ?? 60_000,
    isAvailable: () => !!cfg.endpoint,
    async run(req) {
      if (isOffline()) throw new AIOfflineError();
      const token = await cfg.getToken();
      if (!token) throw new AIAuthError();
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? 180_000);
      req.signal?.addEventListener('abort', () => ctl.abort());
      let res: Response;
      try {
        res = await (cfg.fetchImpl ?? fetch)(cfg.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ task: req.command, input: req.input, options: req.options ?? {} }),
          signal: ctl.signal,
        });
      } catch {
        if (req.signal?.aborted) throw new DOMException('Annulé', 'AbortError');
        throw new AIUnavailableError(ctl.signal.aborted ? 'Le moteur IA ne répond pas (délai dépassé). Réessayez.' : 'Moteur IA injoignable (réseau ?). Réessayez.');
      } finally { clearTimeout(timer); }
      if (res.status === 401 || res.status === 403) throw new AIAuthError();
      if (!res.ok) throw remoteError(res.status, await res.json().catch(() => null), res.headers.get('Retry-After'));
      const body = (await res.json().catch(() => null)) as { text?: unknown; model?: unknown; provider?: unknown } | null;
      if (!body || typeof body.text !== 'string') throw new AIUnavailableError('Réponse du moteur IA illisible.', false);
      return {
        text: body.text, provenance: 'AI', verification: 'UNVERIFIED', providerId: `remote:${typeof body.provider === 'string' ? body.provider : 'study-ai'}`,
        model: typeof body.model === 'string' ? body.model : 'inconnu', generatedAt: new Date().toISOString(),
      };
    },
  };
}

class AIService {
  private provider: AIProvider = NullProvider;
  private listeners = new Set<() => void>();
  setProvider(p: AIProvider) {
    this.provider = p;
    this.listeners.forEach((l) => l());
  }
  reset() { this.setProvider(NullProvider); }
  /** Pour l'interface : être prévenu quand un moteur est branché / retiré. */
  subscribe(l: () => void) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
  get providerId() {
    return this.provider.id;
  }
  get label() { return this.provider.label; }
  get maxInputChars() { return this.provider.maxInputChars ?? 60_000; }
  isAvailable() {
    return this.provider.isAvailable();
  }
  run(request: AIRequest): Promise<AIResult> {
    if (!this.provider.isAvailable()) return Promise.reject(new AINotConfiguredError());
    return this.provider.run(request);
  }
}

export const aiService = new AIService();
