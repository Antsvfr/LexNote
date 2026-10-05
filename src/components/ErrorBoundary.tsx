import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('[LexNote] Erreur d’interface', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page" role="alert">
        <h1>Oups, quelque chose s’est mal passé</h1>
        <p className="page__sub">Vos notes sont enregistrées sur cet appareil. Rechargez la page pour continuer.</p>
        <p style={{ marginTop: 16 }}><button className="btn btn--primary" onClick={() => location.assign('/')}>Retour à l’accueil</button></p>
      </div>
    );
  }
}
