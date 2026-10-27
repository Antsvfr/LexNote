/**
 * Texte de travail d'une transcription : paragraphes (regroupés par pauses), empreinte de version, découpage en parties.
 * Pur : aucun accès au stockage ni au réseau. Testé (`transcript.test.ts`).
 */
import type { TranscriptSegment } from '@/domain/capture';
import { hashText } from '@/services/engine/text';

export interface Paragraph { text: string; startMs: number; endMs: number; uncertain: boolean }
export interface TranscriptText {
  paragraphs: Paragraph[];
  /** Texte complet, paragraphes séparés par une ligne vide. */
  text: string;
  words: number;
  /** Empreinte de la transcription traitée : change dès qu'un segment est ajouté ou corrigé. */
  version: string;
  range: { startMs: number; endMs: number } | null;
}

/** Pause (ms) au-delà de laquelle on ouvre un nouveau paragraphe ; nombre de mots au-delà duquel on coupe de toute façon. */
const PAUSE_MS = 2500;
const PARA_WORDS = 140;
/** Confiance sous laquelle un segment est marqué « incertain » (mal entendu). */
export const LOW_CONFIDENCE = 0.6;

export const wordsOf = (s: string) => s.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;

/** Empreinte stable d'un ensemble de segments (identifiants, bornes, textes). */
export function transcriptVersion(segments: Pick<TranscriptSegment, 'id' | 'startMs' | 'text'>[]): string {
  return `t${segments.length}-${hashText(segments.map((s) => `${s.id}|${s.startMs}|${s.text}`).join('\n'))}`;
}

/** Regroupe les segments (déjà triés) en paragraphes lisibles. `range` : ne garde que les segments qui chevauchent la plage. */
export function buildTranscriptText(segments: TranscriptSegment[], opts: { range?: { startMs: number; endMs: number } } = {}): TranscriptText {
  const segs = [...segments]
    .filter((s) => s.text.trim())
    .filter((s) => !opts.range || (s.endMs >= opts.range.startMs && s.startMs <= opts.range.endMs))
    .sort((a, b) => a.startMs - b.startMs);
  const paragraphs: Paragraph[] = [];
  let cur: Paragraph | null = null; let curWords = 0; let lastEnd = -Infinity;
  for (const s of segs) {
    const t = s.text.trim().replace(/\s+/g, ' ');
    const w = wordsOf(t);
    const low = s.confidence !== undefined && s.confidence < LOW_CONFIDENCE;
    if (!cur || s.startMs - lastEnd > PAUSE_MS || curWords + w > PARA_WORDS) {
      cur = { text: t, startMs: s.startMs, endMs: s.endMs, uncertain: low };
      paragraphs.push(cur); curWords = w;
    } else {
      cur.text = `${cur.text} ${t}`; cur.endMs = s.endMs; cur.uncertain ||= low; curWords += w;
    }
    lastEnd = s.endMs;
  }
  const text = paragraphs.map((p) => p.text).join('\n\n');
  return { paragraphs, text, words: wordsOf(text), version: transcriptVersion(segs), range: opts.range ?? null };
}

export interface TextChunk { index: number; text: string; startMs: number | null; endMs: number | null; words: number }

/**
 * Découpe un long texte en parties ≤ `maxChars`, aux frontières de paragraphes (puis de phrases si un paragraphe est trop long).
 * Ne coupe jamais au milieu d'un mot ; ne perd jamais de texte (la concaténation des parties = le texte d'entrée, aux espaces près).
 */
export function chunkParagraphs(paragraphs: Pick<Paragraph, 'text' | 'startMs' | 'endMs'>[], maxChars: number): TextChunk[] {
  const out: TextChunk[] = [];
  let buf: string[] = []; let len = 0; let start: number | null = null; let end: number | null = null;
  const flush = () => {
    if (!buf.length) return;
    const text = buf.join('\n\n');
    out.push({ index: out.length, text, startMs: start, endMs: end, words: wordsOf(text) });
    buf = []; len = 0; start = null; end = null;
  };
  const pieces = paragraphs.flatMap((p) => (p.text.length <= maxChars ? [p] : splitLong(p.text, maxChars).map((t) => ({ text: t, startMs: p.startMs, endMs: p.endMs }))));
  for (const p of pieces) {
    if (len && len + p.text.length + 2 > maxChars) flush();
    buf.push(p.text); len += p.text.length + 2;
    start ??= p.startMs; end = p.endMs;
  }
  flush();
  return out;
}

function splitLong(text: string, maxChars: number): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text];
  const out: string[] = []; let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + s.length > maxChars) { out.push(cur.trim()); cur = ''; }
    if (s.length > maxChars) {
      // phrase interminable (transcription sans ponctuation) : coupe aux espaces
      const words = s.split(/\s+/); for (const w of words) { if (cur.length + w.length + 1 > maxChars) { out.push(cur.trim()); cur = ''; } cur += `${w} `; }
    } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Paragraphes d'un texte libre (support existant, sélection) : sans horodatage. */
export const paragraphsOfText = (text: string): Paragraph[] =>
  text.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean).map((t) => ({ text: t, startMs: 0, endMs: 0, uncertain: false }));
