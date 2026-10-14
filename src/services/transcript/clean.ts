/**
 * Nettoyage LÉGER d'une transcription, sur l'appareil, sans IA :
 *  - retire les hésitations orales évidentes (« euh », « hum », « um »…) ;
 *  - retire les répétitions immédiates d'un même mot ou d'une même paire de mots (« le le », « c'est c'est ») ;
 *  - normalise espaces, ponctuation et majuscules de début de phrase ; regroupe en paragraphes (pauses).
 *
 * Il ne reformule RIEN, ne corrige aucun mot, ne supprime aucune notion : c'est une transformation déterministe et vérifiable.
 * La correction des erreurs de transcription (mots mal entendus) relève du nettoyage IA (`clean` côté moteur) — jamais simulée ici.
 * Les passages de faible confiance restent marqués « incertains ».
 */
import { newId } from '@/lib/ids';
import type { DocContent } from '@/domain/derived';
import type { Paragraph } from './source';

const FILLERS: Record<string, string[]> = {
  fr: ['euh', 'euhh', 'heu', 'hum', 'hmm', 'bah', 'ben'],
  en: ['um', 'uh', 'uhm', 'erm', 'er', 'hmm', 'hm'],
  es: ['eh', 'em', 'mmm', 'ehh'],
  de: ['äh', 'ähm', 'öh', 'hm', 'hmm'],
  it: ['ehm', 'eh', 'mmm', 'uhm'],
};
const ALL_FILLERS = [...new Set(Object.values(FILLERS).flat())];

export interface CleanStats { fillers: number; repetitions: number; paragraphs: number }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Nettoie un passage. `lang` restreint les hésitations à celles de la langue (sinon : toutes les langues connues). */
export function cleanSentenceText(input: string, lang?: string, stats: CleanStats = { fillers: 0, repetitions: 0, paragraphs: 0 }): string {
  let t = ` ${input.replace(/\s+/g, ' ')} `;
  const fillers = (lang && FILLERS[lang]) || ALL_FILLERS;
  // hésitations : mot isolé, éventuellement suivi de points de suspension / virgule
  const fre = new RegExp(`(^|[\\s,;])(?:${fillers.map(esc).join('|')})(?:\\.{2,3}|…)?(?=[\\s,;.!?…]|$)`, 'giu');
  t = t.replace(fre, (_m, pre: string) => { stats.fillers++; return pre; });
  // répétitions immédiates : « le le », « je je je », « c'est c'est »
  t = t.replace(/(^|\s)((?:[\p{L}\p{N}'’-]+\s+)?[\p{L}\p{N}'’-]+)(?:\s+\2)+(?=[\s,;.!?…]|$)/giu, (_m, pre: string, word: string) => { stats.repetitions++; return `${pre}${word}`; });
  t = t
    .replace(/\s+([,.…])/g, '$1')
    .replace(/,\s*,+/g, ',')
    .replace(/(^|[.!?…]\s+),\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,;\s]+/, '');
  if (lang === 'fr' || !lang) t = t.replace(/\s*([;:!?])/g, ' $1').replace(/ ([;:!?])(?=\S)/g, ' $1 ');
  // majuscule en début de phrase
  t = t.replace(/(^|[.!?…]\s+)(\p{Ll})/gu, (_m, p: string, c: string) => p + c.toUpperCase());
  if (t && !/[.!?…:»"]$/.test(t)) t += '.';
  return t;
}

export function cleanTranscriptLocally(paragraphs: Paragraph[], lang?: string): { doc: DocContent; stats: CleanStats } {
  const stats: CleanStats = { fillers: 0, repetitions: 0, paragraphs: 0 };
  const blocks = paragraphs.flatMap((p) => {
    const text = cleanSentenceText(p.text, lang, stats);
    if (!text.replace(/[.\s]/g, '')) return [];
    stats.paragraphs++;
    return [{ id: newId(), kind: 'paragraph' as const, text, startMs: p.startMs, ...(p.uncertain ? { uncertain: true } : {}) }];
  });
  return { doc: { language: lang ?? 'und', blocks }, stats };
}
