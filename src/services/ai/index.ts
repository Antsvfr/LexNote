/**
 * Couche IA de LexNote.
 *
 * Règles d'architecture :
 *  1. L'UI n'appelle JAMAIS un fournisseur directement : tout passe par `aiService`.
 *  2. Changer de fournisseur/modèle = écrire un `AIProvider` et l'enregistrer ici.
 *  3. Toute sortie IA est un `AIResult` : provenance 'AI', statut 'UNVERIFIED' au départ,
 *     avec le modèle utilisé. L'IA n'invente jamais silencieusement un article ou un arrêt.
 *  4. Les traitements lourds tournent hors du fil de l'éditeur (worker / requête réseau).
 *
 * En V1 aucun moteur n'est branché : `NullProvider` refuse proprement.
 */
import type { Provenance, VerificationStatus } from '@/domain/legal';

export type AICommandId =
  | 'rephrase'
  | 'explain'
  | 'summarize'
  | 'expand'
  | 'correct'
  | 'verify-legal';

export interface AICommandDef {
  id: AICommandId;
  label: string;
  description: string;
}

/** Catalogue des commandes prévues (affichées "bientôt" tant qu'aucun moteur n'existe). */
export const AI_COMMANDS: readonly AICommandDef[] = [
  { id: 'rephrase', label: 'Reformuler', description: 'Réécrire la sélection plus clairement' },
  { id: 'explain', label: 'Expliquer', description: 'Expliquer une notion ou un passage' },
  { id: 'summarize', label: 'Résumer', description: 'Résumer la sélection ou le CM' },
  { id: 'expand', label: 'Développer', description: 'Développer une idée notée en abrégé' },
  { id: 'correct', label: 'Corriger', description: 'Corriger orthographe et formulation' },
  { id: 'verify-legal', label: 'Vérifier juridiquement', description: 'Contrôler articles, arrêts et règles cités' },
] as const;

export interface AIRequest {
  command: AICommandId;
  /** Texte sélectionné ou contexte fourni. */
  input: string;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface AIResult {
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
  run(request: AIRequest): Promise<AIResult>;
}

export class AINotConfiguredError extends Error {
  constructor() {
    super("Aucun moteur IA n'est configuré dans cette version de LexNote.");
    this.name = 'AINotConfiguredError';
  }
}

export const NullProvider: AIProvider = {
  id: 'none',
  label: 'Aucun',
  isAvailable: () => false,
  async run() {
    throw new AINotConfiguredError();
  },
};

class AIService {
  private provider: AIProvider = NullProvider;
  setProvider(p: AIProvider) {
    this.provider = p;
  }
  get providerId() {
    return this.provider.id;
  }
  isAvailable() {
    return this.provider.isAvailable();
  }
  run(request: AIRequest): Promise<AIResult> {
    return this.provider.run(request);
  }
}

export const aiService = new AIService();
