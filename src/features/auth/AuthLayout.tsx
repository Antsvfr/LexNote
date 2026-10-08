import type { ReactNode } from 'react';
import { Scale, ShieldCheck, WifiOff } from 'lucide-react';
import { LogoMark } from '@/components/Logo';
import heroArt from '@/assets/art/hero-courthouse.svg';

/** Écrans de connexion : même univers que l'application (fond sombre, halo rouge, éléments juridiques discrets). */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="authpage">
      <div className="authpage__art" aria-hidden><img src={heroArt} alt="" /></div>
      <div className="authpage__col">
        <header className="authpage__brand">
          <LogoMark className="brand__mark" />
          <div className="brand__text"><strong>LexNote</strong><small>Notes · CM · Droit</small></div>
        </header>
        <main className="authcard" aria-labelledby="auth-title">
          <h1 id="auth-title">{title}</h1>
          {subtitle && <p className="authcard__sub">{subtitle}</p>}
          {children}
        </main>
        {footer && <p className="authpage__foot">{footer}</p>}
        <ul className="authpage__points" aria-label="Pourquoi LexNote">
          <li><Scale size={15} aria-hidden /> Conçu pour les cours de droit</li>
          <li><WifiOff size={15} aria-hidden /> Fonctionne hors ligne</li>
          <li><ShieldCheck size={15} aria-hidden /> Vos notes ne sont visibles que de vous</li>
        </ul>
      </div>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  return message ? <p className="formerror" role="alert" data-testid="auth-error">{message}</p> : null;
}
