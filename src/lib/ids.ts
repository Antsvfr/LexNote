/**
 * Identifiant UUID v4, généré côté client : une séance peut être créée hors ligne avec son id définitif
 * (compatible avec les colonnes `uuid` de Postgres, aucun auto-incrément serveur).
 * Le paramètre `prefix` est ignoré (conservé pour compatibilité des appels).
 */
export function newId(_prefix?: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  const b = new Uint8Array(16);
  (typeof crypto !== 'undefined' ? crypto : { getRandomValues: (a: Uint8Array) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40; b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
