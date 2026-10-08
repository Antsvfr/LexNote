import { createContext, useContext } from 'react';
import type { SourceConfidence, SourceReference } from '@/domain/course';
import { ConfidenceBadge, SourceBadge } from '@/components/SourceBadge';

/** Séance du cours dont l'artefact est dérivé : nécessaire pour que chaque badge sache où « Ouvrir la source ». */
export const SessionContext = createContext<string>('');

/** Provenance d'un élément : le MÊME badge que dans le cours reconstruit (Notes · PDF p. 14 · Transcription 01:12:34…). */
export function Sources({ sources, confidence, empty = 'Ajouté par vous : aucune source dans le cours.' }: { sources: SourceReference[]; confidence?: SourceConfidence; empty?: string }) {
  const sessionId = useContext(SessionContext);
  if (!sources.length) return <p className="muted srcs__empty">{empty}</p>;
  return (
    <span className="srcline" data-testid="sources">
      <SourceBadge refs={sources} sessionId={sessionId} />
      {confidence && <ConfidenceBadge level={confidence} />}
    </span>
  );
}
