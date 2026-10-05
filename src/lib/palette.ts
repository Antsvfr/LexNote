/** Couleurs de matières : tons sourds, lisibles en clair comme en sombre. */
export const SUBJECT_COLORS = ['indigo', 'brass', 'teal', 'plum', 'rust', 'moss', 'slate', 'rose'] as const;
export type SubjectColor = (typeof SUBJECT_COLORS)[number];

export function nextSubjectColor(used: string[]): string {
  const counts = new Map<string, number>(SUBJECT_COLORS.map((c) => [c, 0]));
  used.forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => a[1] - b[1])[0]?.[0] ?? 'indigo';
}
