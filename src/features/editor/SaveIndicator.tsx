import { useSaveStatus } from './saveStatus';

/** « ● Enregistré » — pastille verte ; ambre pendant l'écriture ; rouge en cas d'échec. */
export function SaveIndicator() {
  const state = useSaveStatus((s) => s.state);
  return (
    <span className={`save save--${state}`} role="status" aria-live="polite" data-testid="save-status">
      <span className={`status-dot${state === 'saving' ? ' is-busy' : state === 'error' ? ' is-err' : ''}`} aria-hidden />
      <span>{state === 'saving' ? 'Enregistrement…' : state === 'error' ? 'Échec de l’enregistrement' : 'Enregistré'}</span>
    </span>
  );
}
