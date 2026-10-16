/**
 * Raccord application ⇄ pipeline : source (transcription stockée, version nettoyée, sélection, support), moteur courant,
 * enregistrement dans les supports (StudyArtifact). Une SEULE voie pour l'interface, la sélection et la régénération.
 */
import type { TranscriptSegment } from '@/domain/capture';
import { isTranscriptProvenance, type StudyArtifact } from '@/domain/study';
import { isDocType } from '@/domain/study';
import type { DocContent } from '@/domain/derived';
import { aiService } from '@/services/ai';
import { captureManager } from '@/services/capture/manager';
import { useArtifacts } from '@/store/artifacts';
import { useAuth } from '@/store/auth';
import { useLibrary } from '@/store/library';
import { actionById, type TranscriptAction } from './actions';
import { buildTranscriptText } from './source';
import { paragraphsOfDoc, runTranscriptAction, toDerivedArtifact, type DerivedSource, type Progress, type RunOptions } from './pipeline';

/** Segments stockés d'une séance (sans changer la séance affichée). */
export async function loadSegments(sessionId: string): Promise<TranscriptSegment[]> {
  try { return await captureManager.getStorage().listSegments(sessionId); } catch { return []; }
}

export function sourceFromSegments(segments: TranscriptSegment[], range?: { startMs: number; endMs: number }): DerivedSource {
  const t = buildTranscriptText(segments, range ? { range } : {});
  return { kind: range ? 'selection' : 'original', paragraphs: t.paragraphs, version: t.version, words: t.words, ...(range ? { range } : {}) };
}

export function sourceFromArtifact(a: StudyArtifact): DerivedSource {
  const doc = a.content as DocContent;
  const paragraphs = paragraphsOfDoc(doc);
  const words = paragraphs.reduce((n, p) => n + (p.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0), 0);
  // une version nettoyée de la transcription reste « la transcription » (kind clean), un autre support est un parent
  return a.type === 'CLEAN_TRANSCRIPT'
    ? { kind: 'clean', paragraphs, version: a.sourceTranscriptVersion ?? a.id, words, language: a.language, parentArtifactId: a.id }
    : { kind: 'artifact', paragraphs, version: `${a.id}@${a.generation}${a.userEdited ? `-e${a.updatedAt}` : ''}`, words, language: a.language, parentArtifactId: a.id };
}

/** Dernière version nettoyée de la transcription d'une séance (source possible des actions suivantes). */
export const latestClean = (items: StudyArtifact[], sessionId: string) =>
  items.filter((a) => a.type === 'CLEAN_TRANSCRIPT' && a.sourceSessionIds[0] === sessionId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

export interface RunRequest {
  action: TranscriptAction;
  sessionId: string;
  source: DerivedSource;
  options?: RunOptions;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
}

/** Lance l'action, enregistre le document, le renvoie (avec un éventuel message d'information). */
export async function runAndSave(r: RunRequest): Promise<{ artifact: StudyArtifact; notice?: string }> {
  const userId = useAuth.getState().user?.id;
  if (!userId) throw new Error('Connectez-vous pour enregistrer vos supports.');
  const session = useLibrary.getState().sessions.find((s) => s.id === r.sessionId);
  if (!session) throw new Error('Cette séance n’existe plus.');
  const out = await runTranscriptAction({
    action: r.action, session: { id: session.id, title: session.title || 'Séance', subjectId: session.subjectId }, userId, source: r.source,
    options: r.options, ai: aiService, onProgress: r.onProgress, signal: r.signal, uiLanguage: 'fr',
  });
  const artifact = toDerivedArtifact(out, { userId, session, action: r.action });
  await useArtifacts.getState().add(artifact);
  return { artifact, notice: out.notice };
}

/**
 * Régénère un document dérivé avec les MÊMES réglages, sur la source ACTUELLE (transcription à jour, support parent à jour).
 * La version courante — modifiée ou non — est conservée dans l'historique : rien n'est perdu.
 */
export async function regenerate(a: StudyArtifact, onProgress?: (p: Progress) => void, signal?: AbortSignal): Promise<{ notice?: string }> {
  if (!isDocType(a.type) || !isTranscriptProvenance(a.provenance)) throw new Error('Ce support ne se régénère pas depuis la transcription.');
  const p = a.provenance;
  const action = actionById(p.generationType);
  if (!action) throw new Error('Action d’origine inconnue : impossible de régénérer.');
  let source: DerivedSource;
  if (p.parentArtifactId && (p.sourceKind === 'artifact' || p.sourceKind === 'clean')) {
    const parent = useArtifacts.getState().items.find((x) => x.id === p.parentArtifactId);
    if (!parent) throw new Error('Le support d’origine a été supprimé : impossible de régénérer à l’identique.');
    source = sourceFromArtifact(parent);
  } else {
    source = sourceFromSegments(await loadSegments(p.sessionId), p.sourceKind === 'selection' ? p.range : undefined);
  }
  const options: RunOptions = {
    ...(typeof p.options.mode === 'string' ? { mode: p.options.mode as RunOptions['mode'] } : {}),
    ...(typeof p.options.targetLanguage === 'string' ? { targetLanguage: p.options.targetLanguage } : {}),
    ...(p.options.depth === 'ai' ? { cleanDepth: 'ai' as const } : {}),
  };
  const session = useLibrary.getState().sessions.find((s) => s.id === p.sessionId);
  const out = await runTranscriptAction({
    action, session: { id: p.sessionId, title: session?.title || 'Séance', subjectId: a.subjectId }, userId: a.userId, source, options, ai: aiService, onProgress, signal, uiLanguage: 'fr',
  });
  await useArtifacts.getState().regenerateDerived(a.id, { content: out.content, provenance: out.provenance, generator: out.generator, language: out.language, sourceTranscriptVersion: out.provenance.transcriptVersion, settings: a.settings, title: out.title });
  return { notice: out.notice };
}
