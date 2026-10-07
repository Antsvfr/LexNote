export function greeting(firstName: string): string {
  const clean = firstName.trim();
  return clean ? `Bon cours, ${clean} !` : 'Bon cours !';
}
