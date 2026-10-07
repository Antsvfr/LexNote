import { LogoMark } from './Logo';

export function Splash({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="splash" role="status" aria-live="polite" data-testid="splash">
      <LogoMark className="brand__mark" />
      <span>{label}</span>
    </div>
  );
}
