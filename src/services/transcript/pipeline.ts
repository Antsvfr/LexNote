/**
 * Exécution d'une action sur une transcription → StudyArtifact (document dérivé, provenance complète).
 *
 *   texte source (original | nettoyé | sélection | support)
 *     ├─ court  → 1 appel au moteur
 *     └─ long   → découpage en parties → SYNTHÈSE INTERMÉDIAIRE par partie (mise en cache, réutilisée par toutes les actions)
 *                 → 1 appel final sur les synthèses
 *   traduction / nettoyage IA : partie par partie (on ne « résume » pas une traduction), puis concaténation.
 *
 * Coût maîtrisé : jamais 10 traitements complets de la même transcription — les synthèses intermédiaires d'une version donnée
 * de la transcription sont calculées une fois et conservées SUR L'APPAREIL (IndexedDB, voir `digestStore.ts`) : elles survivent au
 * rechargement de la page. Si les synthèses réunies dépassent encore la taille d'une requête, elles sont elles-mêmes condensées
 * (réduction récursive, profondeur bornée). Aucune réponse n'est simulée : sans moteur, `AINotConfiguredError`.
 */
import { newId } from '@/lib/ids';
import { formatHMS } from '@/domain/capture';
import { languageLabel, type DocBlock, type DocContent, type DerivedSourceKind, type GeneratorInfo, type TranscriptProvenance } from '@/domain/derived';
import type { StudyArtifact } from '@/domain/study';
import { AINotConfiguredError, AIOfflineError, type AIOptions, type AIRequest, type AIResult } from '@/services/ai';
import { chunkParagraphs, type Paragraph } from './source';
import { cleanTranscriptLocally } from './clean';
import { parseModelDoc } from './docFormat';
import { detectLanguage } from './language';
import { SUMMARY_MODES, type SummaryMode, type TranscriptAction } from './actions';
import { hashText } from '@/services/engine/text';
import { createDigestStore, DIGEST_PROMPT_VERSION, type DigestStore } from './digestStore';

export class EmptyTranscriptError extends Error {
  constructor(message = 'La transcription est vide : il n’y a rien à traiter. Activez la transcription pendant la séance, ou ajoutez des notes.') { super(message); this.name = 'EmptyTranscriptError'; }
}
export class TooShortError extends Error { constructor(message: string) { super(message); this.name = 'TooShortError'; } }

/** Ce dont le pipeline a besoin du moteur (interface minimale : testable avec un double). */
export interface AIEngine {
  isAvailable(): boolean;
  run(req: AIRequest): Promise<AIResult>;
  readonly maxInputChars: number;
  /** Identifiant du moteur (entre dans la clé du cache des synthèses). */
  readonly providerId?: string;
}

export interface DerivedSource {
  kind: DerivedSourceKind;
  paragraphs: Paragraph[];
  /** Empreinte de la transcription (ou de l'artefact source). */
  version: string;
  words: number;
  range?: { startMs: number; endMs: number };
  parentArtifactId?: string;
  /** Langue connue du texte (sinon détectée). */
  language?: string;
}

export interface RunOptions { mode?: SummaryMode; targetLanguage?: string; cleanDepth?: 'light' | 'ai' }
export interface Progress { step: string; done: number; total: number }

export interface RunInput {
  action: TranscriptAction;
  session: { id: string; title: string; subjectId: string | null };
  userId: string;
  source: DerivedSource;
  options?: RunOptions;
  ai: AIEngine;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
  /** Langue de l'interface (langue des documents produits, sauf traduction). */
  uiLanguage?: string;
  /** Cache des synthèses intermédiaires (par défaut : IndexedDB de l'appareil). */
  digests?: DigestStore;
}

export interface RunOutput { content: DocContent; provenance: TranscriptProvenance; generator: GeneratorInfo; language: string; title: string; notice?: string }

/* ------------------------------------------------------------------ cache des synthèses intermédiaires */
/** Cache partagé par défaut (IndexedDB + mémoire). */
export const digestCache: DigestStore = createDigestStore();
/** Taille maximale d'une requête envoyée au serveur (le serveur refuse au-delà de 80 000 caractères). */
export const CLIENT_MAX_INPUT = 60_000;
/** Traduction / nettoyage : parties plus petites (la sortie ≈ l'entrée ; limite de sortie du serveur). */
export const LINEAR_CHUNK = 16_000;
const MAX_REDUCE_DEPTH = 3;

const throwIfAborted = (s?: AbortSignal) => { if (s?.aborted) throw new DOMException('Annulé', 'AbortError'); };
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const span = (a: number | null, b: number | null) => (a !== null && b !== null && (a || b) ? ` (${formatHMS(a)} – ${formatHMS(b)})` : '');

