/** Normalisation : nettoyage des documents (en-têtes / pieds de page, numéros) et déduplication des morceaux. */
import type { ExtractedDocument, SourceChunk } from '@/domain/course';
import { foldKey, normalizeText } from './text';

const PAGE_NO = /^\s*(?:page|p\.|diapositive|slide)?\s*\d{1,4}\s*(?:\/\s*\d{1,4})?\s*$/i;

/** Retire les lignes répétées sur ≥ 40 % des pages (≥ 3 pages) — en-têtes, pieds de page, logos — et les numéros de page. */
export function cleanExtraction(doc: ExtractedDocument): ExtractedDocument {
  const n = doc.units.length;
  const freq = new Map<string, number>();
  if (n >= 3) for (const u of doc.units) for (const k of new Set(u.text.split('\n').map((l) => foldKey(l)).filter((l) => l.length > 2))) freq.set(k, (freq.get(k) ?? 0) + 1);
  const boiler = new Set([...freq].filter(([, c]) => c >= Math.max(3, Math.ceil(n * 0.4))).map(([k]) => k));
  const units = doc.units.map((u) => ({
    ...u,
    text: normalizeText(u.text.split('\n').filter((l) => !PAGE_NO.test(l) && !boiler.has(foldKey(l))).join('\n')),
  })).filter((u) => u.text || u.title);
  return { ...doc, units };
}

/** Déduplication : un même texte vu dans plusieurs endroits n'est gardé qu'une fois ; les autres emplacements sont conservés (`alsoIn`). */
export function dedupeChunks(chunks: SourceChunk[]): { chunks: SourceChunk[]; removed: number } {
  const seen = new Map<string, SourceChunk>(); const out: SourceChunk[] = []; let removed = 0;
  for (const c of chunks) {
    const key = `${c.kind}|${foldKey(c.text)}`;
    const prev = seen.get(key);
    if (prev && foldKey(c.text).length > 20) { prev.alsoIn = [...(prev.alsoIn ?? []), c.location]; removed++; continue; }
    seen.set(key, c); out.push(c);
  }
  return { chunks: out, removed };
}
