import { NavLink } from 'react-router-dom';

/** Les deux espaces d'une séance : « Cours » (sources + cours reconstruit) et « Réviser » (supports dérivés du cours). */
export function SessionSpaces({ sessionId }: { sessionId: string }) {
  return (
    <nav className="spaces" aria-label="Espaces de la séance">
      <NavLink to={`/session/${sessionId}/course`} className={({ isActive }) => (isActive ? 'is-on' : '')} data-testid="space-course">Cours</NavLink>
      <NavLink to={`/session/${sessionId}/review`} className={({ isActive }) => (isActive ? 'is-on' : '')} data-testid="space-review">Réviser</NavLink>
    </nav>
  );
}
