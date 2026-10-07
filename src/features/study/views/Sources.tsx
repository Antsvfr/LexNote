import { Link } from 'react-router-dom';
import { PROVENANCE_LABELS } from '@/domain/legal';
import type { ArtifactSource } from '@/domain/study';

/** Provenance d'un élément : d'où vient-il dans le cours ? */
export function Sources({ sources, empty = 'Ajouté par vous : aucune source dans le cours.' }: { sources: ArtifactSource[]; empty?: string }) {
  if (!sources.length) return <p className="muted srcs__empty">{empty}</p>;
  return (
    <ul className="srcs" data-testid="sources">
      {sources.map((s, k) => (
        <li key={k}>
          <span className="srcs__origin">{PROVENANCE_LABELS[s.origin === 'USER_NOTE' ? 'USER_NOTE' : s.origin === 'TRANSCRIPTION' ? 'TRANSCRIPTION' : 'DOCUMENT']}</span>
          {s.headingPath.length > 0 && <span className="srcs__path">{s.headingPath.join(' › ')}</span>}
          {s.quote && <q className="srcs__quote">{s.quote.length > 160 ? `${s.quote.slice(0, 159)}…` : s.quote}</q>}
          <Link to={`/session/${s.sessionId}`} className="link srcs__open">Ouvrir le cours</Link>
        </li>
      ))}
    </ul>
  );
}
