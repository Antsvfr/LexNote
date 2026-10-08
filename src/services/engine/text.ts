/** Outils de texte communs au moteur (déterministes, sans dépendance). */
export { hashText } from '@/services/study/outline';

export const normalizeText = (s: string): string =>
  s.normalize('NFC').replace(/­/g, '').replace(/[   ]/g, ' ').replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** Clé de comparaison : minuscules, sans accents ni ponctuation. */
export const foldKey = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const STOP = new Set(('le la les un une des du de d l et ou en au aux a à est sont etre été que qui quoi dont où ce cet cette ces se sa son ses leur leurs il elle ils elles on nous vous je tu me te ne pas plus ' +
  'par pour sur sous dans avec sans comme mais donc or ni car si alors ainsi aussi tres bien tout tous toute toutes fait faire peut etc the of and to in is are for on that this with').split(/\s+/).map((w) => foldKey(w)));

export const tokens = (s: string): string[] =>
  foldKey(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w)).map((w) => (w.length > 4 && /(s|x)$/.test(w) ? w.slice(0, -1) : w));

export const approxTokens = (s: string) => Math.ceil(s.length / 4);

export function jaccard(a: Iterable<string>, b: Iterable<string>): number {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

const ABBREV = new Set(('art arts cass civ com crim soc al cf ex p pp n no éd ed op cit obs préc c d l r s v vs ibid pr prof mme m dr st plén plen const cons req ch trib t ca ce cjue cedh etc env fig tab vol chap sect').split(' '));

/** Découpe en phrases en gardant les positions (pour citer l'extrait EXACT). Ne coupe pas après « art. », « Cass. », « n° »… */
export function sentences(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  let start = 0;
  const push = (end: number) => { const raw = text.slice(start, end); const lead = raw.length - raw.trimStart().length; const t = raw.trim(); if (t.length > 1) out.push({ text: t, start: start + lead, end: start + lead + t.length }); start = end; };
  const re = /[.!?;]+(?=\s|$)|\n/g; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (m[0] !== '\n' && m[0].endsWith('.')) {
      const word = /([\p{L}]+)\.+$/u.exec(text.slice(Math.max(0, m.index - 12), end))?.[1]?.toLowerCase();
      if (word && (ABBREV.has(word) || word.length === 1) && /\s\S/.test(text.slice(end, end + 3))) continue;
    }
    push(end);
  }
  push(text.length);
  return out;
}

export const formatMs = (ms: number): string => {
  const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`;
};
export const quoteOf = (text: string, start: number, end: number, max = 600) => text.slice(start, Math.min(end, start + max)).trim();

export function firstSentence(text: string, max = 160): string {
  const m = text.match(/^(.+?[.!?;])(\s|$)/);
  const s = (m?.[1] ?? text).trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
export const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
