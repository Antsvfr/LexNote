/** Détection de langue LÉGÈRE (mots outils), pour les langues prioritaires. Sert d'indice (langue source d'une traduction,
 *  hésitations à retirer) ; jamais de décision bloquante. Renvoie `undefined` si le texte est trop court ou ambigu. */
const STOP: Record<string, string[]> = {
  fr: ['le', 'la', 'les', 'des', 'est', 'et', 'une', 'que', 'qui', 'dans', 'pour', 'pas', 'sur', 'avec', 'donc', 'vous', 'nous', 'c\'est', 'aussi', 'mais'],
  en: ['the', 'and', 'is', 'of', 'to', 'in', 'that', 'it', 'you', 'for', 'are', 'with', 'this', 'on', 'we', 'have', 'not', 'be', 'so', 'what'],
  es: ['el', 'los', 'las', 'que', 'y', 'es', 'en', 'un', 'una', 'por', 'con', 'para', 'del', 'se', 'como', 'pero', 'muy', 'este', 'esta', 'son'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'zu', 'mit', 'auf', 'für', 'sie', 'wir', 'auch', 'den', 'dem', 'es', 'sich', 'aber'],
  it: ['il', 'lo', 'gli', 'che', 'e', 'è', 'di', 'un', 'una', 'per', 'con', 'non', 'del', 'della', 'sono', 'anche', 'ma', 'come', 'questo', 'nel'],
};
export function detectLanguage(text: string): string | undefined {
  const words = (text.toLowerCase().match(/[\p{L}']+/gu) ?? []).slice(0, 4000);
  if (words.length < 8) return undefined;
  const scores = Object.entries(STOP).map(([lang, list]) => { const set = new Set(list); return [lang, words.filter((w) => set.has(w)).length] as const; }).sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  if (!best || best[1] < 3 || (second && best[1] < second[1] * 1.3)) return undefined;
  return best[0];
}
