/** « Bon cours, Léa ! » — « Bon cours ! » sans prénom. Aucun prénom n'est jamais codé en dur. */
export function greeting(firstName?: string | null): string {
  const n = firstName?.trim();
  return n ? `Bon cours, ${n} !` : 'Bon cours !';
}
export const DEFAULT_QUOTE = 'Comprendre aujourd’hui, maîtriser demain.';