/** Point d'entrée unique (interface, sélection, régénération). */
export async function runTranscriptAction(i: RunInput): Promise<RunOutput> {
  const { action, source, options = {} } = i;
  if (!source.paragraphs.length || source.words === 0) throw new EmptyTranscriptError();
  if (source.words < action.minWords) {
    throw new TooShortError(`Le texte est trop court (${source.words} mot${source.words > 1 ? 's' : ''}) pour « ${action.label} » : il faut au moins ${action.minWords} mots pour un résultat utile.`);
  }
  const sourceLanguage = source.language ?? detectLanguage(source.paragraphs.map((p) => p.text).join(' '));
  const now = new Date().toISOString();
  const baseProv = {
    from: 'transcript' as const, sessionId: i.session.id, transcriptVersion: source.version, sourceKind: source.kind,
    ...(source.parentArtifactId ? { parentArtifactId: source.parentArtifactId } : {}), ...(source.range ? { range: source.range } : {}),
    generationType: action.id, inputWords: source.words, generatedAt: now, ...(sourceLanguage ? { sourceLanguage } : {}),
  };

  /* ---------------- nettoyage léger : sur l'appareil, sans IA */
  if (action.task === 'clean' && options.cleanDepth !== 'ai') {
    const { doc, stats } = cleanTranscriptLocally(source.paragraphs, sourceLanguage);
    if (!doc.blocks.length) throw new EmptyTranscriptError('Après nettoyage, il ne reste aucun texte exploitable.');
    const generator: GeneratorInfo = { providerId: 'lexnote-local', model: 'nettoyage-léger-v1', local: true };
    const language = sourceLanguage ?? 'und';
    return {
      content: { ...doc, language }, generator, language, title: action.title(i.session.title),
      provenance: { ...baseProv, generator, language, options: { depth: 'light' }, parts: 1 },
      notice: `${stats.fillers} hésitation(s) et ${stats.repetitions} répétition(s) retirées. Aucun mot n’a été modifié ; les passages incertains restent signalés.`,
    };
  }

  /* ---------------- tout le reste passe par le moteur IA (serveur) */
  if (!i.ai.isAvailable()) throw new AINotConfiguredError();
  if (isOffline()) throw new AIOfflineError();
  const task = action.task!;
  const target = action.task === 'translate' ? (options.targetLanguage ?? 'en') : undefined;
  const outLanguage = target ?? sourceLanguage ?? i.uiLanguage ?? 'fr';
  const max = Math.min(CLIENT_MAX_INPUT, Math.max(4000, i.ai.maxInputChars));
  const cache = i.digests ?? digestCache;
  const engineVersion = `${DIGEST_PROMPT_VERSION}:${i.ai.providerId ?? 'ai'}`;
  const cached = async (text: string, level: number, produce: () => Promise<string>) => {
    const k = { userId: i.userId, sessionId: i.session.id, transcriptVersion: `${source.version}|${source.kind}`, chunkVersion: `L${level}-${max}-${hashText(text)}`, engineVersion };
    const hit = await cache.get(k).catch(() => undefined);
    if (hit !== undefined) return hit;
    const v = await produce();
    await cache.set(k, v).catch(() => undefined);
    return v;
  };
  let model = ''; let providerId = '';
  const call = async (req: Omit<AIRequest, 'signal'>) => {
    throwIfAborted(i.signal);
    const r = await i.ai.run({ ...req, sessionId: i.session.id, signal: i.signal });
    model = r.model; providerId = r.providerId;
    return r.text;
  };
  const common: AIOptions = { outputLanguage: outLanguage, ...(sourceLanguage ? { sourceLanguage } : {}), sessionTitle: i.session.title.slice(0, 200) };

  let blocks: DocBlock[] = []; let parts = 1; let notice: string | undefined;
  const linear = action.task === 'translate' || action.task === 'clean';
  const chunks = chunkParagraphs(source.paragraphs, linear ? Math.min(max, LINEAR_CHUNK) : max);

  if (linear) {
    // partie par partie, dans l'ordre : on ne condense jamais une traduction ni un nettoyage
    if (target && sourceLanguage === target) notice = `Le texte semble déjà être en ${languageLabel(target).toLowerCase()} : la traduction peut être très proche de l’original.`;
    parts = chunks.length;
    for (const c of chunks) {
      i.onProgress?.({ step: action.task === 'translate' ? 'Traduction' : 'Nettoyage', done: c.index, total: chunks.length });
      const text = await call({ command: task, input: c.text, options: { ...common, ...(target ? { targetLanguage: target } : {}), part: c.index + 1, parts: chunks.length } });
      const doc = parseModelDoc(text, outLanguage);
      const at = c.startMs;
      blocks.push(...doc.blocks.map((b, k) => (k === 0 && at !== null && b.startMs === undefined && source.kind !== 'artifact' ? { ...b, startMs: at } : b)));
    }
  } else {
    let input: string; const opts: AIOptions = { ...common };
    if (action.task === 'summarize') { opts.mode = options.mode ?? 'standard'; }
    if (chunks.length === 1) {
      input = chunks[0]!.text;
    } else {
      // longue transcription : synthèses intermédiaires (cache par version de la transcription), puis consolidation
      parts = chunks.length;
      const digests: string[] = [];
      for (const c of chunks) {
        i.onProgress?.({ step: 'Analyse de la transcription', done: c.index, total: chunks.length + 1 });
        const d = await cached(c.text, 0, () => call({ command: 'digest', input: c.text, options: { ...common, part: c.index + 1, parts: chunks.length } }));
        digests.push(`## Partie ${c.index + 1}/${chunks.length}${span(c.startMs, c.endMs)}\n${d}`);
      }
      // réduction récursive : si les synthèses réunies dépassent encore une requête, on les condense par groupes
      let level = 0; let current = digests;
      while (current.join('\n\n').length > max && current.length > 1 && level < MAX_REDUCE_DEPTH) {
        level++;
        const groups: string[] = []; let g = '';
        for (const d of current) { if (g && g.length + d.length + 2 > max) { groups.push(g); g = ''; } g = g ? `${g}\n\n${d}` : d; }
        if (g) groups.push(g);
        if (groups.length >= current.length) break;   // aucune réduction possible (synthèses individuellement trop longues)
        const next: string[] = [];
        for (const [k, grp] of groups.entries()) {
          i.onProgress?.({ step: 'Consolidation des synthèses', done: k, total: groups.length });
          const d = await cached(grp, level, () => call({ command: 'digest', input: grp.slice(0, max), options: { ...common, fromDigest: true, part: k + 1, parts: groups.length } }));
          next.push(`## Bloc ${k + 1}/${groups.length}\n${d}`);
        }
        current = next;
      }
      input = current.join('\n\n').slice(0, max);
      opts.fromDigest = true;
      i.onProgress?.({ step: 'Rédaction', done: chunks.length, total: chunks.length + 1 });
    }
    const text = await call({ command: task, input, options: opts });
    blocks = parseModelDoc(text, outLanguage).blocks;
  }
  i.onProgress?.({ step: 'Terminé', done: 1, total: 1 });
  const generator: GeneratorInfo = { providerId: providerId || 'remote', model: model || 'inconnu', local: false };
  const opts: Record<string, string> = {};
  if (options.mode) opts.mode = options.mode;
  if (target) opts.targetLanguage = target;
  if (action.task === 'clean') opts.depth = 'ai';
  const modeLabel = SUMMARY_MODES.find((m) => m.id === options.mode)?.label;
  return {
    content: { language: outLanguage, blocks }, generator, language: outLanguage, notice,
    title: action.title(i.session.title, { ...(modeLabel && action.task === 'summarize' ? { modeLabel } : {}), ...(target ? { languageLabel: languageLabel(target) } : {}) }),
    provenance: { ...baseProv, generator, language: outLanguage, options: opts, parts },
  };
}

