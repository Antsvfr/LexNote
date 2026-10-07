import type { SourceChunk, SourceKind } from '@/domain/course';
import { tokens } from './text';

export interface Hit { id: string; score: number }

/**
 * Index de recherche BM25 en mémoire — brique « RAG » du moteur : sélection du contexte pertinent (au lieu d'injecter une séance
 * entière), corroboration entre sources, rattachement des passages aux sections. Construit en une passe, interrogé en O(postings).
 * Évolutif : un index vectoriel / distant pourra implémenter la même interface (`search`) sans changer le reste.
 */
export class SourceIndex<T extends { id: string; text: string }> {
  private postings = new Map<string, Map<string, number>>();
  private len = new Map<string, number>();
  private avg = 0;
  private items = new Map<string, T>();
  private terms = new Map<string, string[]>();

  constructor(items: T[] = []) { items.forEach((i) => this.add(i)); this.finish(); }

  add(item: T) {
    const toks = tokens(item.text);
    this.items.set(item.id, item); this.terms.set(item.id, toks); this.len.set(item.id, toks.length);
    const tf = new Map<string, number>(); toks.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));
    for (const [t, n] of tf) { let p = this.postings.get(t); if (!p) this.postings.set(t, (p = new Map())); p.set(item.id, n); }
  }
  finish() { const v = [...this.len.values()]; this.avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 1; }
  get size() { return this.items.size; }
  get(id: string) { return this.items.get(id); }
  termsOf(id: string) { return this.terms.get(id) ?? []; }

  search(query: string, opts: { k?: number; filter?: (item: T) => boolean } = {}): Hit[] {
    const q = [...new Set(tokens(query))];
    const N = this.items.size; const k1 = 1.4, b = 0.75;
    const scores = new Map<string, number>();
    for (const t of q) {
      const p = this.postings.get(t); if (!p) continue;
      const idf = Math.log(1 + (N - p.size + 0.5) / (p.size + 0.5));
      for (const [id, tf] of p) {
        const dl = this.len.get(id) ?? 1;
        scores.set(id, (scores.get(id) ?? 0) + idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * dl) / this.avg))));
      }
    }
    let hits = [...scores].map(([id, score]) => ({ id, score }));
    if (opts.filter) hits = hits.filter((h) => opts.filter!(this.items.get(h.id)!));
    return hits.sort((a, b2) => b2.score - a.score).slice(0, opts.k ?? 8);
  }
}

export type ChunkIndex = SourceIndex<SourceChunk>;
export const buildChunkIndex = (chunks: SourceChunk[]): ChunkIndex => new SourceIndex(chunks);
export const otherKinds = (kind: SourceKind) => (c: SourceChunk) => c.kind !== kind;
