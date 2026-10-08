/**
 * Pipeline explicite :
 *   Sources → Extraction (à l'import) → Normalisation → Context Builder → Structure Analyzer → Course Generator → Validation → Generated Course
 * Chaque étape est un module séparé ; le moteur de composition est un `CourseEngineProvider` interchangeable.
 */
import type { CourseSource, GeneratedCourseContent, SourceSnapshot } from '@/domain/course';
import type { CourseMaterial } from './chunking';
import { AbortedError, CourseContextBuilder, MemoryAnalysisCache, type AnalysisCache } from './context';
import { RuleBasedAnalyzer } from './analyzer';
import { generateCourse } from './generator';
import { EngineUnavailableError, localProvider, toComposeInput, type CourseEngineProvider } from './provider';
import { analyzeStructure } from './structure';
import { hashText } from './text';
import { validateCourse } from './validator';

export const ENGINE_VERSION = 'ice-1.0';
export const STAGES = ['sources', 'normalisation', 'contexte', 'structure', 'génération', 'validation'] as const;
export type Stage = (typeof STAGES)[number];

export interface EngineRun {
  content: GeneratedCourseContent;
  snapshot: SourceSnapshot;
  providerId: string;
  providerLabel: string;
  engineVersion: string;
  /** Le moteur demandé était injoignable : le cours a été produit localement. */
  fellBack: boolean;
  stats: { cacheHits: number; analyzed: number; dropped: number; downgraded: number; conflicts: number; duplicatesMerged: number };
}
export interface EngineOptions {
  provider?: CourseEngineProvider;
  /** Si le moteur distant est injoignable : produire quand même un cours avec le moteur local (sinon : erreur). */
  fallbackToLocal?: boolean;
  cache?: AnalysisCache;
  signal?: AbortSignal;
  onProgress?: (stage: Stage, done: number, total: number) => void;
}

export const snapshotOf = (sources: CourseSource[]): SourceSnapshot => ({
  sources: sources.map((s) => ({ id: s.id, kind: s.kind, label: s.label, hash: s.hash, chunkCount: s.chunkCount })),
  hash: hashText(sources.map((s) => `${s.id}:${s.hash}`).sort().join('|')),
});

export async function runCourseEngine(material: CourseMaterial, opts: EngineOptions = {}): Promise<EngineRun> {
  const provider = opts.provider ?? localProvider;
  const progress = (s: Stage, d = 0, t = 1) => opts.onProgress?.(s, d, t);
  const check = () => { if (opts.signal?.aborted) throw new AbortedError(); };

  progress('sources'); progress('normalisation');
  const builder = new CourseContextBuilder(provider.analyzer ?? new RuleBasedAnalyzer(), opts.cache ?? new MemoryAnalysisCache());
  progress('contexte');
  const ctx = await builder.build(material, { signal: opts.signal, onProgress: (d, t) => progress('contexte', d, t) });
  check();

  progress('structure');
  const plan = analyzeStructure(ctx, material);
  check();

  progress('génération');
  let raw: unknown; let used = provider; let fellBack = false;
  if (provider.compose) {
    try { raw = await provider.compose(toComposeInput(material.sessionTitle, plan, ctx.units), opts.signal); }
    catch (e) {
      if (!(e instanceof EngineUnavailableError) || !opts.fallbackToLocal) throw e;
      fellBack = true; used = localProvider;
    }
  }
  if (raw === undefined) raw = generateCourse(ctx, plan, material);
  check();

  progress('validation');
  const v = validateCourse(raw, new Map(ctx.chunks.map((c) => [c.id, c])));
  progress('validation', 1, 1);
  return {
    content: v.content, snapshot: snapshotOf(ctx.sources), providerId: used.id, providerLabel: fellBack ? `${localProvider.label} — le moteur « ${provider.label} » était injoignable` : used.label,
    engineVersion: ENGINE_VERSION, fellBack,
    stats: { cacheHits: ctx.stats.cacheHits, analyzed: ctx.stats.analyzed, dropped: v.dropped, downgraded: v.downgraded, conflicts: ctx.stats.conflicts, duplicatesMerged: ctx.stats.duplicatesMerged },
  };
}
export { AbortedError };
