import { SUBJECT_ICONS } from '@/lib/subjectIcons';

/** Pastille de couleur de la matière — ou son icône si elle en a choisi une. */
export function SubjectDot({ color, icon }: { color: string; icon?: string }) {
  const Icon = icon ? SUBJECT_ICONS[icon]?.Icon : undefined;
  const style = { ['--dot' as string]: `var(--c-${color}, var(--ink-3))` };
  if (Icon) return <span className="dot dot--icon" style={style} aria-hidden><Icon size={11} strokeWidth={2.4} /></span>;
  return <span className="dot" style={style} aria-hidden />;
}
