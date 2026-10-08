import { typeInfo } from '@/domain/sessionType';

/** Pastille de type de séance (CM, TD, TP…) : très visible, sobre. */
export function TypeBadge({ type, size = 'md' }: { type: string; size?: 'sm' | 'md' }) {
  const t = typeInfo(type);
  return <span className={`typebadge typebadge--${t.tone} typebadge--${size}`} title={t.long} data-testid="type-badge">{t.label}</span>;
}
