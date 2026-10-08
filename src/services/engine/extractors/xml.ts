/** Utilitaires XML minimalistes pour DOCX / PPTX (sans DOMParser : fonctionne dans un worker et sous Node). */
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const decodeXml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') { const n = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
export const blocks = (xml: string, tag: string): string[] => {
  const out: string[] = []; const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'); let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[0]);
  return out;
};
export const textRuns = (xml: string, tag: string) => {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>|<(?:w:tab|a:tab)\\s*/>|<(?:w:br|a:br)(?:\\s[^>]*)?/>`, 'g');
  let out = ''; let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += m[1] !== undefined ? decodeXml(m[1]) : m[0].includes('tab') ? ' ' : '\n';
  return out;
};
