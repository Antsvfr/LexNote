import architecture from '@/assets/art/thumb-architecture.svg';
import justice from '@/assets/art/thumb-justice.svg';
import chart from '@/assets/art/thumb-chart.svg';
import skyline from '@/assets/art/thumb-skyline.svg';
import document from '@/assets/art/thumb-document.svg';
import abstract from '@/assets/art/thumb-abstract.svg';
import { normalize } from '@/lib/text';
import type { CourseSession, Subject, ThumbKey } from '@/domain/types';

export const THUMBS: Record<ThumbKey, { label: string; src: string }> = {
  architecture: { label: 'Architecture', src: architecture },
  justice: { label: 'Justice', src: justice },
  chart: { label: 'Graphique', src: chart },
  skyline: { label: 'Ville', src: skyline },
  document: { label: 'Document', src: document },
  abstract: { label: 'Abstrait', src: abstract },
};
export const THUMB_KEYS = Object.keys(THUMBS) as ThumbKey[];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Vignette d'un CM : celle choisie par l'étudiant, sinon déterministe selon la matière
 * (Droit → architecture / justice / document, Finance → graphique, Économie → ville, Marketing → abstrait).
 * Même CM = même image à chaque ouverture.
 */
export function thumbFor(session: Pick<CourseSession, 'id' | 'thumbnail'>, subject?: Pick<Subject, 'name' | 'color'>): ThumbKey {
  if (session.thumbnail && session.thumbnail in THUMBS) return session.thumbnail;
  const name = normalize(subject?.name ?? '');
  if (/droit|jur|law|civil|penal|contrat/.test(name)) return (['architecture', 'justice', 'document'] as const)[hash(session.id) % 3]!;
  if (/financ|compta|bourse|banque/.test(name)) return 'chart';
  if (/econom|macro|micro/.test(name)) return 'skyline';
  if (/market|commun|vente|strateg/.test(name)) return 'abstract';
  return THUMB_KEYS[hash(session.id) % THUMB_KEYS.length]!;
}
