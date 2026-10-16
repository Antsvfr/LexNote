import { Component, type ReactNode } from 'react';
import { log } from '@/lib/log';
import { crashCode } from '@/lib/errorCodes';
import { getBuildInfo } from '@/lib/buildInfo';

/**
 * Dernier filet de sécurité de l'interface. N'affiche jamais de trace, de message technique ni de contenu : seulement un code de
 * diagnostic stable (UI-CRASH-01/xxxx) et la version, à communiquer au support. Les notes sont déjà enregistrées sur l'appareil.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    log.ui.error('erreur d’interface', error, crashCode(error));
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page" role="alert" data-testid="error-boundary">
        <h1>LexNote a rencontré un problème.</h1>
        <p className="page__sub">Vos notes sont enregistrées sur cet appareil : rien n’est perdu. Vous pouvez réessayer ou revenir à l’accueil.</p>
        <p style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn--primary" onClick={() => this.setState({ error: null })}>Réessayer</button>
          <button className="btn" onClick={() => location.assign('/')}>Retour à l’accueil</button>
        </p>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 16 }} data-testid="error-code">Code de diagnostic : {crashCode(error)} · LexNote {getBuildInfo().label}</p>
      </div>
    );
  }
}
