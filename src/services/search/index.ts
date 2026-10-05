import type { CourseSession, LibrarySnapshot, Module, Subject } from '@/domain/types';
import { normalize } from '@/lib/text';

export type SearchHitKind = 'subject' | 'module' | 'session';
export type MatchField = 'name' | 'title' | 'content';

export interface SearchHit {
  kind: SearchHitKind;
  id: string;
  title: string;
  /** Contexte : "Droit › Droit des contrats". */
  context: string;
  snippet?: string;
  matchedIn: MatchField;
  score: number;
  /** Destination dans l'app. */
  href: string;
}

/**
 * Contrat de recherche. V1 : texte brut (`TextSearchProvider`).
 * Futur : `SemanticSearchProvider` (embeddings) derrière la même interface.
 */
export interface SearchProvider {
  readonly id: string;
  search(query: string, lib: LibrarySnapshot): SearchHit[];
}

const tokensOf = (q: string) => normalize(q).split(/\s+/).filter(Boolean);

function snippetAround(text: string, normText: string, token: string): string {
  // `normalize` supprime les diacritiques combinants : les longueurs peuvent diverger,
  // on travaille donc sur le texte d'origine avec une approximation sûre.
  const idx = normText.indexOf(token);
  if (idx < 0) return text.slice(0, 140);
  const start = Math.max(0, idx - 50);
  const end = Math.min(text.length, idx + token.length + 90);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

export class TextSearchProvider implements SearchProvider {
  readonly id = 'text';
  /** Cache du texte normalisé, invalidé par `updatedAt` : la recherche ne retraite pas tout à chaque frappe. */
  private cache = new Map<string, { stamp: string; norm: string }>();

  private norm(s: CourseSession): string {
    const hit = this.cache.get(s.id);
    if (hit && hit.stamp === s.updatedAt) return hit.norm;
    const norm = normalize(s.searchText);
    this.cache.set(s.id, { stamp: s.updatedAt, norm });
    return norm;
  }

  search(query: string, lib: LibrarySnapshot, limit = 50): SearchHit[] {
    const tokens = tokensOf(query);
    if (!tokens.length) return [];
    const subjects = new Map(lib.subjects.map((s) => [s.id, s]));
    const modules = new Map(lib.modules.map((m) => [m.id, m]));
    const hits: SearchHit[] = [];

    const all = (hay: string) => tokens.every((t) => hay.includes(t));

    for (const s of lib.subjects as Subject[]) {
      if (all(normalize(s.name))) {
        hits.push({ kind: 'subject', id: s.id, title: s.name, context: 'Matière', matchedIn: 'name', score: 100, href: `/subjects/${s.id}` });
      }
    }
    for (const m of lib.modules as Module[]) {
      const subj = subjects.get(m.subjectId);
      if (all(normalize(m.name))) {
        hits.push({ kind: 'module', id: m.id, title: m.name, context: subj?.name ?? 'Module', matchedIn: 'name', score: 80, href: `/modules/${m.id}` });
      }
    }
    for (const s of lib.sessions) {
      const mod = modules.get(s.moduleId);
      const subj = subjects.get(s.subjectId);
      const context = [subj?.name, mod?.name].filter(Boolean).join(' › ');
      const label = s.number != null ? `CM ${String(s.number).padStart(2, '0')} — ${s.title}` : s.title;
      const titleNorm = normalize(label);
      if (all(titleNorm)) {
        hits.push({ kind: 'session', id: s.id, title: label, context, snippet: s.excerpt, matchedIn: 'title', score: 90, href: `/session/${s.id}` });
        continue;
      }
      const norm = this.norm(s);
      if (all(norm)) {
        const first = tokens[0] ?? '';
        hits.push({
          kind: 'session', id: s.id, title: label, context,
          snippet: snippetAround(s.searchText, norm, first),
          matchedIn: 'content', score: 50, href: `/session/${s.id}`,
        });
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

export const searchService: SearchProvider = new TextSearchProvider();
