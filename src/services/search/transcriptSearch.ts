import type { TranscriptSegment } from '@/domain/capture';
import { normalize } from '@/lib/text';

export interface TranscriptHit {
  segmentId: string;
  sessionId: string;
  startMs: number;
  snippet: string;
}

interface Entry { id: string; sessionId: string; startMs: number; text: string; norm: string }

/**
 * Index en mémoire des segments de transcription (texte normalisé : sans accents, minuscules).
 * Construit à la demande (jamais pendant la frappe), puis tenu à jour incrémentalement.
 * Interface prête pour une recherche sémantique ultérieure (même forme de résultat).
 */
export class TranscriptIndex {
  private entries = new Map<string, Entry>();
  private building: Promise<void> | null = null;
  ready = false;

  /** `load` lit tous les segments du stockage ; l'indexation est découpée pour ne pas bloquer l'interface. */
  ensure(load: () => Promise<TranscriptSegment[]>): Promise<void> {
    if (this.ready) return Promise.resolve();
    this.building ??= (async () => {
      const all = await load();
      for (let i = 0; i < all.length; i++) {
        this.add(all[i]!);
        if (i % 2000 === 1999) await new Promise((r) => setTimeout(r, 0)); // rend la main au navigateur
      }
      this.ready = true;
    })().finally(() => { this.building = null; });
    return this.building;
  }

  add(seg: Pick<TranscriptSegment, 'id' | 'sessionId' | 'startMs' | 'text'>) {
    this.entries.set(seg.id, { id: seg.id, sessionId: seg.sessionId, startMs: seg.startMs, text: seg.text, norm: normalize(seg.text) });
  }
  removeSession(sessionId: string) {
    for (const [k, e] of this.entries) if (e.sessionId === sessionId) this.entries.delete(k);
  }
  clear() { this.entries.clear(); this.ready = false; }
  get size() { return this.entries.size; }

  search(query: string, limit = 60): TranscriptHit[] {
    const tokens = normalize(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const out: TranscriptHit[] = [];
    for (const e of this.entries.values()) {
      if (tokens.every((t) => e.norm.includes(t))) {
        out.push({ segmentId: e.id, sessionId: e.sessionId, startMs: e.startMs, snippet: e.text });
        if (out.length >= limit * 4) break;
      }
    }
    // Un CM à la fois, dans l'ordre chronologique du cours.
    return out.sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.startMs - b.startMs).slice(0, limit);
  }
}