/** Résultat → StudyArtifact (même modèle que tous les supports). */
export function toDerivedArtifact(out: RunOutput, p: { userId: string; session: { id: string; subjectId: string | null }; action: TranscriptAction }): StudyArtifact {
  const now = new Date().toISOString();
  return {
    id: newId(), userId: p.userId, type: p.action.docType!, title: out.title.slice(0, 300), subjectId: p.session.subjectId, sourceSessionIds: [p.session.id],
    scope: null, settings: {}, content: out.content, generatedContent: structuredClone(out.content),
    courseId: '', courseVersion: 0, sourceSnapshot: { sources: [], hash: '' } as unknown as StudyArtifact['sourceSnapshot'], engineVersion: out.generator.model,
    provenance: out.provenance, generation: 1, userEdited: false,
    sourceType: 'transcript', generationType: p.action.id, language: out.language, sourceTranscriptVersion: out.provenance.transcriptVersion,
    parentArtifactId: out.provenance.parentArtifactId ?? null, generator: out.generator, revisions: [],
    createdAt: now, updatedAt: now,
  };
}

/** Bloc de document → paragraphes (pour traduire/résumer un support existant : « traduire le résumé seulement »). */
export function paragraphsOfDoc(doc: DocContent): Paragraph[] {
  return doc.blocks.map((b) => ({
    text: b.kind === 'definition' ? `${b.term} : ${b.text}` : b.kind === 'table' ? (b.rows ?? []).map((r) => r.join(' | ')).join('\n') : b.kind === 'heading' ? `${'#'.repeat(b.level ?? 1)} ${b.text}` : b.kind === 'bullet' ? `- ${b.text}` : b.text,
    startMs: b.startMs ?? 0, endMs: b.startMs ?? 0, uncertain: !!b.uncertain,
  })).filter((p) => p.text.trim());
}
