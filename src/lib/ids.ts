export function newId(_prefix = ''): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  const a = Math.random().toString(16).slice(2).padEnd(12, '0').slice(0, 12);
  const b = Date.now().toString(16).padStart(12, '0').slice(-12);
  return (b.slice(0, 8) + '-' + b.slice(8, 12) + '-4' + a.slice(0, 3) + '-8' + a.slice(3, 6) + '-' + a.slice(6, 12)).slice(0, 36);
}
